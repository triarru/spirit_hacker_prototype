import type { Player } from '../entities/Player';
import type { HexCoord } from '../hex/HexCoord';
import type { HexGrid } from '../hex/HexGrid';
import { findPath, reachableHexes } from '../hex/HexPathfinding';

/** AP needed to walk a path. The first hex is where the walker already stands, so it is free. */
export function pathCost(grid: HexGrid, path: HexCoord[]): number {
  return path.slice(1).reduce((total, hex) => total + grid.moveCost(hex), 0);
}

/** Every hex the player can walk to with the AP they have left. */
export function moveRange(grid: HexGrid, player: Player): HexCoord[] {
  return reachableHexes(grid, player.position, player.ap, (hex) => grid.moveCost(hex));
}

/**
 * Cheapest path from the player to `goal`, both ends included.
 * Empty when the goal is unreachable or costs more AP than the player has.
 */
export function affordablePath(grid: HexGrid, player: Player, goal: HexCoord): HexCoord[] {
  const path = findPath(grid, player.position, goal, (hex) => grid.moveCost(hex));
  return pathCost(grid, path) <= player.ap ? path : [];
}

/**
 * Moves the player one hex and charges the AP for it.
 * Returns false, changing nothing, when the step is not legal.
 */
export function stepPlayer(grid: HexGrid, player: Player, to: HexCoord): boolean {
  if (player.position.distance(to) !== 1 || grid.isBlocked(to)) return false;

  const cost = grid.moveCost(to);
  if (cost > player.ap) return false;

  grid.moveEntity(player, to);
  player.ap -= cost;
  return true;
}
