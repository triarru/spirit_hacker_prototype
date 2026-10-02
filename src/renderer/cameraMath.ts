import type { Point } from '../core/hex/HexCoord';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The scale at which all of `bounds` fits inside `view`, never more than `maxScale`. */
export function fitScale(view: Rect, bounds: Rect, maxScale: number): number {
  return Math.min(view.width / bounds.width, view.height / bounds.height, maxScale);
}

/** Along one axis: `focus`, pulled back so a window `span` wide stays inside [start, start + length]. */
function clampAxis(focus: number, start: number, length: number, span: number): number {
  // Everything fits on this axis: there is nothing to follow, so stay centered.
  if (span >= length) return start + length / 2;
  return Math.min(Math.max(focus, start + span / 2), start + length - span / 2);
}

/**
 * The world point the camera should look at: `focus`, unless centering on it
 * would show past the edge of `bounds`. `scale` is world → screen.
 */
export function clampFocus(focus: Point, bounds: Rect, view: Rect, scale: number): Point {
  return {
    x: clampAxis(focus.x, bounds.x, bounds.width, view.width / scale),
    y: clampAxis(focus.y, bounds.y, bounds.height, view.height / scale),
  };
}

/** Where the world container goes so that the world point `center` sits in the middle of `view`. */
export function worldOffset(view: Rect, center: Point, scale: number): Point {
  return {
    x: view.x + view.width / 2 - center.x * scale,
    y: view.y + view.height / 2 - center.y * scale,
  };
}

/** Moves `from` toward `to`, covering the same fraction of the gap per second at any frame rate. */
export function glide(from: Point, to: Point, ratePerSecond: number, deltaSeconds: number): Point {
  const t = 1 - Math.exp(-ratePerSecond * deltaSeconds);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}
