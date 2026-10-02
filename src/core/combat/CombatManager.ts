import { planEnemyTurn, type EnemyAction } from '../ai/EnemyAI';
import type { RoomState } from '../data/RoomLoader';
import { inAttackRange, type Enemy } from '../entities/Enemy';
import { PLAYER_DATA, type Player } from '../entities/Player';
import type { HexCoord } from '../hex/HexCoord';
import type { HexGrid } from '../hex/HexGrid';
import type { ActiveSpec, Program, SpellTag } from '../programs/Program';
import { createEmptyDeck, type SpellDeck } from '../programs/SpellDeck';
import { affectedHexes, validTargets } from '../programs/SpellTargeting';
import {
  BREAK_RULES,
  breachDamageMultiplier,
  damageFirewall,
  firewallDamageForHit,
  tickBreach,
} from './BreakSystem';
import { resolveAttack, type Rng } from './CombatResolver';
import {
  applyHack,
  HACK_RULES,
  hackableHexes,
  hackKindsAt,
  hackRamCost,
  tickTurret,
  TRAP_ID,
  turretHexes,
  turretTarget,
  TURRET_ID,
  type HackKind,
} from './EnvironmentHack';
import { affordablePath, moveRange, stepPlayer } from './Movement';
import {
  createDefensePrompt,
  defenseEffects,
  dodgeDestination,
  type DefensePrompt,
  type DefenseResult,
} from './ReactiveDefense';
import { endPlayerTurn, regenerate, startPlayerTurn, turnOrder } from './TurnManager';

export type CombatPhase = 'LOADOUT' | 'PLAYER_TURN' | 'ENEMY_TURN' | 'VICTORY' | 'DEFEAT';

/** What just happened, for anything that reacts to change rather than state: popups, logs. */
export type CombatEvent =
  | { type: 'moved'; entityId: string; from: HexCoord; to: HexCoord }
  | {
      type: 'attacked';
      attackerId: string;
      targetId: string;
      /** Where the target stood when it was hit. */
      at: HexCoord;
      damage: number;
      dodged: boolean;
      /** The damage was multiplied because the target was breached. */
      amplified: boolean;
    }
  | {
      /** The player answered an attack's prompt with a parry or dodge that worked. */
      type: 'defended';
      kind: DefenseResult['kind'];
      grade: 'perfect' | 'good';
      attackerId: string;
      /** Where the player stood when the attack came in. */
      at: HexCoord;
      apBanked: number;
    }
  | { /** An enemy's firewall hit zero. */ type: 'breached'; entityId: string; at: HexCoord }
  | { /** A breached enemy got its firewall back. */ type: 'recovered'; entityId: string; at: HexCoord }
  | { type: 'turnSkipped'; entityId: string; at: HexCoord; reason: 'breached' | 'stunned' }
  | { /** The player cast a program at `at`. */ type: 'spellCast'; programId: string; programName: string; at: HexCoord }
  | { type: 'stunned'; entityId: string; at: HexCoord; turns: number }
  | { type: 'healed'; entityId: string; at: HexCoord; amount: number }
  | { /** RAM and Qi that came back at the start of the turn. */ type: 'regenerated'; ram: number; qi: number }
  | { /** Something standing on the grid changed: walls, turrets, traps. */ type: 'terrainChanged' }
  | { /** The player hacked the hex at `at`. */ type: 'hacked'; kind: HackKind; at: HexCoord }
  | { type: 'turretFired'; at: HexCoord; targetId: string; targetAt: HexCoord }
  | { /** A turret ran out of turns. */ type: 'turretExpired'; at: HexCoord }
  | { type: 'trapTriggered'; entityId: string; at: HexCoord }
  | { type: 'slowed'; entityId: string; at: HexCoord; turns: number }
  | {
      /** The player turned a breached enemy on one of its allies. */
      type: 'virusInjected';
      entityId: string;
      targetId: string;
      at: HexCoord;
    }
  | { type: 'died'; entityId: string; at: HexCoord }
  | { type: 'phaseChanged'; phase: CombatPhase };

/** One thing the player could do to a hex in hack mode. */
export interface HackOption {
  kind: HackKind;
  apCost: number;
  ramCost: number;
  /** The player has the AP and RAM for it right now. */
  affordable: boolean;
}

/** A card in the player's hand this turn. */
export interface HandCard {
  /** Index of the Active slot the card comes from. */
  slot: number;
  program: Program;
  modifier: Program | null;
  /** The Active as it casts, with the modifier applied. */
  spec: ActiveSpec;
  /** The player has the AP, RAM and Qi to cast it right now. */
  affordable: boolean;
}

/** What a spell would do to one enemy. */
export interface SpellHitPreview {
  enemyId: string;
  at: HexCoord;
  damage: number;
  firewallDamage: number;
  breaches: boolean;
  kills: boolean;
  stunTurns: number;
}

/** What casting a spell at a given hex would do, for showing before the player commits. */
export interface SpellPreview {
  /** Hexes the spell touches. */
  affected: HexCoord[];
  hits: SpellHitPreview[];
  /** Hexes where a temporary wall would go up. */
  walls: HexCoord[];
  /** HP the caster would actually recover. */
  heal: number;
}

/** A cast worked out but not yet applied. Shared by the preview and the cast itself. */
interface SpellPlan {
  program: Program;
  spec: ActiveSpec;
  affected: HexCoord[];
  enemies: Enemy[];
  walls: HexCoord[];
  wallTurns: number;
  heal: number;
  stunTurns: number;
}

/**
 * The combat state machine: (LOADOUT →) PLAYER_TURN → ENEMY_TURN → (check end)
 * → loop, leaving the loop for VICTORY or DEFEAT. A fight can open on LOADOUT,
 * where nothing can happen until the player's deck is chosen.
 *
 * Every method is synchronous and returns the events it caused; an action that
 * is not legal right now changes nothing and returns no events. The enemy turn
 * is exposed one step at a time (start, plan, then apply each action) so the
 * caller can pace it, animate between actions, and run the reactive-defense
 * prompt for an attack before applying it.
 */
export class CombatManager {
  readonly grid: HexGrid;
  readonly player: Player;
  enemies: Enemy[];
  phase: CombatPhase;
  turn = 1;
  deck: SpellDeck;
  /** Bumped whenever temporary walls change, so renderers know to redraw the terrain. */
  terrainVersion = 0;

  private readonly rng: Rng;
  /** Enemies sitting out the current enemy phase. */
  private readonly skipping = new Set<string>();
  /** Enemies that move one hex less during the current enemy phase. */
  private readonly slowed = new Set<string>();

  /**
   * By default the fight starts straight away with `deck`. Pass 'LOADOUT' as
   * `startPhase` to hold it until `startCombat()` supplies the deck.
   */
  constructor(
    room: RoomState,
    rng: Rng = Math.random,
    deck: SpellDeck = createEmptyDeck(),
    startPhase: 'LOADOUT' | 'PLAYER_TURN' = 'PLAYER_TURN',
  ) {
    this.grid = room.grid;
    this.player = room.player;
    this.enemies = room.enemies;
    this.rng = rng;
    this.deck = deck;
    this.phase = startPhase;
    if (startPhase === 'PLAYER_TURN') this.beginFirstTurn();
  }

  /** Leaves the LOADOUT phase with the deck the player chose, and starts turn 1. */
  startCombat(deck: SpellDeck): CombatEvent[] {
    if (this.phase !== 'LOADOUT') return [];
    this.deck = deck;
    this.beginFirstTurn();
    return this.enterPhase('PLAYER_TURN');
  }

  private beginFirstTurn(): void {
    startPlayerTurn(this.player);
    this.deck.drawHand(this.rng);
  }

  // --- Player turn ---------------------------------------------------------

  getMoveRange(): HexCoord[] {
    return this.phase === 'PLAYER_TURN' ? moveRange(this.grid, this.player) : [];
  }

  /** Path the player can afford to `goal`, both ends included; empty if there is none. */
  getPathTo(goal: HexCoord): HexCoord[] {
    return this.phase === 'PLAYER_TURN' ? affordablePath(this.grid, this.player, goal) : [];
  }

  /** Moves the player one hex. */
  stepPlayer(to: HexCoord): CombatEvent[] {
    if (this.phase !== 'PLAYER_TURN') return [];
    const from = this.player.position;
    if (!stepPlayer(this.grid, this.player, to)) return [];
    return [{ type: 'moved', entityId: this.player.id, from, to }];
  }

  /** Enemies the basic attack can hit right now. */
  getAttackableEnemies(): Enemy[] {
    const { apCost, range } = PLAYER_DATA.basicAttack;
    if (this.phase !== 'PLAYER_TURN' || this.player.ap < apCost) return [];
    return this.enemies.filter((enemy) => this.player.position.distance(enemy.position) <= range);
  }

  playerAttack(enemyId: string): CombatEvent[] {
    const enemy = this.getAttackableEnemies().find((candidate) => candidate.id === enemyId);
    if (!enemy) return [];

    this.player.ap -= PLAYER_DATA.basicAttack.apCost;
    const damage = PLAYER_DATA.basicAttack.damage + this.deck.bonuses.basicAttackDamage;
    return [...this.hitEnemy(this.player.id, enemy, damage, null), ...this.checkEnd()];
  }

  // --- Programs ------------------------------------------------------------

  /** The cards drawn this turn that have not been cast yet. */
  getHand(): HandCard[] {
    return this.deck.getHand().flatMap((slot) => {
      const entry = this.deck.slots[slot];
      const spec = this.deck.specOf(slot);
      if (!entry || !spec) return [];
      return [
        {
          slot,
          program: entry.program,
          modifier: entry.modifier,
          spec,
          affordable: this.canAfford(spec),
        },
      ];
    });
  }

  /** Hexes the card in `slot` can be aimed at right now; empty if it cannot be cast. */
  getSpellTargets(slot: number): HexCoord[] {
    const spec = this.castableSpec(slot);
    return spec ? validTargets(this.grid, this.player.position, spec) : [];
  }

  /** What casting the card in `slot` at `target` would do, or null if that cast is not legal. */
  previewSpell(slot: number, target: HexCoord): SpellPreview | null {
    const plan = this.planSpell(slot, target);
    if (!plan) return null;
    return {
      affected: plan.affected,
      walls: plan.walls,
      heal: Math.min(plan.heal, this.player.maxHp - this.player.hp),
      hits: plan.enemies.map((enemy) => this.previewHit(enemy, plan)),
    };
  }

  castSpell(slot: number, target: HexCoord): CombatEvent[] {
    const plan = this.planSpell(slot, target);
    if (!plan) return [];
    const { program, spec } = plan;

    this.player.ap -= spec.apCost;
    this.player.ram -= spec.ramCost;
    this.player.qi -= spec.qiCost;
    this.deck.discard(slot);

    const events: CombatEvent[] = [
      { type: 'spellCast', programId: program.id, programName: program.name, at: target },
    ];

    for (const enemy of plan.enemies) {
      events.push(...this.hitEnemy(this.player.id, enemy, spec.damage, program.tag, spec.firewallBonus));
      const survived = this.enemies.includes(enemy);
      if (survived && plan.stunTurns > 0) {
        enemy.stunTurns = Math.max(enemy.stunTurns, plan.stunTurns);
        events.push({ type: 'stunned', entityId: enemy.id, at: enemy.position, turns: plan.stunTurns });
      }
    }

    if (plan.walls.length > 0) {
      for (const hex of plan.walls) this.grid.placeBarrier(hex, plan.wallTurns);
      events.push(...this.terrainChanged());
    }

    events.push(...this.healPlayer(plan.heal));
    return [...events, ...this.checkEnd()];
  }

  /** Breached enemies the player can afford to inject right now, and that have an ally to turn on. */
  getInjectableEnemies(): Enemy[] {
    const { apCost, ramCost } = BREAK_RULES.injectVirus;
    if (this.phase !== 'PLAYER_TURN') return [];
    if (this.player.ap < apCost || this.player.ram < ramCost) return [];
    return this.enemies.filter((enemy) => enemy.breached && this.nearestAlly(enemy) !== null);
  }

  /** Makes a breached enemy attack its nearest ally once. */
  injectVirus(enemyId: string): CombatEvent[] {
    const enemy = this.getInjectableEnemies().find((candidate) => candidate.id === enemyId);
    const target = enemy ? this.nearestAlly(enemy) : null;
    if (!enemy || !target) return [];

    this.player.ap -= BREAK_RULES.injectVirus.apCost;
    this.player.ram -= BREAK_RULES.injectVirus.ramCost;
    return [
      { type: 'virusInjected', entityId: enemy.id, targetId: target.id, at: enemy.position },
      ...this.hitEnemy(enemy.id, target, enemy.attackDamage, null),
      ...this.checkEnd(),
    ];
  }

  // --- Environment hacks ---------------------------------------------------

  /** Hexes the player could hack right now with at least one hack they can pay for. */
  getHackTargets(): HexCoord[] {
    if (this.phase !== 'PLAYER_TURN') return [];
    return hackableHexes(this.grid, this.player.position).filter((hex) =>
      this.getHackOptions(hex).some((option) => option.affordable),
    );
  }

  /** What the player could do to `hex` in hack mode; empty if it is out of range or not hackable. */
  getHackOptions(hex: HexCoord): HackOption[] {
    if (this.phase !== 'PLAYER_TURN') return [];
    const distance = this.player.position.distance(hex);
    if (distance === 0 || distance > HACK_RULES.range) return [];

    return hackKindsAt(this.grid, hex).map((kind) => {
      const ramCost = hackRamCost(kind);
      return {
        kind,
        apCost: HACK_RULES.apCost,
        ramCost,
        affordable: this.player.ap >= HACK_RULES.apCost && this.player.ram >= ramCost,
      };
    });
  }

  hack(hex: HexCoord, kind: HackKind): CombatEvent[] {
    const option = this.getHackOptions(hex).find((candidate) => candidate.kind === kind);
    if (!option?.affordable) return [];

    this.player.ap -= option.apCost;
    this.player.ram -= option.ramCost;
    applyHack(this.grid, hex, kind);
    return [{ type: 'hacked', kind, at: hex }, ...this.terrainChanged()];
  }

  endPlayerTurn(): CombatEvent[] {
    if (this.phase !== 'PLAYER_TURN') return [];
    endPlayerTurn(this.player);
    this.skipping.clear();
    this.slowed.clear();
    return this.enterPhase('ENEMY_TURN');
  }

  // --- Enemy turn ----------------------------------------------------------

  /** Hexes with a running turret. Each should be fired once, before the enemies act. */
  getTurrets(): HexCoord[] {
    return this.phase === 'ENEMY_TURN' ? turretHexes(this.grid) : [];
  }

  /** One turret's turn: shoot the nearest enemy in range, then wind down by a turn. */
  fireTurret(turretHex: HexCoord): CombatEvent[] {
    if (this.phase !== 'ENEMY_TURN' || this.grid.getCell(turretHex)?.hacked !== 'TURRET') return [];

    const events: CombatEvent[] = [];
    const target = turretTarget(turretHex, this.enemies);
    if (target) {
      events.push({ type: 'turretFired', at: turretHex, targetId: target.id, targetAt: target.position });
      events.push(...this.hitEnemy(TURRET_ID, target, HACK_RULES.turret.damage, null));
    }

    if (tickTurret(this.grid, turretHex)) events.push({ type: 'turretExpired', at: turretHex });
    // The turns left on the turret changed either way, and that is drawn.
    return [...events, ...this.terrainChanged(), ...this.checkEnd()];
  }

  /** Ids of the enemies in the order they act this turn. */
  getEnemyTurnOrder(): string[] {
    return turnOrder(this.enemies).map((enemy) => enemy.id);
  }

  /**
   * Call first when an enemy's turn comes up. Settles anything that happens
   * before it acts: a breached enemy either loses this turn or recovers.
   */
  startEnemyTurn(enemyId: string): CombatEvent[] {
    const enemy = this.findEnemy(enemyId);
    if (!enemy || this.phase !== 'ENEMY_TURN') return [];

    const events: CombatEvent[] = [];
    const breach = tickBreach(enemy);
    if (breach === 'recovered') {
      events.push({ type: 'recovered', entityId: enemy.id, at: enemy.position });
    }

    // A turn lost to a breach also counts against a stun: one skipped turn pays for both.
    const stunned = enemy.stunTurns > 0;
    if (stunned) enemy.stunTurns -= 1;

    if (enemy.slowTurns > 0) {
      enemy.slowTurns -= 1;
      this.slowed.add(enemy.id);
    }

    if (breach === 'skip_turn' || stunned) {
      this.skipping.add(enemy.id);
      events.push({
        type: 'turnSkipped',
        entityId: enemy.id,
        at: enemy.position,
        reason: breach === 'skip_turn' ? 'breached' : 'stunned',
      });
    }
    return events;
  }

  /** What the enemy intends to do, in order. Does not change any state. */
  planEnemyTurn(enemyId: string): EnemyAction[] {
    const enemy = this.findEnemy(enemyId);
    if (!enemy || this.phase !== 'ENEMY_TURN' || this.skipping.has(enemyId)) return [];

    // The AI plans with the enemy as it is this turn: a slowed one covers one hex less.
    const acting = this.slowed.has(enemyId)
      ? { ...enemy, moveRange: Math.max(0, enemy.moveRange - 1) }
      : enemy;
    return planEnemyTurn(acting, { grid: this.grid, player: this.player, rng: this.rng });
  }

  /**
   * The reactive-defense prompt this action gives the player, or null when it
   * is not an attack the player can react to. Does not change any state.
   */
  getDefensePrompt(enemyId: string, action: EnemyAction): DefensePrompt | null {
    const enemy = this.findEnemy(enemyId);
    if (!enemy || this.phase !== 'ENEMY_TURN' || action.type !== 'attack') return null;
    if (!inAttackRange(enemy, enemy.position, this.player.position)) return null;
    return createDefensePrompt(enemy, this.player);
  }

  /**
   * Carries out one planned action. For an attack, `defense` is how the player
   * answered its prompt; leave it out for an attack that went unanswered.
   */
  applyEnemyAction(
    enemyId: string,
    action: EnemyAction,
    defense: DefenseResult | null = null,
  ): CombatEvent[] {
    const enemy = this.findEnemy(enemyId);
    if (!enemy || this.phase !== 'ENEMY_TURN') return [];

    if (action.type === 'move') {
      const from = enemy.position;
      if (from.distance(action.to) !== 1 || this.grid.isBlocked(action.to)) return [];
      this.grid.moveEntity(enemy, action.to);
      return [
        { type: 'moved', entityId: enemy.id, from, to: action.to },
        ...this.springTrap(enemy),
        ...this.checkEnd(),
      ];
    }

    if (!inAttackRange(enemy, enemy.position, this.player.position)) return [];
    return [...this.enemyAttack(enemy, defense), ...this.checkEnd()];
  }

  /** Hands the turn back to the player, unless combat already ended. */
  endEnemyPhase(): CombatEvent[] {
    if (this.phase !== 'ENEMY_TURN') return [];
    const events: CombatEvent[] = [];
    if (this.grid.tickBarriers()) events.push(...this.terrainChanged());

    this.turn += 1;
    startPlayerTurn(this.player);

    const regen = regenerate(this.player, this.deck.bonuses);
    if (regen.ram > 0 || regen.qi > 0) {
      events.push({ type: 'regenerated', ram: regen.ram, qi: regen.qi });
    }
    if (regen.hp > 0) {
      events.push({
        type: 'healed',
        entityId: this.player.id,
        at: this.player.position,
        amount: regen.hp,
      });
    }

    this.deck.drawHand(this.rng);
    return [...events, ...this.enterPhase('PLAYER_TURN')];
  }

  /** An enemy's attack on the player, softened or cancelled by how the player defended. */
  private enemyAttack(enemy: Enemy, defense: DefenseResult | null): CombatEvent[] {
    const effects = defenseEffects(defense);
    const events: CombatEvent[] = [];
    const at = this.player.position;

    if (defense && defense.grade !== 'miss') {
      this.player.apBank += effects.apBank;
      events.push({
        type: 'defended',
        kind: defense.kind,
        grade: defense.grade,
        attackerId: enemy.id,
        at,
        apBanked: effects.apBank,
      });
      // A perfect parry reflects onto the attacker's firewall, and can be what breaks it.
      if (damageFirewall(enemy, effects.firewallDamage)) {
        events.push({ type: 'breached', entityId: enemy.id, at: enemy.position });
      }
    }

    // Whatever damage gets past the defense is resolved like any other hit,
    // so the end-turn dodge chance can still save the player.
    const damage = Math.round(enemy.attackDamage * effects.damageMultiplier);
    if (damage > 0) events.push(...this.hitPlayer(enemy.id, damage));

    if (defense?.direction) {
      for (let hop = 0; hop < effects.teleportHexes; hop++) {
        const from = this.player.position;
        const to = dodgeDestination(this.grid, from, defense.direction, enemy.position);
        if (!to) break;
        this.grid.moveEntity(this.player, to);
        events.push({ type: 'moved', entityId: this.player.id, from, to });
      }
    }
    return events;
  }

  /** If the enemy just stepped onto a trap, sets it off. A trap works once. */
  private springTrap(enemy: Enemy): CombatEvent[] {
    const cell = this.grid.getCell(enemy.position);
    if (!cell || cell.hacked !== 'TRAP') return [];
    cell.hacked = null;

    const events: CombatEvent[] = [
      { type: 'trapTriggered', entityId: enemy.id, at: enemy.position },
      ...this.hitEnemy(TRAP_ID, enemy, HACK_RULES.trap.damage, null),
    ];
    if (this.enemies.includes(enemy)) {
      enemy.slowTurns = Math.max(enemy.slowTurns, HACK_RULES.trap.slowTurns);
      events.push({
        type: 'slowed',
        entityId: enemy.id,
        at: enemy.position,
        turns: HACK_RULES.trap.slowTurns,
      });
    }
    return [...events, ...this.terrainChanged()];
  }

  // --- Shared --------------------------------------------------------------

  private hitPlayer(attackerId: string, damage: number): CombatEvent[] {
    const at = this.player.position;
    // A hit that connects always does at least 1, however much is shaved off.
    const reduced = Math.max(1, damage - this.deck.bonuses.damageReduction);
    const outcome = resolveAttack(this.player, reduced, this.player.dodgeChance, this.rng);

    const events: CombatEvent[] = [
      {
        type: 'attacked',
        attackerId,
        targetId: this.player.id,
        at,
        damage: outcome.damage,
        dodged: outcome.dodged,
        amplified: false,
      },
    ];
    if (outcome.killed) events.push({ type: 'died', entityId: this.player.id, at });
    return events;
  }

  /**
   * One hit on an enemy: damage (amplified if it is breached), then firewall.
   * `tag` is the hit's spell tag, or null for an untagged hit like the basic
   * attack. A hit with no damage (a pure stun, say) still strips firewall.
   */
  private hitEnemy(
    attackerId: string,
    enemy: Enemy,
    baseDamage: number,
    tag: SpellTag | null,
    firewallBonus = 0,
  ): CombatEvent[] {
    const at = enemy.position;
    const events: CombatEvent[] = [];
    // Read before the hit lands: the hit that causes a breach is not itself amplified.
    const firewallDamage = this.firewallDamageOf(enemy, tag, firewallBonus);
    const damage = this.damageTo(enemy, baseDamage);

    if (damage > 0) {
      const outcome = resolveAttack(enemy, damage, 0, this.rng);
      events.push({
        type: 'attacked',
        attackerId,
        targetId: enemy.id,
        at,
        damage: outcome.damage,
        dodged: outcome.dodged,
        amplified: enemy.breached,
      });
      if (outcome.killed) {
        events.push({ type: 'died', entityId: enemy.id, at });
        this.removeEnemy(enemy);
        return events;
      }
    }

    if (damageFirewall(enemy, firewallDamage)) {
      events.push({ type: 'breached', entityId: enemy.id, at });
    }
    return events;
  }

  /** Damage a hit of `baseDamage` does to this enemy right now. */
  private damageTo(enemy: Enemy, baseDamage: number): number {
    return Math.round(baseDamage * breachDamageMultiplier(enemy));
  }

  /** Firewall bars a hit strips from this enemy, with every bonus counted in. */
  private firewallDamageOf(enemy: Enemy, tag: SpellTag | null, bonus: number): number {
    const weaknessBonus = tag === enemy.weakness ? this.deck.bonuses.weaknessFirewallBonus : 0;
    return firewallDamageForHit(enemy, tag) + bonus + weaknessBonus;
  }

  private previewHit(enemy: Enemy, plan: SpellPlan): SpellHitPreview {
    const damage = this.damageTo(enemy, plan.spec.damage);
    const kills = damage >= enemy.hp;
    const stripped = this.firewallDamageOf(enemy, plan.program.tag, plan.spec.firewallBonus);
    // A dead or already-breached enemy has no firewall left to lose.
    const firewallDamage = kills || enemy.breached ? 0 : Math.min(stripped, enemy.firewallCurrent);
    return {
      enemyId: enemy.id,
      at: enemy.position,
      damage,
      firewallDamage,
      breaches: !kills && !enemy.breached && stripped >= enemy.firewallCurrent,
      kills,
      stunTurns: kills ? 0 : plan.stunTurns,
    };
  }

  /** Works out a cast without applying it; null if the cast is not legal right now. */
  private planSpell(slot: number, target: HexCoord): SpellPlan | null {
    const entry = this.deck.slots[slot];
    const spec = this.castableSpec(slot);
    if (!entry || !spec) return null;

    const origin = this.player.position;
    if (!validTargets(this.grid, origin, spec).some((hex) => hex.equals(target))) return null;

    const affected = affectedHexes(this.grid, origin, spec, target);
    const hitsEnemies = spec.targeting === 'ENEMY' || spec.targeting === 'LINE';
    const wall = spec.effects.find((effect) => effect.type === 'createWall');

    let heal = 0;
    let stunTurns = 0;
    for (const effect of spec.effects) {
      if (effect.type === 'heal') heal += effect.amount;
      if (effect.type === 'stun') stunTurns = Math.max(stunTurns, effect.turns);
    }

    return {
      program: entry.program,
      spec,
      affected,
      enemies: hitsEnemies
        ? this.enemies.filter((enemy) => affected.some((hex) => hex.equals(enemy.position)))
        : [],
      walls: wall ? affected : [],
      wallTurns: wall?.turns ?? 0,
      heal,
      stunTurns,
    };
  }

  /** The spec of the card in `slot`, if it is in hand and the player can pay for it. */
  private castableSpec(slot: number): ActiveSpec | null {
    if (!this.deck.inHand(slot)) return null;
    const spec = this.deck.specOf(slot);
    return spec && this.canAfford(spec) ? spec : null;
  }

  private canAfford(spec: ActiveSpec): boolean {
    return (
      this.phase === 'PLAYER_TURN' &&
      this.player.ap >= spec.apCost &&
      this.player.ram >= spec.ramCost &&
      this.player.qi >= spec.qiCost
    );
  }

  /** Restores HP up to the maximum. No event if there was nothing to restore. */
  private healPlayer(amount: number): CombatEvent[] {
    const healed = Math.min(amount, this.player.maxHp - this.player.hp);
    if (healed <= 0) return [];
    this.player.hp += healed;
    return [{ type: 'healed', entityId: this.player.id, at: this.player.position, amount: healed }];
  }

  private terrainChanged(): CombatEvent[] {
    this.terrainVersion += 1;
    return [{ type: 'terrainChanged' }];
  }

  /** The other enemy closest to `enemy`, or null if it is the last one standing. */
  private nearestAlly(enemy: Enemy): Enemy | null {
    let nearest: Enemy | null = null;
    for (const other of this.enemies) {
      if (other === enemy) continue;
      if (!nearest || enemy.position.distance(other.position) < enemy.position.distance(nearest.position)) {
        nearest = other;
      }
    }
    return nearest;
  }

  /**
   * The CHECK_END step. It runs after every hit rather than once per round, so
   * the fight stops the moment the last enemy or the player falls.
   */
  private checkEnd(): CombatEvent[] {
    if (this.player.hp <= 0) return this.enterPhase('DEFEAT');
    if (this.enemies.length === 0) return this.enterPhase('VICTORY');
    return [];
  }

  private enterPhase(phase: CombatPhase): CombatEvent[] {
    this.phase = phase;
    return [{ type: 'phaseChanged', phase }];
  }

  private findEnemy(enemyId: string): Enemy | undefined {
    return this.enemies.find((enemy) => enemy.id === enemyId);
  }

  private removeEnemy(enemy: Enemy): void {
    this.grid.setEntityAt(enemy.position, null);
    this.enemies = this.enemies.filter((other) => other !== enemy);
  }
}
