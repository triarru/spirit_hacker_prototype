import { describe, expect, it } from 'vitest';
import { heartbeatSeconds, memoryCells, RAM_BLOCK } from './vitalsMath';

describe('memoryCells', () => {
  it('splits RAM into blocks, filled up to what the player has', () => {
    const cells = memoryCells(55, 100, 0, 0);
    expect(cells).toHaveLength(100 / RAM_BLOCK);
    expect(cells.filter((cell) => cell.fill === 1)).toHaveLength(11);
    expect(cells.slice(11).every((cell) => cell.fill === 0)).toBe(true);
  });

  it('shows a part-used block as part-filled', () => {
    const cells = memoryCells(88, 100, 0, 0);
    expect(cells[17]?.fill).toBeCloseTo(0.6);
    expect(cells[16]?.fill).toBe(1);
  });

  it('marks the blocks the aimed spell would use', () => {
    const cells = memoryCells(55, 100, 25, 0);
    const pending = cells.flatMap((cell, index) => (cell.pending ? [index] : []));
    expect(pending).toEqual([6, 7, 8, 9, 10]);
  });

  it('marks a block the cost only partly reaches', () => {
    const cells = memoryCells(55, 100, 12, 0);
    const pending = cells.flatMap((cell, index) => (cell.pending ? [index] : []));
    // 43 to 55: the top of block 8, all of blocks 9 and 10.
    expect(pending).toEqual([8, 9, 10]);
  });

  it('marks nothing as pending when nothing is aimed', () => {
    expect(memoryCells(55, 100, 0, 0).some((cell) => cell.pending)).toBe(false);
  });

  it('marks the blocks next turn\'s regen will refill, never past the maximum', () => {
    const loading = (ram: number, regen: number) =>
      memoryCells(ram, 100, 0, regen).flatMap((cell, index) => (cell.loading ? [index] : []));
    expect(loading(55, 5)).toEqual([11]);
    expect(loading(55, 10)).toEqual([11, 12]);
    expect(loading(98, 5)).toEqual([19]);
    expect(loading(100, 5)).toEqual([]);
  });
});

describe('heartbeatSeconds', () => {
  it('beats faster as health falls', () => {
    expect(heartbeatSeconds(100, 100)).toBeGreaterThan(heartbeatSeconds(50, 100));
    expect(heartbeatSeconds(50, 100)).toBeGreaterThan(heartbeatSeconds(5, 100));
  });

  it('stays within sensible bounds', () => {
    expect(heartbeatSeconds(100, 100)).toBeCloseTo(2.4);
    expect(heartbeatSeconds(0, 100)).toBeCloseTo(0.8);
    expect(heartbeatSeconds(150, 100)).toBeCloseTo(2.4);
  });
});
