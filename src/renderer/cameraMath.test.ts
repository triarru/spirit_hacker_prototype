import { describe, expect, it } from 'vitest';
import { clampFocus, fitScale, glide, worldOffset, type Rect } from './cameraMath';

/** The prototype grid, and the part of a 1280x800 canvas left for it. */
const BOUNDS: Rect = { x: -40, y: -34.64, width: 440, height: 658.18 };
const VIEW: Rect = { x: 32, y: 32, width: 1216, height: 582 };

describe('fitScale', () => {
  it('fits the whole grid on its tighter axis', () => {
    const scale = fitScale(VIEW, BOUNDS, 1.5);
    expect(scale).toBeCloseTo(582 / 658.18);
    expect(BOUNDS.width * scale).toBeLessThanOrEqual(VIEW.width);
    expect(BOUNDS.height * scale).toBeCloseTo(VIEW.height);
  });

  it('does not enlarge a small grid past the cap', () => {
    expect(fitScale({ ...VIEW, width: 5000, height: 5000 }, BOUNDS, 1.5)).toBe(1.5);
  });
});

describe('clampFocus', () => {
  const gridCenter = { x: BOUNDS.x + BOUNDS.width / 2, y: BOUNDS.y + BOUNDS.height / 2 };

  it('stays on the center of the grid when everything fits, wherever the focus is', () => {
    const scale = fitScale(VIEW, BOUNDS, 1.5);
    for (const focus of [{ x: 0, y: 0 }, { x: 360, y: 600 }, gridCenter]) {
      const center = clampFocus(focus, BOUNDS, VIEW, scale);
      expect(center.x).toBeCloseTo(gridCenter.x);
      expect(center.y).toBeCloseTo(gridCenter.y);
    }
  });

  it('follows the focus once zoomed in', () => {
    const scale = fitScale(VIEW, BOUNDS, 1.5) * 2.5;
    const focus = { x: 180, y: 300 };
    // Vertically the view is now shorter than the grid, so it tracks the focus.
    expect(clampFocus(focus, BOUNDS, VIEW, scale).y).toBeCloseTo(300);
  });

  it('stops at the edge of the grid instead of showing past it', () => {
    const scale = fitScale(VIEW, BOUNDS, 1.5) * 2.5;
    const halfView = VIEW.height / scale / 2;
    const bottomCorner = { x: 360, y: BOUNDS.y + BOUNDS.height };
    expect(clampFocus(bottomCorner, BOUNDS, VIEW, scale).y).toBeCloseTo(BOUNDS.y + BOUNDS.height - halfView);
    expect(clampFocus({ x: 0, y: -999 }, BOUNDS, VIEW, scale).y).toBeCloseTo(BOUNDS.y + halfView);
  });
});

describe('worldOffset', () => {
  it('puts the centered world point in the middle of the view', () => {
    const scale = 0.8;
    const center = { x: 180, y: 294 };
    const offset = worldOffset(VIEW, center, scale);
    expect(offset.x + center.x * scale).toBeCloseTo(VIEW.x + VIEW.width / 2);
    expect(offset.y + center.y * scale).toBeCloseTo(VIEW.y + VIEW.height / 2);
  });
});

describe('glide', () => {
  it('closes part of the gap each step and never overshoots', () => {
    const to = { x: 100, y: 0 };
    let at = { x: 0, y: 0 };
    let previous = at.x;
    for (let frame = 0; frame < 120; frame++) {
      at = glide(at, to, 8, 1 / 60);
      expect(at.x).toBeGreaterThan(previous);
      expect(at.x).toBeLessThanOrEqual(100);
      previous = at.x;
    }
    expect(at.x).toBeGreaterThan(99.9);
  });

  it('ends up in the same place whatever the frame rate', () => {
    const run = (fps: number): number => {
      let at = { x: 0, y: 0 };
      for (let frame = 0; frame < fps / 2; frame++) at = glide(at, { x: 100, y: 0 }, 8, 1 / fps);
      return at.x;
    };
    expect(run(30)).toBeCloseTo(run(120), 5);
  });

  it('does not move when no time has passed', () => {
    expect(glide({ x: 5, y: 5 }, { x: 100, y: 100 }, 8, 0)).toEqual({ x: 5, y: 5 });
  });
});
