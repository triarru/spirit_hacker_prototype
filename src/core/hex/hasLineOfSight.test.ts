import { describe, expect, it } from 'vitest';
import { at, makeRoom } from '../combat/testRoom';
import { hasLineOfSight } from './hasLineOfSight';
import { HexGrid } from './HexGrid';

describe('hasLineOfSight', () => {
  it('is clear across empty hexes', () => {
    const grid = new HexGrid(7, 9);
    expect(hasLineOfSight(grid, at(3, 2), at(3, 6))).toBe(true);
    expect(hasLineOfSight(grid, at(0, 0), at(6, 8))).toBe(true);
  });

  it('is blocked by a WALL on the line', () => {
    const grid = new HexGrid(7, 9);
    grid.setTerrain(at(3, 4), 'WALL');
    expect(hasLineOfSight(grid, at(3, 2), at(3, 6))).toBe(false);
  });

  it('is not blocked by a TERMINAL: it is low enough to shoot over', () => {
    const grid = new HexGrid(7, 9);
    grid.setTerrain(at(3, 4), 'TERMINAL');
    expect(hasLineOfSight(grid, at(3, 2), at(3, 6))).toBe(true);
  });

  it('is blocked by an OBSTACLE', () => {
    const grid = new HexGrid(7, 9);
    grid.setTerrain(at(3, 4), 'OBSTACLE');
    expect(hasLineOfSight(grid, at(3, 2), at(3, 6))).toBe(false);
  });

  it('is blocked by a temporary wall, until it comes down', () => {
    const grid = new HexGrid(7, 9);
    grid.placeBarrier(at(3, 4), 1);
    expect(hasLineOfSight(grid, at(3, 2), at(3, 6))).toBe(false);

    grid.tickBarriers();
    expect(hasLineOfSight(grid, at(3, 2), at(3, 6))).toBe(true);
  });

  it('ignores a wall that is beside the line rather than on it', () => {
    const grid = new HexGrid(7, 9);
    grid.setTerrain(at(2, 4), 'WALL');
    grid.setTerrain(at(4, 4), 'WALL');
    expect(hasLineOfSight(grid, at(3, 2), at(3, 6))).toBe(true);
  });

  it('is never blocked between neighbors, or by what stands on either end', () => {
    const grid = new HexGrid(7, 9);
    grid.setTerrain(at(3, 3), 'WALL');
    expect(hasLineOfSight(grid, at(3, 4), at(3, 3))).toBe(true);
    expect(hasLineOfSight(grid, at(3, 4), at(3, 5))).toBe(true);
  });

  it('is not blocked by entities standing on the line', () => {
    const { grid } = makeRoom({ player: at(3, 6), enemies: [['crawler', at(3, 4)]] });
    expect(hasLineOfSight(grid, at(3, 2), at(3, 6))).toBe(true);
  });

  it('is mutual: if one end sees the other, the other sees it back', () => {
    const grid = new HexGrid(7, 9);
    for (const wall of [at(2, 3), at(4, 5), at(1, 6), at(5, 2), at(3, 4)]) grid.setTerrain(wall, 'WALL');
    const hexes = grid.allCells().map((cell) => cell.hex);

    for (const a of hexes) {
      for (const b of hexes) {
        expect(hasLineOfSight(grid, a, b)).toBe(hasLineOfSight(grid, b, a));
      }
    }
  });
});
