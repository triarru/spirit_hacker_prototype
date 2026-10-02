import { canHitFrom, moveRangeOf } from '../entities/Enemy';
import type { HexCoord } from '../hex/HexCoord';
import type { HexGrid } from '../hex/HexGrid';
import { findPath } from '../hex/HexPathfinding';
import type { Behavior, EnemyAction } from './EnemyAI';

/**
 * Shortest path from `from` to any free hex next to `target`. The target's own
 * hex is occupied, so it can never be a path goal itself. Empty if boxed out.
 *
 * With `wallCost`, the path may run through temporary walls, each one costing
 * that many extra steps to break. Without it, they block like any other wall.
 */
export function pathToward(grid: HexGrid, from: HexCoord, target: HexCoord, wallCost?: number): HexCoord[] {
  const breaking = wallCost !== undefined;
  const cost = (hex: HexCoord): number => (breaking && grid.hasBarrier(hex) ? 1 + wallCost : 1);
  const canEnter = (hex: HexCoord): boolean => !grid.isBlocked(hex) || (breaking && grid.hasBarrier(hex));
  const costOf = (path: HexCoord[]): number => path.slice(1).reduce((total, hex) => total + cost(hex), 0);

  let best: HexCoord[] = [];
  for (const goal of target.neighbors()) {
    const path = findPath(grid, from, goal, cost, canEnter);
    if (path.length > 0 && (best.length === 0 || costOf(path) < costOf(best))) best = path;
  }
  return best;
}

/**
 * Crawler (and a provoked Guardian): closes in on the player, and attacks as
 * soon as they are within reach. A temporary wall does not send it the long
 * way round: breaking one costs it the rest of its turn, so it goes through
 * whenever that is quicker than walking around, or the only way in.
 */
export const patrolBehavior: Behavior = (enemy, { grid, player }) => {
  const actions: EnemyAction[] = [];
  let position = enemy.position;

  if (!canHitFrom(grid, enemy, position, player.position)) {
    const reach = moveRangeOf(enemy);
    // A turn spent on a wall is a turn's worth of steps not taken.
    const path = pathToward(grid, position, player.position, reach);
    for (const step of path.slice(1, 1 + reach)) {
      if (grid.hasBarrier(step)) {
        actions.push({ type: 'breakWall', at: step });
        return actions;
      }
      actions.push({ type: 'move', to: step });
      position = step;
      if (canHitFrom(grid, enemy, position, player.position)) break;
    }
  }

  if (canHitFrom(grid, enemy, position, player.position)) {
    actions.push({ type: 'attack', targetId: player.id });
  }
  return actions;
};
