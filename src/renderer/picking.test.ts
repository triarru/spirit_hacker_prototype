import { describe, expect, it } from 'vitest';
import { HexCoord } from '../core/hex/HexCoord';
import { HexGrid } from '../core/hex/HexGrid';
import { pickHex } from './picking';
import { bodyPoint, groundPoint, STANDING } from './projection';

const at = (col: number, row: number): HexCoord => HexCoord.fromOffset(col, row);
const above = (point: { x: number; y: number }, by: number) => ({ x: point.x, y: point.y - by });

describe('pickHex', () => {
  it('is the floor hex under the pointer when nothing stands in the way', () => {
    const grid = new HexGrid(7, 9);
    for (const cell of grid.allCells()) {
      expect(pickHex(groundPoint(cell.hex), grid, [])?.equals(cell.hex)).toBe(true);
    }
  });

  it('is null off the board', () => {
    expect(pickHex({ x: -500, y: -500 }, new HexGrid(7, 9), [])).toBeNull();
  });

  it('means the unit when the pointer is on its body, even though the body covers the hex behind', () => {
    const grid = new HexGrid(7, 9);
    const unit = at(3, 5);
    // The top of the body is drawn over the floor of the hex one row up.
    const onBody = above(bodyPoint(unit), 14);

    expect(pickHex(onBody, grid, [])?.equals(unit)).toBe(false);
    expect(pickHex(onBody, grid, [unit])?.equals(unit)).toBe(true);
    expect(pickHex(groundPoint(unit), grid, [unit])?.equals(unit)).toBe(true);
  });

  it('still lets the middle of the hex right behind a unit be clicked', () => {
    const grid = new HexGrid(7, 9);
    expect(pickHex(groundPoint(at(3, 4)), grid, [at(3, 5)])?.equals(at(3, 4))).toBe(true);
  });

  it('means the wall when the pointer is on its top or its front', () => {
    const grid = new HexGrid(7, 9);
    const wall = at(3, 5);
    grid.setTerrain(wall, 'WALL');
    const top = above(groundPoint(wall), STANDING.wall.height);

    expect(pickHex(top, grid, [])?.equals(wall)).toBe(true);
    expect(pickHex(above(top, 12), grid, [])?.equals(wall)).toBe(true);
    expect(pickHex(above(groundPoint(wall), -10), grid, [])?.equals(wall)).toBe(true);
  });

  it('still lets the middle of the hex right behind a wall be clicked', () => {
    const grid = new HexGrid(7, 9);
    grid.setTerrain(at(3, 5), 'WALL');
    expect(pickHex(groundPoint(at(3, 4)), grid, [])?.equals(at(3, 4))).toBe(true);
  });

  it('prefers whatever is nearer the camera when two things overlap', () => {
    const grid = new HexGrid(7, 9);
    grid.setTerrain(at(3, 4), 'WALL');
    const front = at(3, 5);
    // A point on the front unit's body that is also inside the outline of the wall behind it.
    const overlap = above(bodyPoint(front), 16);

    expect(pickHex(overlap, grid, [])?.equals(at(3, 4))).toBe(true);
    expect(pickHex(overlap, grid, [front])?.equals(front)).toBe(true);
  });
});
