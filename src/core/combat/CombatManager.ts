import { planEnemyTurn, type EnemyAction } from '../ai/EnemyAI';
import type { RoomState } from '../data/RoomLoader';
import { inAttackRange, type Enemy } from '../entities/Enemy';
import type { Entity } from '../entities/Entity';
import { PLAYER_DATA, type Player } from '../entities/Player';
import type { HexCoord } from '../hex/HexCoord';
import type { HexGrid } from '../hex/HexGrid';
import { resolveAttack, type Rng } from './CombatResolver';
import { affordablePath, moveRange, stepPlayer } from './Movement';
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
  | { type: 'died'; entityId: string; at: HexCoord }
  | { type: 'phaseChanged'; phase: CombatPhase };

/**
 * The combat state machine: PLAYER_TURN → ENEMY_TURN → (check end) → loop,
 * leaving the loop for VICTORY or DEFEAT.
 *
 * Every method is synchronous and returns the events it caused; an action that
 * is not legal right now changes nothing and returns no events. The enemy turn
 * is exposed one action at a time (plan, then apply) so the caller can pace
 * it, animate between actions, and later ask the player for a reaction.
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

  applyEnemyAction(enemyId: string, action: EnemyAction): CombatEvent[] {
    const enemy = this.findEnemy(enemyId);
    if (!enemy || this.phase !== 'ENEMY_TURN') return [];

    if (action.type === 'move') {
      const from = enemy.position;
      if (from.distance(action.to) !== 1 || this.grid.isBlocked(action.to)) return [];
      this.grid.moveEntity(enemy, action.to);
      return [{ type: 'moved', entityId: enemy.id, from, to: action.to }];
    }

    if (!inAttackRange(enemy, enemy.position, this.player.position)) return [];
    return [...this.attack(enemy, this.player, enemy.attackDamage), ...this.checkEnd()];
  }

  /** Hands the turn back to the player, unless combat already ended. */
  endEnemyPhase(): CombatEvent[] {
    if (this.phase !== 'ENEMY_TURN') return [];
    this.turn += 1;
    startPlayerTurn(this.player);
    return this.enterPhase('PLAYER_TURN');
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
