import { inAttackRange } from '../entities/Enemy';
import type { HexCoord } from '../hex/HexCoord';
import type { HexGrid } from '../hex/HexGrid';
import { findPath } from '../hex/HexPathfinding';
import type { Behavior, EnemyAction } from './EnemyAI';

/**
 * Shortest path from `from` to any free hex next to `target`. The target's own
 * hex is occupied, so it can never be a path goal itself. Empty if boxed out.
 */
function pathToward(grid: HexGrid, from: HexCoord, target: HexCoord): HexCoord[] {
  let best: HexCoord[] = [];
  for (const goal of target.neighbors()) {
    const path = findPath(grid, from, goal);
    if (path.length > 0 && (best.length === 0 || path.length < best.length)) best = path;
  }
  return best;
}

/** Crawler: closes in on the player, and attacks as soon as they are within reach. */
export const patrolBehavior: Behavior = (enemy, { grid, player }) => {
  const actions: EnemyAction[] = [];
  let position = enemy.position;

  if (!inAttackRange(enemy, position, player.position)) {
    const path = pathToward(grid, position, player.position);
    for (const step of path.slice(1, 1 + enemy.moveRange)) {
      actions.push({ type: 'move', to: step });
      position = step;
      if (inAttackRange(enemy, position, player.position)) break;
    }
  }

  if (inAttackRange(enemy, position, player.position)) {
    actions.push({ type: 'attack', targetId: player.id });
  }
  return actions;
};
