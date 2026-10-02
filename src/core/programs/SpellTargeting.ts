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
 * enemies these are the hexes it hits; for a wall spell, where the wall goes,
 * turned `rotation` steps from its default direction.
 */
export function affectedHexes(
  grid: HexGrid,
  origin: HexCoord,
  spec: ActiveSpec,
  target: HexCoord,
  rotation = 0,
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
      return wallHexes(grid, origin, target, wall?.count ?? 1, rotation);
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

/** The six directions a wall can run in from the hex it is aimed at. */
export const WALL_ROTATIONS = 6;

/**
 * Up to `count` wall hexes in a straight row: `target`, then on from it in one
 * of the six hex directions. Unrotated, the row runs clockwise around the
 * caster, so the wall stands across their line to the target; each step of
 * `rotation` turns it 60° clockwise about `target`. The wall ends early at the
 * first hex that cannot hold one.
 */
function wallHexes(
  grid: HexGrid,
  origin: HexCoord,
  target: HexCoord,
  count: number,
  rotation: number,
): HexCoord[] {
  if (!canHoldWall(grid, target)) return [];

  // Screen y points down, so increasing atan2 angle runs clockwise.
  const clockwiseAround = (center: HexCoord, hexes: HexCoord[]): HexCoord[] => {
    const middle = hexToPixel(center);
    const angleOf = (hex: HexCoord): number => {
      const point = hexToPixel(hex);
      return Math.atan2(point.y - middle.y, point.x - middle.x);
    };
    return [...hexes].sort((a, b) => angleOf(a) - angleOf(b));
  };

  // The hex after `target` going clockwise around the caster, at the same distance from them.
  const distance = origin.distance(target);
  const ring = clockwiseAround(
    origin,
    origin.hexesInRange(distance).filter((hex) => origin.distance(hex) === distance),
  );
  const unrotated = ring[(ring.findIndex((hex) => hex.equals(target)) + 1) % ring.length];

  const directions = clockwiseAround(target, target.neighbors());
  const first = Math.max(0, directions.findIndex((hex) => unrotated?.equals(hex)));
  const turns = ((rotation % WALL_ROTATIONS) + WALL_ROTATIONS) % WALL_ROTATIONS;
  const next = directions[(first + turns) % directions.length];
  if (!next) return [target];

  const wall: HexCoord[] = [target];
  for (let step = 1; step < count; step++) {
    const hex = new HexCoord(
      target.q + (next.q - target.q) * step,
      target.r + (next.r - target.r) * step,
    );
    if (!canHoldWall(grid, hex)) break;
    wall.push(hex);
  }
  return wall;
}
