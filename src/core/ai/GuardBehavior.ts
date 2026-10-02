import { canHitFrom } from '../entities/Enemy';
import type { Behavior } from './EnemyAI';

/** Guardian: never leaves its post, and strikes the player when they come within reach. */
export const guardBehavior: Behavior = (enemy, { grid, player }) =>
  canHitFrom(grid, enemy, enemy.position, player.position)
    ? [{ type: 'attack', targetId: player.id }]
    : [];
