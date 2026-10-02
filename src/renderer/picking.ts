import type { HexCoord, Point } from '../core/hex/HexCoord';
import type { HexGrid } from '../core/hex/HexGrid';
import {
  BODY_HIT_RADIUS,
  bodyPoint,
  groundCorners,
  groundPoint,
  hexAtGround,
  raise,
  standingOn,
  type Standing,
} from './projection';

/**
 * The outline of an upright block as it appears: the far half of its top,
 * then the near half of its base. Everything inside is that block.
 */
export function silhouette(hex: HexCoord, { height, size }: Standing): Point[] {
  const base = groundCorners(hex, size);
  const top = raise(base, height);
  const [right, lowerRight, lowerLeft, left] = base;
  const [, , , topLeft, topUpperLeft, topUpperRight] = top;
  const topRight = top[0];
  if (!right || !lowerRight || !lowerLeft || !left || !topLeft || !topUpperLeft || !topUpperRight || !topRight) {
    return [];
  }
  return [topLeft, topUpperLeft, topUpperRight, topRight, right, lowerRight, lowerLeft, left];
}

function inside(point: Point, polygon: readonly Point[]): boolean {
  let within = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (!a || !b) continue;
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) within = !within;
  }
  return within;
}

/**
 * The hex a pointer at `point` (in board px, as drawn) means. Because things
 * stand upright, what is under the pointer is not always the floor there: a
 * unit's body and a wall's top cover the hexes behind them. Whatever is
 * nearest the camera wins; with nothing in the way, it is the floor.
 *
 * `units` are the hexes with a unit standing on them.
 */
export function pickHex(point: Point, grid: HexGrid, units: readonly HexCoord[]): HexCoord | null {
  let nearest: { hex: HexCoord; depth: number } | null = null;
  const offer = (hex: HexCoord, depth: number): void => {
    if (!nearest || depth > nearest.depth) nearest = { hex, depth };
  };

  for (const hex of units) {
    const body = bodyPoint(hex);
    if (Math.hypot(point.x - body.x, point.y - body.y) <= BODY_HIT_RADIUS) offer(hex, groundPoint(hex).y);
  }
  for (const cell of grid.allCells()) {
    const standing = standingOn(cell);
    if (standing && inside(point, silhouette(cell.hex, standing))) offer(cell.hex, groundPoint(cell.hex).y);
  }
  // Read through a local: TypeScript does not see the assignments made inside `offer`.
  const hit = nearest as { hex: HexCoord; depth: number } | null;
  if (hit) return hit.hex;

  const floor = hexAtGround(point);
  return grid.has(floor) ? floor : null;
}
