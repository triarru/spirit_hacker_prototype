import type { HexCoord } from './HexCoord';
import type { HexGrid } from './HexGrid';

/**
 * Whether a hex stops a shot passing over it. Walls do, permanent or
 * temporary, and so do obstacles. A terminal is a low object and can be shot
 * over, and entities never block.
 */
function blocksSight(grid: HexGrid, hex: HexCoord): boolean {
  const cell = grid.getCell(hex);
  if (!cell) return false;
  return cell.terrain === 'WALL' || cell.terrain === 'OBSTACLE' || cell.barrierTurns > 0;
}

/** True when no hex strictly between the two ends of the line `from` → `to` blocks sight. */
function isLineClear(grid: HexGrid, from: HexCoord, to: HexCoord): boolean {
  return from
    .lineTo(to)
    .slice(1, -1)
    .every((hex) => !blocksSight(grid, hex));
}

/**
 * Whether a straight shot from one hex reaches the other. The two ends
 * themselves never block.
 *
 * A line that runs exactly along the edge between two hexes can round to
 * either side depending on which end it is drawn from, so both directions are
 * tried: sight is mutual, and one open side is enough.
 */
export function hasLineOfSight(grid: HexGrid, from: HexCoord, to: HexCoord): boolean {
  return isLineClear(grid, from, to) || isLineClear(grid, to, from);
}
