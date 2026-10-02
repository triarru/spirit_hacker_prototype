import type { Rng } from '../combat/CombatResolver';
import type { BehaviorType, Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { HexCoord } from '../hex/HexCoord';
import type { HexGrid } from '../hex/HexGrid';
import { guardBehavior } from './GuardBehavior';
import { patrolBehavior } from './PatrolBehavior';
import { randomBehavior } from './RandomBehavior';

export type EnemyAction =
  | { type: 'move'; to: HexCoord }
  | { type: 'attack'; targetId: string };

export interface AIContext {
  grid: HexGrid;
  player: Player;
  rng: Rng;
}

/**
 * Decides what an enemy does this turn, as an ordered list of actions.
 * A behavior only plans: it must not change the grid or any entity.
 */
export type Behavior = (enemy: Enemy, context: AIContext) => EnemyAction[];

const BEHAVIORS: Record<BehaviorType, Behavior> = {
  patrol: patrolBehavior,
  guard: guardBehavior,
  random: randomBehavior,
};

export function planEnemyTurn(enemy: Enemy, context: AIContext): EnemyAction[] {
  return BEHAVIORS[enemy.behaviorType](enemy, context);
}
