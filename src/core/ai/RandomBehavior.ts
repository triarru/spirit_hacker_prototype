import { canHitFrom, inAttackRange } from '../entities/Enemy';
import type { HexCoord } from '../hex/HexCoord';
import type { Behavior, EnemyAction } from './EnemyAI';

/**
 * Ghost Process: drifts to a random free neighbor, then fires if the player is
 * in range and in sight. If the player is in range but a wall is in the way, it
 * takes one more step to try to get a clear shot, and holds fire if it still has none.
 */
export const randomBehavior: Behavior = (enemy, { grid, player, rng }) => {
  const actions: EnemyAction[] = [];
  let position = enemy.position;

  const pick = (options: HexCoord[]): HexCoord | undefined =>
    options[Math.min(Math.floor(rng() * options.length), options.length - 1)];
  const freeNeighbors = (): HexCoord[] => position.neighbors().filter((hex) => !grid.isBlocked(hex));
  const canFireFrom = (from: HexCoord): boolean => canHitFrom(grid, enemy, from, player.position);
  const step = (to: HexCoord | undefined): boolean => {
    if (!to) return false;
    actions.push({ type: 'move', to });
    position = to;
    return true;
  };

  for (let moved = 0; moved < enemy.moveRange; moved++) {
    if (!step(pick(freeNeighbors()))) break;
  }

  const sightBlocked = inAttackRange(enemy, position, player.position) && !canFireFrom(position);
  // A ghost that cannot move this turn (slowed) cannot reposition either.
  if (sightBlocked && enemy.moveRange > 0) {
    const options = freeNeighbors();
    const withClearShot = options.filter(canFireFrom);
    step(pick(withClearShot.length > 0 ? withClearShot : options));
  }

  if (canFireFrom(position)) actions.push({ type: 'attack', targetId: player.id });
  return actions;
};
