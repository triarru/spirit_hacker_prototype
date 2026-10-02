import { HexCoord, hexToPixel } from '../hex/HexCoord';
import type { HexGrid } from '../hex/HexGrid';
import type { ActiveSpec } from './Program';

const inRange = (spec: ActiveSpec, distance: number): boolean =>
  spec.range === null || distance <= spec.range;

/** A wall can be raised on plain, empty floor only. */
function canHoldWall(grid: HexGrid, hex: HexCoord): boolean {
  return grid.getCell(hex)?.terrain === 'FLOOR' && !grid.isBlocked(hex);
}

/** Every hex the caster standing on `origin` may aim this spell at. */
export function validTargets(grid: HexGrid, origin: HexCoord, spec: ActiveSpec): HexCoord[] {
  if (spec.targeting === 'SELF') return [origin];

  return grid
    .allCells()
    .map((cell) => cell.hex)
    .filter((hex) => {
      const distance = origin.distance(hex);
      if (distance === 0 || !inRange(spec, distance)) return false;
      switch (spec.targeting) {
        case 'ENEMY':
          return grid.getEntityAt(hex)?.kind === 'enemy';
        case 'FLOOR':
          return canHoldWall(grid, hex);
        case 'LINE':
        case 'ANY':
          return true;
        case 'SELF':
          return false;
      }
    });
}

/**
 * The hexes a spell touches when aimed at `target`. For a spell that hits
 * enemies these are the hexes it hits; for a wall spell, where the wall goes.
 */
export function affectedHexes(
  grid: HexGrid,
  origin: HexCoord,
  spec: ActiveSpec,
  target: HexCoord,
): HexCoord[] {
  switch (spec.targeting) {
    case 'SELF':
      return [origin];
    case 'ENEMY':
    case 'ANY':
      return target.hexesInRange(spec.aoe).filter((hex) => grid.has(hex));
    case 'LINE':
      return lineHexes(grid, origin, target, spec.range ?? origin.distance(target));
    case 'FLOOR': {
      const wall = spec.effects.find((effect) => effect.type === 'createWall');
      return wallHexes(grid, origin, target, wall?.count ?? 1);
    }
  }
}

/**
 * A straight line `length` hexes long, starting next to `origin` and heading
 * through `target`. It stops short at solid terrain or the edge of the grid;
 * entities do not stop it.
 */
function lineHexes(grid: HexGrid, origin: HexCoord, target: HexCoord, length: number): HexCoord[] {
  const distance = origin.distance(target);
  if (distance === 0) return [];

  // Push the aim point out to the full length, so aiming at a near hex still fires the whole line.
  const scale = length / distance;
  const far = HexCoord.round(
    origin.q + (target.q - origin.q) * scale,
    origin.r + (target.r - origin.r) * scale,
  );

  const line: HexCoord[] = [];
  for (const hex of origin.lineTo(far).slice(1)) {
    // isWalkable looks at terrain only, so a hex with an enemy on it still counts as open.
    if (!grid.isWalkable(hex)) break;
    line.push(hex);
  }
  return line;
}

/**
 * Up to `count` wall hexes: `target`, then its neighbors going clockwise around
 * the caster at the same distance, so the wall forms an arc facing them. The
 * wall ends early at the first hex that cannot hold one.
 */
function wallHexes(grid: HexGrid, origin: HexCoord, target: HexCoord, count: number): HexCoord[] {
  if (!canHoldWall(grid, target)) return [];

  const center = hexToPixel(origin);
  const angleOf = (hex: HexCoord): number => {
    const point = hexToPixel(hex);
    return Math.atan2(point.y - center.y, point.x - center.x);
  };

  // Screen y points down, so increasing atan2 angle runs clockwise.
  const ring = origin
    .hexesInRange(origin.distance(target))
    .filter((hex) => origin.distance(hex) === origin.distance(target))
    .sort((a, b) => angleOf(a) - angleOf(b));
  const start = ring.findIndex((hex) => hex.equals(target));

  const wall: HexCoord[] = [];
  for (let step = 0; step < Math.min(count, ring.length); step++) {
    const hex = ring[(start + step) % ring.length];
    if (!hex || !canHoldWall(grid, hex)) break;
    wall.push(hex);
  }
  return wall;
}
