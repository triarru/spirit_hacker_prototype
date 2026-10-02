import { describe, expect, it } from 'vitest';
import { HexCoord, hexToPixel, pixelToHex } from './HexCoord';

describe('HexCoord', () => {
  it('keeps q + r + s = 0', () => {
    const hex = new HexCoord(3, -5);
    expect(hex.q + hex.r + hex.s).toBe(0);
  });

  it('round-trips every offset coordinate of a 7x9 grid', () => {
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row < 9; row++) {
        expect(HexCoord.fromOffset(col, row).toOffset()).toEqual({ col, row });
      }
    }
  });

  it('treats vertically stacked offset cells as adjacent', () => {
    expect(HexCoord.fromOffset(2, 4).distance(HexCoord.fromOffset(2, 5))).toBe(1);
    // Odd columns sit half a hex lower, so (3, 5) touches both (2, 5) and (4, 5).
    expect(HexCoord.fromOffset(3, 5).distance(HexCoord.fromOffset(2, 5))).toBe(1);
    expect(HexCoord.fromOffset(3, 5).distance(HexCoord.fromOffset(4, 5))).toBe(1);
  });

  it('measures distance in steps', () => {
    const origin = new HexCoord(0, 0);
    expect(origin.distance(origin)).toBe(0);
    expect(origin.distance(new HexCoord(3, -1))).toBe(3);
    expect(origin.distance(new HexCoord(-2, -2))).toBe(4);
  });

  it('returns 6 distinct neighbors at distance 1', () => {
    const hex = new HexCoord(2, 1);
    const neighbors = hex.neighbors();
    expect(new Set(neighbors.map((n) => n.key())).size).toBe(6);
    for (const neighbor of neighbors) expect(hex.distance(neighbor)).toBe(1);
  });

  it('returns 1 + 3n(n + 1) hexes in range n', () => {
    const hex = new HexCoord(1, 1);
    for (const n of [0, 1, 2, 3]) {
      const inRange = hex.hexesInRange(n);
      expect(inRange).toHaveLength(1 + 3 * n * (n + 1));
      for (const other of inRange) expect(hex.distance(other)).toBeLessThanOrEqual(n);
    }
  });

  it('draws a contiguous line between two hexes', () => {
    const from = new HexCoord(0, 0);
    const to = new HexCoord(4, -1);
    const line = from.lineTo(to);

    expect(line).toHaveLength(from.distance(to) + 1);
    expect(line[0]?.equals(from)).toBe(true);
    expect(line.at(-1)?.equals(to)).toBe(true);
    for (let i = 1; i < line.length; i++) {
      const previous = line[i - 1];
      const current = line[i];
      expect(previous && current && previous.distance(current)).toBe(1);
    }
  });

  it('round-trips hex → pixel → hex, including points away from the center', () => {
    for (const hex of new HexCoord(0, 0).hexesInRange(4)) {
      const center = hexToPixel(hex);
      expect(pixelToHex(center).equals(hex)).toBe(true);
      // Anywhere within the inscribed circle (radius = size * √3 / 2 ≈ 34.6) is still this hex.
      for (const [dx, dy] of [[30, 0], [-30, 0], [0, 30], [0, -30], [20, 20]] as const) {
        expect(pixelToHex({ x: center.x + dx, y: center.y + dy }).equals(hex)).toBe(true);
      }
    }
  });
});
