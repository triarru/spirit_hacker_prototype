import { planEnemyTurn, type EnemyAction } from '../ai/EnemyAI';
import type { RoomState } from '../data/RoomLoader';
import { canHitFrom, type Enemy } from '../entities/Enemy';
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
  type MissReason,
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
      /** How far from the mark the input landed: negative is early, positive is late. */
      offBySeconds?: number;
    }
  | {
      /** The player tried to parry or dodge an attack and got it wrong. */
      type: 'defenseMissed';
      kind: DefenseResult['kind'];
      reason: MissReason;
      attackerId: string;
      at: HexCoord;
      /** How far from the mark the input landed: negative is early, positive is late. */
      offBySeconds?: number;
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
  | { /** An enemy smashed the temporary wall at `at`. */ type: 'wallBroken'; entityId: string; at: HexCoord }
  | { type: 'trapTriggered'; entityId: string; at: HexCoord }
  | { type: 'slowed'; entityId: string; at: HexCoord; turns: number }
  | {
      /**
       * An enemy that holds its ground reacted to being hit from range: 'wary'
       * is the warning before it moves, 'aggressive' is it leaving its post,
       * 'guard' is it settling back once it has reached the player. 'last_stand'
       * is different: its last ally fell, and it has left its post for good.
       */
      type: 'stanceShifted';
      entityId: string;
      at: HexCoord;
      stance: 'wary' | 'aggressive' | 'guard' | 'last_stand';
    }
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
  slowTurns: number;
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
  slowTurns: number;
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
  /** Enemies that can move no further during the current enemy phase (a trap went off under them). */
  private readonly interrupted = new Set<string>();

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
    return [
      ...this.hitEnemy(this.player.id, enemy, damage, null),
      ...this.checkEnd(),
    ];
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

  /**
   * What casting the card in `slot` at `target` would do, or null if that cast
   * is not legal. `rotation` turns a wall spell's wall; other spells ignore it.
   */
  previewSpell(slot: number, target: HexCoord, rotation = 0): SpellPreview | null {
    const plan = this.planSpell(slot, target, rotation);
    if (!plan) return null;
    return {
      affected: plan.affected,
      walls: plan.walls,
      heal: Math.min(plan.heal, this.player.maxHp - this.player.hp),
      hits: plan.enemies.map((enemy) => this.previewHit(enemy, plan)),
    };
  }

  castSpell(slot: number, target: HexCoord, rotation = 0): CombatEvent[] {
    const plan = this.planSpell(slot, target, rotation);
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
      events.push(...this.hitEnemy(this.player.id, enemy, spec.damage, spec.tag, spec.firewallBonus));
      const survived = this.enemies.includes(enemy);
      if (survived && plan.stunTurns > 0) {
        enemy.stunTurns = Math.max(enemy.stunTurns, plan.stunTurns);
        events.push({ type: 'stunned', entityId: enemy.id, at: enemy.position, turns: plan.stunTurns });
      }
      if (survived && plan.slowTurns > 0) {
        enemy.slowTurns = Math.max(enemy.slowTurns, plan.slowTurns);
        events.push({ type: 'slowed', entityId: enemy.id, at: enemy.position, turns: plan.slowTurns });
      }
    }

    if (plan.walls.length > 0) {
      for (const hex of plan.walls) this.grid.placeBarrier(hex, plan.wallTurns);
      events.push(...this.terrainChanged());
    }

    events.push(...this.healPlayer(plan.heal));
    return [...events, ...this.checkEnd()];
  }

  /**
   * Breached enemies the player can afford to inject right now, that have an
   * ally to turn on, and that have not already been injected during this breach.
   */
  getInjectableEnemies(): Enemy[] {
    const { apCost, ramCost } = BREAK_RULES.injectVirus;
    if (this.phase !== 'PLAYER_TURN') return [];
    if (this.player.ap < apCost || this.player.ram < ramCost) return [];
    return this.enemies.filter(
      (enemy) => enemy.breached && !enemy.virusInjected && this.nearestAlly(enemy) !== null,
    );
  }

  /**
   * Makes a breached enemy attack its nearest ally once. The blow is forced,
   * not one of the player's own hits: it hurts, but leaves the ally's firewall
   * alone. It does the virus's own damage, whichever enemy carries it out.
   */
  injectVirus(enemyId: string): CombatEvent[] {
    const enemy = this.getInjectableEnemies().find((candidate) => candidate.id === enemyId);
    const target = enemy ? this.nearestAlly(enemy) : null;
    if (!enemy || !target) return [];

    this.player.ap -= BREAK_RULES.injectVirus.apCost;
    this.player.ram -= BREAK_RULES.injectVirus.ramCost;
    enemy.virusInjected = true;
    return [
      { type: 'virusInjected', entityId: enemy.id, targetId: target.id, at: enemy.position },
      ...this.damageEnemy(enemy.id, target, BREAK_RULES.injectVirus.damage),
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
      const discount = kind === 'TRAP' ? this.deck.bonuses.trapRamDiscount : 0;
      const ramCost = Math.max(0, hackRamCost(kind) - discount);
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
    this.interrupted.clear();
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

    // The AI plans with the enemy as it is this turn: a slowed one covers one hex less,
    // whichever of its move ranges is in use.
    const acting: Enemy = this.slowed.has(enemyId)
      ? {
          ...enemy,
          moveRange: Math.max(0, enemy.moveRange - 1),
          aggro: enemy.aggro && {
            ...enemy.aggro,
            moveRange: Math.max(0, enemy.aggro.moveRange - 1),
            lastStandMoveRange:
              enemy.aggro.lastStandMoveRange === null ? null : Math.max(0, enemy.aggro.lastStandMoveRange - 1),
          },
        }
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
    if (!this.canStrike(enemy)) return null;
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
      // A trap held it where it stands: the rest of its movement is off.
      if (this.interrupted.has(enemyId)) return [];
      const from = enemy.position;
      if (from.distance(action.to) !== 1 || this.grid.isBlocked(action.to)) return [];
      this.grid.moveEntity(enemy, action.to);
      return [
        { type: 'moved', entityId: enemy.id, from, to: action.to },
        ...this.springTrap(enemy),
        ...this.checkEnd(),
      ];
    }

    if (action.type === 'breakWall') {
      if (!this.canBreak(enemy, action.at)) return [];
      this.grid.removeBarrier(action.at);
      return [{ type: 'wallBroken', entityId: enemy.id, at: action.at }, ...this.terrainChanged()];
    }

    if (!this.canStrike(enemy)) return [];
    const events = this.enemyAttack(enemy, defense);
    // It came for the player and got its strike in: it settles back into its guard where it
    // stands. Unless it is the last one left: then there is no post to go back to.
    if (enemy.aggressive && enemy.aggro && !enemy.lastStand) {
      enemy.aggressive = false;
      enemy.timesHitFromRange = 0;
      enemy.speed = enemy.aggro.guardSpeed;
      events.push({ type: 'stanceShifted', entityId: enemy.id, at: enemy.position, stance: 'guard' });
    }
    return [...events, ...this.checkEnd()];
  }

  /**
   * Whether a planned action will no longer happen: the enemy is gone, a trap
   * stopped its movement, or its attack no longer has the player in reach.
   * Lets the caller skip it without pausing for it.
   */
  isCancelled(enemyId: string, action: EnemyAction): boolean {
    const enemy = this.findEnemy(enemyId);
    if (!enemy) return true;
    if (action.type === 'move') return this.interrupted.has(enemyId);
    if (action.type === 'breakWall') return !this.canBreak(enemy, action.at);
    return !this.canStrike(enemy);
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
    // Only an input that was actually timed has an offset to report.
    const timing = defense?.offBySeconds === undefined ? {} : { offBySeconds: defense.offBySeconds };

    if (defense && defense.grade !== 'miss') {
      this.player.apBank += effects.apBank;
      events.push({
        type: 'defended',
        kind: defense.kind,
        grade: defense.grade,
        attackerId: enemy.id,
        at,
        apBanked: effects.apBank,
        ...timing,
      });
      // A perfect parry reflects onto the attacker's firewall, and can be what breaks it.
      const reflected = effects.firewallDamage > 0 ? effects.firewallDamage + this.deck.bonuses.parryFirewallBonus : 0;
      if (damageFirewall(enemy, reflected)) {
        events.push({ type: 'breached', entityId: enemy.id, at: enemy.position });
      }
    }

    if (defense?.grade === 'miss' && defense.missedBy) {
      events.push({
        type: 'defenseMissed',
        kind: defense.kind,
        reason: defense.missedBy,
        attackerId: enemy.id,
        at,
        ...timing,
      });
    }

    // Whatever damage gets past the defense is resolved like any other hit,
    // so the end-turn dodge chance can still save the player.
    const damage = Math.round(enemy.attackDamage * effects.damageMultiplier);
    if (damage > 0) events.push(...this.hitPlayer(enemy.id, damage));

    if (defense?.kind === 'dodge') {
      // Only a perfect dodge has any hops to make. Each one goes straight away from the shooter.
      for (let hop = 0; hop < effects.teleportHexes; hop++) {
        const from = this.player.position;
        const to = dodgeDestination(this.grid, from, enemy.position);
        if (!to) break;
        this.grid.moveEntity(this.player, to);
        events.push({ type: 'moved', entityId: this.player.id, from, to });
      }
    }
    return events;
  }

  /**
   * If the enemy just stepped onto a trap, sets it off. The trap also stops
   * the enemy in its tracks: no more movement this turn. It can still strike
   * from where it was stopped, if the player is within its reach there. A
   * trap works once.
   */
  private springTrap(enemy: Enemy): CombatEvent[] {
    const cell = this.grid.getCell(enemy.position);
    if (!cell || cell.hacked !== 'TRAP') return [];
    cell.hacked = null;
    this.interrupted.add(enemy.id);

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

  /**
   * Whether the enemy can attack the player from where it stands right now. One
   * whose firewall went down in the middle of its own turn (a trap) cannot.
   */
  private canStrike(enemy: Enemy): boolean {
    return !enemy.breached && canHitFrom(this.grid, enemy, enemy.position, this.player.position);
  }

  /** Whether the enemy can smash the temporary wall on `hex` from where it stands. */
  private canBreak(enemy: Enemy, hex: HexCoord): boolean {
    return !enemy.breached && enemy.position.distance(hex) === 1 && this.grid.hasBarrier(hex);
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
   * attack. A hit with no damage (a scan, a pure stun) still strips firewall,
   * and still counts as a hit to an enemy that minds being hit from range.
   */
  private hitEnemy(
    attackerId: string,
    enemy: Enemy,
    baseDamage: number,
    tag: SpellTag | null,
    firewallBonus = 0,
  ): CombatEvent[] {
    const at = enemy.position;
    const firewallDamage = this.firewallDamageOf(enemy, tag, firewallBonus);
    // Damage lands before the firewall goes: the hit that causes a breach is not itself amplified.
    const events = this.damageEnemy(attackerId, enemy, baseDamage);
    if (!this.enemies.includes(enemy)) return events;

    if (attackerId === this.player.id) events.push(...this.provoke(enemy));
    if (damageFirewall(enemy, firewallDamage)) {
      events.push({ type: 'breached', entityId: enemy.id, at });
    }
    return events;
  }

  /** The damage half of a hit (amplified if the enemy is breached), and its death if that kills it. */
  private damageEnemy(attackerId: string, enemy: Enemy, baseDamage: number): CombatEvent[] {
    const at = enemy.position;
    const damage = this.damageTo(enemy, baseDamage);
    if (damage <= 0) return [];

    const outcome = resolveAttack(enemy, damage, 0, this.rng);
    const events: CombatEvent[] = [
      {
        type: 'attacked',
        attackerId,
        targetId: enemy.id,
        at,
        damage: outcome.damage,
        dodged: outcome.dodged,
        amplified: enemy.breached,
      },
    ];
    if (outcome.killed) {
      events.push({ type: 'died', entityId: enemy.id, at });
      this.removeEnemy(enemy);
      events.push(...this.rewardKill(), ...this.rallyLastEnemy());
    }
    return events;
  }

  /** What the player gets back whenever an enemy dies, however it died. */
  private rewardKill(): CombatEvent[] {
    const qi = Math.min(this.deck.bonuses.qiPerKill, this.player.maxQi - this.player.qi);
    if (qi <= 0) return [];
    this.player.qi += qi;
    return [{ type: 'regenerated', ram: 0, qi }];
  }

  /**
   * When an enemy's death leaves exactly one standing, and that one normally
   * holds a post, it gives the post up and comes for the player. Without this
   * the player could finish everything else off and then wait, turn after
   * turn, for their resources to come back.
   */
  private rallyLastEnemy(): CombatEvent[] {
    const [last, ...others] = this.enemies;
    if (!last || others.length > 0 || last.lastStand) return [];
    if (!last.aggro || last.aggro.lastStandMoveRange === null) return [];

    last.lastStand = true;
    last.aggressive = true;
    last.speed = last.aggro.speed;
    return [{ type: 'stanceShifted', entityId: last.id, at: last.position, stance: 'last_stand' }];
  }

  /**
   * Counts a hit the player landed from beyond melee range against an enemy
   * that holds its ground, and sends it after the player once it has had
   * enough. Being targeted is what counts, whether or not it hurt. Only the
   * player's own hits count: not a turret's, a trap's, or an infected ally's.
   */
  private provoke(enemy: Enemy): CombatEvent[] {
    if (!enemy.aggro || enemy.aggressive) return [];
    if (this.player.position.distance(enemy.position) <= 1) return [];

    enemy.timesHitFromRange += 1;
    const remaining = enemy.aggro.afterRangedHits - enemy.timesHitFromRange;
    if (remaining > 1) return [];
    if (remaining === 1) {
      return [{ type: 'stanceShifted', entityId: enemy.id, at: enemy.position, stance: 'wary' }];
    }
    enemy.aggressive = true;
    enemy.speed = enemy.aggro.speed;
    return [{ type: 'stanceShifted', entityId: enemy.id, at: enemy.position, stance: 'aggressive' }];
  }

  /** Damage a hit of `baseDamage` does to this enemy right now. */
  private damageTo(enemy: Enemy, baseDamage: number): number {
    return Math.round(baseDamage * breachDamageMultiplier(enemy));
  }

  /**
   * Firewall bars a hit strips from this enemy, with every bonus counted in.
   * Bonus bars cannot be what breaks a firewall that was still intact: unless
   * the hit's own bars are enough for that, it takes a second hit.
   */
  private firewallDamageOf(enemy: Enemy, tag: SpellTag | null, bonus: number): number {
    const weaknessBonus = tag === enemy.weakness ? this.deck.bonuses.weaknessFirewallBonus : 0;
    const base = firewallDamageForHit(enemy, tag);
    const total = base + bonus + weaknessBonus;

    const intact = enemy.firewallCurrent === enemy.firewallMax;
    return intact && base < enemy.firewallMax ? Math.min(total, enemy.firewallMax - 1) : total;
  }

  private previewHit(enemy: Enemy, plan: SpellPlan): SpellHitPreview {
    const damage = this.damageTo(enemy, plan.spec.damage);
    const kills = damage >= enemy.hp;
    const stripped = this.firewallDamageOf(enemy, plan.spec.tag, plan.spec.firewallBonus);
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
      slowTurns: kills ? 0 : plan.slowTurns,
    };
  }

  /** Works out a cast without applying it; null if the cast is not legal right now. */
  private planSpell(slot: number, target: HexCoord, rotation: number): SpellPlan | null {
    const entry = this.deck.slots[slot];
    const spec = this.castableSpec(slot);
    if (!entry || !spec) return null;

    const origin = this.player.position;
    if (!validTargets(this.grid, origin, spec).some((hex) => hex.equals(target))) return null;

    const affected = affectedHexes(this.grid, origin, spec, target, rotation);
    const hitsEnemies = spec.targeting === 'ENEMY' || spec.targeting === 'LINE';
    const wall = spec.effects.find((effect) => effect.type === 'createWall');

    let heal = 0;
    let stunTurns = 0;
    let slowTurns = 0;
    for (const effect of spec.effects) {
      if (effect.type === 'heal') heal += effect.amount;
      if (effect.type === 'stun') stunTurns = Math.max(stunTurns, effect.turns);
      if (effect.type === 'slow') slowTurns = Math.max(slowTurns, effect.turns);
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
      // Only a spell that hits enemies has anyone to slow.
      slowTurns: hitsEnemies ? slowTurns : 0,
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
