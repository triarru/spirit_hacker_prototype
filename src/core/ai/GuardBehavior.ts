import { canHitFrom } from '../entities/Enemy';
import type { Behavior } from './EnemyAI';
import { patrolBehavior } from './PatrolBehavior';

/**
 * Guardian: holds its post and strikes the player when they come within
 * reach. Once it has been provoked (see `Enemy.aggressive`) it leaves the post
 * and hunts the player down like a crawler, until it gets its hit in.
 */
export const guardBehavior: Behavior = (enemy, context) => {
  if (enemy.aggressive) return patrolBehavior(enemy, context);

  const { grid, player } = context;
  return canHitFrom(grid, enemy, enemy.position, player.position)
    ? [{ type: 'attack', targetId: player.id }]
    : [];
};
