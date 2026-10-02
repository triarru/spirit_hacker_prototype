import type { Container } from 'pixi.js';
import type { Point } from '../core/hex/HexCoord';
import { clampFocus, fitScale, glide, worldOffset, type Rect } from './cameraMath';

/** The default zoom fits the whole grid, but never blows it up past this scale. */
const MAX_FIT_SCALE = 1.5;
/** How far the player can zoom in, as a multiple of the default zoom. */
const MAX_ZOOM = 2.5;
/** How quickly the camera closes the gap to its target, per second. */
const FOLLOW_RATE = 8;

/**
 * Pans and zooms the world container. It follows a focus point (the player)
 * but never shows past the grid's edge, so at the default zoom, where the
 * whole grid fits, it holds still; zoomed in, it glides after the player.
 */
export class Camera {
  private readonly world: Container;
  /** Multiple of the fit-everything scale; 1 is the default. */
  private zoom = 1;
  /** World point currently at the middle of the view; null until the first update. */
  private center: Point | null = null;

  constructor(world: Container) {
    this.world = world;
  }

  /** Zooms by a factor, within the allowed range. */
  zoomBy(factor: number): void {
    this.zoom = Math.min(Math.max(this.zoom * factor, 1), MAX_ZOOM);
  }

  /** Makes the next update jump straight to its target instead of gliding there. */
  snap(): void {
    this.center = null;
  }

  /**
   * Call once per frame. `view` is the part of the canvas the grid may use,
   * `bounds` the extent of the grid in world px, `focus` the world point to follow.
   */
  update(view: Rect, bounds: Rect, focus: Point, deltaSeconds: number): void {
    const scale = fitScale(view, bounds, MAX_FIT_SCALE) * this.zoom;
    const target = clampFocus(focus, bounds, view, scale);
    this.center = this.center ? glide(this.center, target, FOLLOW_RATE, deltaSeconds) : target;

    const offset = worldOffset(view, this.center, scale);
    this.world.scale.set(scale);
    this.world.position.set(offset.x, offset.y);
  }
}
