import { planEnemyTurn, type EnemyAction } from '../ai/EnemyAI';
import type { RoomState } from '../data/RoomLoader';
import { inAttackRange, type Enemy } from '../entities/Enemy';
import { PLAYER_DATA, type Player } from '../entities/Player';
import type { HexCoord } from '../hex/HexCoord';
import type { HexGrid } from '../hex/HexGrid';
import type { SpellTag } from '../programs/Program';
import {
  BREAK_RULES,
  breachDamageMultiplier,
  damageFirewall,
  firewallDamageForHit,
  tickBreach,
} from './BreakSystem';
import { resolveAttack, type Rng } from './CombatResolver';
import { affordablePath, moveRange, stepPlayer } from './Movement';
import {
  createDefensePrompt,
  defenseEffects,
  dodgeDestination,
  type DefensePrompt,
  type DefenseResult,
} from './ReactiveDefense';
import { endPlayerTurn, startPlayerTurn, turnOrder } from './TurnManager';

export type CombatPhase = 'PLAYER_TURN' | 'ENEMY_TURN' | 'VICTORY' | 'DEFEAT';

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
  | { type: 'turnSkipped'; entityId: string; at: HexCoord; reason: 'breached' }
  | {
      /** The player turned a breached enemy on one of its allies. */
      type: 'virusInjected';
      entityId: string;
      targetId: string;
      at: HexCoord;
    }
  | { type: 'died'; entityId: string; at: HexCoord }
  | { type: 'phaseChanged'; phase: CombatPhase };

/**
 * The combat state machine: PLAYER_TURN → ENEMY_TURN → (check end) → loop,
 * leaving the loop for VICTORY or DEFEAT.
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
  phase: CombatPhase = 'PLAYER_TURN';
  turn = 1;

  private readonly rng: Rng;
  /** Enemies sitting out the current enemy phase. */
  private readonly skipping = new Set<string>();

  constructor(room: RoomState, rng: Rng = Math.random) {
    this.grid = room.grid;
    this.player = room.player;
    this.enemies = room.enemies;
    this.rng = rng;
    startPlayerTurn(this.player);
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
    return [
      ...this.hitEnemy(this.player.id, enemy, PLAYER_DATA.basicAttack.damage, null),
      ...this.checkEnd(),
    ];
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

  endPlayerTurn(): CombatEvent[] {
    if (this.phase !== 'PLAYER_TURN') return [];
    endPlayerTurn(this.player);
    this.skipping.clear();
    return this.enterPhase('ENEMY_TURN');
  }

  // --- Enemy turn ----------------------------------------------------------

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

    switch (tickBreach(enemy)) {
      case 'skip_turn':
        this.skipping.add(enemy.id);
        return [{ type: 'turnSkipped', entityId: enemy.id, at: enemy.position, reason: 'breached' }];
      case 'recovered':
        return [{ type: 'recovered', entityId: enemy.id, at: enemy.position }];
      case 'not_breached':
        return [];
    }
  }

  /** What the enemy intends to do, in order. Does not change any state. */
  planEnemyTurn(enemyId: string): EnemyAction[] {
    const enemy = this.findEnemy(enemyId);
    if (!enemy || this.phase !== 'ENEMY_TURN' || this.skipping.has(enemyId)) return [];
    return planEnemyTurn(enemy, { grid: this.grid, player: this.player, rng: this.rng });
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
      return [{ type: 'moved', entityId: enemy.id, from, to: action.to }];
    }

    if (!inAttackRange(enemy, enemy.position, this.player.position)) return [];
    return [...this.enemyAttack(enemy, defense), ...this.checkEnd()];
  }

  /** Hands the turn back to the player, unless combat already ended. */
  endEnemyPhase(): CombatEvent[] {
    if (this.phase !== 'ENEMY_TURN') return [];
    this.turn += 1;
    startPlayerTurn(this.player);
    return this.enterPhase('PLAYER_TURN');
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

  // --- Shared --------------------------------------------------------------

  private hitPlayer(attackerId: string, damage: number): CombatEvent[] {
    const at = this.player.position;
    const outcome = resolveAttack(this.player, damage, this.player.dodgeChance, this.rng);

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
   * `tag` is the hit's spell tag, or null for an untagged hit like the basic attack.
   */
  private hitEnemy(
    attackerId: string,
    enemy: Enemy,
    baseDamage: number,
    tag: SpellTag | null,
  ): CombatEvent[] {
    const at = enemy.position;
    // Decided before the hit lands: the hit that causes a breach is not itself amplified.
    const multiplier = breachDamageMultiplier(enemy);
    const outcome = resolveAttack(enemy, Math.round(baseDamage * multiplier), 0, this.rng);

    const events: CombatEvent[] = [
      {
        type: 'attacked',
        attackerId,
        targetId: enemy.id,
        at,
        damage: outcome.damage,
        dodged: outcome.dodged,
        amplified: multiplier > 1,
      },
    ];

    if (outcome.killed) {
      events.push({ type: 'died', entityId: enemy.id, at });
      this.removeEnemy(enemy);
    } else if (damageFirewall(enemy, firewallDamageForHit(enemy, tag))) {
      events.push({ type: 'breached', entityId: enemy.id, at });
    }
    return events;
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
