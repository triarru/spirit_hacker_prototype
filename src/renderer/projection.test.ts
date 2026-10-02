import { describe, expect, it } from 'vitest';
import { HexCoord, hexToPixel } from '../core/hex/HexCoord';
import { HexGrid } from '../core/hex/HexGrid';
import {
  bodyPoint,
  groundCorners,
  groundPoint,
  hexAtGround,
  project,
  raise,
  STANDING,
  standingOn,
  TILT,
  unproject,
} from './projection';

const at = (col: number, row: number): HexCoord => HexCoord.fromOffset(col, row);

describe('projection', () => {
  it('foreshortens the floor top to bottom and leaves it alone side to side', () => {
    expect(TILT).toBeGreaterThan(0);
    expect(TILT).toBeLessThan(1);
    expect(project({ x: 120, y: 200 })).toEqual({ x: 120, y: 200 * TILT });
  });

  it('can be undone', () => {
    const back = unproject(project({ x: 37, y: 91 }));
    expect(back.x).toBeCloseTo(37);
    expect(back.y).toBeCloseTo(91);
  });

  it('puts every hex of the grid back where it came from', () => {
    for (const cell of new HexGrid(7, 9).allCells()) {
      expect(hexAtGround(groundPoint(cell.hex)).equals(cell.hex)).toBe(true);
    }
  });

  it('keeps hexes in the same row level, and rows further down lower on screen', () => {
    expect(groundPoint(at(0, 3)).y).toBeCloseTo(groundPoint(at(2, 3)).y);
    expect(groundPoint(at(3, 5)).y).toBeGreaterThan(groundPoint(at(3, 4)).y);
    expect(groundPoint(at(3, 4)).x).toBe(hexToPixel(at(3, 4)).x);
  });

  it('gives a hex six floor corners, squashed around its middle', () => {
    const corners = groundCorners(at(3, 4));
    const middle = groundPoint(at(3, 4));
    const heights = corners.map((corner) => Math.abs(corner.y - middle.y));
    const widths = corners.map((corner) => Math.abs(corner.x - middle.x));

    expect(corners).toHaveLength(6);
    expect(Math.max(...heights)).toBeLessThan(Math.max(...widths));
  });

  it('raises an outline straight up', () => {
    expect(raise([{ x: 5, y: 50 }], 20)).toEqual([{ x: 5, y: 30 }]);
  });

  it('puts a unit\'s body above its feet', () => {
    expect(bodyPoint(at(3, 4)).x).toBe(groundPoint(at(3, 4)).x);
    expect(bodyPoint(at(3, 4)).y).toBeLessThan(groundPoint(at(3, 4)).y);
  });
});

describe('standingOn', () => {
  it('is nothing for open floor and floor markings, and a block for walls, terminals and temporary walls', () => {
    const grid = new HexGrid(7, 9);
    grid.setTerrain(at(1, 1), 'WALL');
    grid.setTerrain(at(2, 2), 'TERMINAL');
    grid.setTerrain(at(3, 3), 'VEIL_TEAR');
    grid.placeBarrier(at(4, 4), 3);
    const on = (hex: HexCoord) => {
      const cell = grid.getCell(hex);
      return cell ? standingOn(cell) : undefined;
    };

    expect(on(at(0, 0))).toBeNull();
    expect(on(at(3, 3))).toBeNull();
    expect(on(at(1, 1))).toBe(STANDING.wall);
    expect(on(at(2, 2))).toBe(STANDING.terminal);
    expect(on(at(4, 4))).toBe(STANDING.barrier);
  });
});
