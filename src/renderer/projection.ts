import { HEX_SIZE, hexCorners, hexToPixel, pixelToHex, type HexCoord, type Point } from '../core/hex/HexCoord';
import type { HexCell } from '../core/hex/HexGrid';

/**
 * The board is drawn as seen by a camera tilted toward the horizon rather than
 * looking straight down: the floor is foreshortened top to bottom, and whatever
 * stands on it (units, walls) is drawn upright. The game's own geometry in
 * core/ stays flat; this module is the only place that knows about the tilt.
 *
 * 1 would be the old top-down view; smaller is a lower camera.
 */
export const TILT = 0.62;

/** Flat board px → where that point of the floor appears. */
export function project(point: Point): Point {
  return { x: point.x, y: point.y * TILT };
}

/** The floor point that appears at `point`: the inverse of `project`. */
export function unproject(point: Point): Point {
  return { x: point.x, y: point.y / TILT };
}

/** Where the middle of a hex's floor appears. A unit's feet go here. */
export function groundPoint(hex: HexCoord): Point {
  return project(hexToPixel(hex));
}

/** The six corners of a hex's floor as they appear, starting at the right and going clockwise. */
export function groundCorners(hex: HexCoord, size: number = HEX_SIZE): Point[] {
  return hexCorners(hexToPixel(hex), size).map(project);
}

/** The same outline `height` px up: the top of something standing on it. */
export function raise(points: readonly Point[], height: number): Point[] {
  return points.map((point) => ({ x: point.x, y: point.y - height }));
}

/** The hex whose floor is at `point`, ignoring anything standing in front of it. */
export function hexAtGround(point: Point): HexCoord {
  return pixelToHex(unproject(point));
}

/** A unit's body floats this far above its feet, and is about this big, in px. */
export const BODY_LIFT = 22;
export const BODY_RADIUS = 24;
/**
 * How close to the middle of a body a pointer has to be to mean that unit. Less
 * than the body itself, so the middle of the hex right behind it stays clickable.
 */
export const BODY_HIT_RADIUS = 18;

/** The middle of the body of a unit standing on `hex`. Labels and effects aim here. */
export function bodyPoint(hex: HexCoord): Point {
  const feet = groundPoint(hex);
  return { x: feet.x, y: feet.y - BODY_LIFT };
}

/**
 * How tall each kind of thing standing on a hex is drawn, and how much of the
 * hex it covers. Walls are kept low on purpose: any taller and they would
 * cover the middle of the hex behind them, which then could not be clicked.
 */
export const STANDING = {
  wall: { height: 20, size: HEX_SIZE },
  barrier: { height: 20, size: HEX_SIZE - 4 },
  obstacle: { height: 12, size: HEX_SIZE * 0.6 },
  terminal: { height: 16, size: HEX_SIZE * 0.5 },
} as const;

export interface Standing {
  height: number;
  size: number;
}

/** What stands on this cell, as far as drawing and clicking go; null for open floor. */
export function standingOn(cell: HexCell): Standing | null {
  // A temporary wall is raised on open floor, so it never competes with the terrain's own shape.
  if (cell.barrierTurns > 0) return STANDING.barrier;
  switch (cell.terrain) {
    case 'WALL':
      return STANDING.wall;
    case 'OBSTACLE':
      return STANDING.obstacle;
    case 'TERMINAL':
      return STANDING.terminal;
    default:
      return null;
  }
}
