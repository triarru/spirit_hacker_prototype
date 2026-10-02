import { planEnemyTurn, type EnemyAction } from '../ai/EnemyAI';
import type { RoomState } from '../data/RoomLoader';
import { inAttackRange, type Enemy } from '../entities/Enemy';
import type { Entity } from '../entities/Entity';
import { PLAYER_DATA, type Player } from '../entities/Player';
import type { HexCoord } from '../hex/HexCoord';
import type { HexGrid } from '../hex/HexGrid';
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
  | { type: 'died'; entityId: string; at: HexCoord }
  | { type: 'phaseChanged'; phase: CombatPhase };

/**
 * The combat state machine: PLAYER_TURN → ENEMY_TURN → (check end) → loop,
 * leaving the loop for VICTORY or DEFEAT.
 *
 * Every method is synchronous and returns the events it caused; an action that
 * is not legal right now changes nothing and returns no events. The enemy turn
 * is exposed one action at a time (plan, then apply) so the caller can pace
 * it, animate between actions, and run the reactive-defense prompt for an
 * attack before applying it.
 */
export class CombatManager {
  readonly grid: HexGrid;
  readonly player: Player;
  enemies: Enemy[];
  phase: CombatPhase = 'PLAYER_TURN';
  turn = 1;

  private readonly rng: Rng;

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
      ...this.attack(this.player, enemy, PLAYER_DATA.basicAttack.damage),
      ...this.checkEnd(),
    ];
  }

  endPlayerTurn(): CombatEvent[] {
    if (this.phase !== 'PLAYER_TURN') return [];
    endPlayerTurn(this.player);
    return this.enterPhase('ENEMY_TURN');
  }

  // --- Enemy turn ----------------------------------------------------------

  /** Ids of the enemies in the order they act this turn. */
  getEnemyTurnOrder(): string[] {
    return turnOrder(this.enemies).map((enemy) => enemy.id);
  }

  /** What the enemy intends to do, in order. Does not change any state. */
  planEnemyTurn(enemyId: string): EnemyAction[] {
    const enemy = this.findEnemy(enemyId);
    if (!enemy || this.phase !== 'ENEMY_TURN') return [];
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
      enemy.firewallCurrent = Math.max(0, enemy.firewallCurrent - effects.firewallDamage);
      events.push({
        type: 'defended',
        kind: defense.kind,
        grade: defense.grade,
        attackerId: enemy.id,
        at,
        apBanked: effects.apBank,
      });
    }

    // Whatever damage gets past the defense is resolved like any other hit,
    // so the end-turn dodge chance can still save the player.
    const damage = Math.round(enemy.attackDamage * effects.damageMultiplier);
    if (damage > 0) events.push(...this.attack(enemy, this.player, damage));

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

  private attack(attacker: Entity, target: Player | Enemy, damage: number): CombatEvent[] {
    const at = target.position;
    const dodgeChance = target.kind === 'player' ? target.dodgeChance : 0;
    const outcome = resolveAttack(target, damage, dodgeChance, this.rng);

    const events: CombatEvent[] = [
      {
        type: 'attacked',
        attackerId: attacker.id,
        targetId: target.id,
        at,
        damage: outcome.damage,
        dodged: outcome.dodged,
      },
    ];
    if (outcome.killed) {
      events.push({ type: 'died', entityId: target.id, at });
      if (target.kind === 'enemy') this.removeEnemy(target);
    }
    return events;
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
