import { canHitFrom, inAttackRange, moveRangeOf } from '../entities/Enemy';
import type { HexCoord } from '../hex/HexCoord';
import type { Behavior, EnemyAction } from './EnemyAI';
import { pathToward } from './PatrolBehavior';

/**
 * Ghost Process: closes in until it has a shot, then keeps shifting between
 * hexes it can still fire from, so the side the next shot comes from is never
 * known in advance. If the player is in range but a wall is in the way after
 * its move, it takes one more step to try to get a clear shot, and holds fire
 * if it still has none.
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
  /** Where it goes next, or undefined to stay where it is. */
  const nextHex = (): HexCoord | undefined => {
    const options = freeNeighbors();
    const withClearShot = options.filter(canFireFrom);
    if (withClearShot.length > 0) return pick(withClearShot);
    // It has a shot here and every way out would lose it: hold still.
    if (canFireFrom(position)) return undefined;
    // No shot from here or from next door: close the distance, or drift if there is no way through.
    return pathToward(grid, position, player.position)[1] ?? pick(options);
  };

  for (let moved = 0; moved < moveRangeOf(enemy); moved++) {
    if (!step(nextHex())) break;
  }

  const sightBlocked = inAttackRange(enemy, position, player.position) && !canFireFrom(position);
  // A ghost that cannot move this turn (slowed) cannot reposition either.
  if (sightBlocked && moveRangeOf(enemy) > 0) step(nextHex());

  if (canFireFrom(position)) actions.push({ type: 'attack', targetId: player.id });
  return actions;
};
