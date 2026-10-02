/** Hex radius in px (center → corner). */
export const HEX_SIZE = 40;

const SQRT3 = Math.sqrt(3);

export interface Point {
  x: number;
  y: number;
}

/** "odd-q" offset coordinate: columns are vertical, odd columns are shoved down half a hex. */
export interface OffsetCoord {
  col: number;
  row: number;
}

/** The 6 neighbor directions in cube space (flat-top), clockwise starting from south-east. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

/**
 * Immutable cube coordinate. Only q and r are stored; s is derived so the
 * q + r + s = 0 constraint can never be violated.
 */
export class HexCoord {
  readonly q: number;
  readonly r: number;

  constructor(q: number, r: number) {
    // `+ 0` turns -0 into 0, which rounding can otherwise produce.
    this.q = q + 0;
    this.r = r + 0;
  }

  get s(): number {
    return -this.q - this.r + 0;
  }

  static fromOffset(col: number, row: number): HexCoord {
    return new HexCoord(col, row - (col - (col & 1)) / 2);
  }

  toOffset(): OffsetCoord {
    return { col: this.q, row: this.r + (this.q - (this.q & 1)) / 2 };
  }

  /** Snap a fractional cube coordinate to the hex that contains it. */
  static round(q: number, r: number): HexCoord {
    const s = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    const rs = Math.round(s);

    const dq = Math.abs(rq - q);
    const dr = Math.abs(rr - r);
    const ds = Math.abs(rs - s);

    // Rounding each axis independently can break q + r + s = 0; recompute the
    // axis that moved the furthest from the other two.
    if (dq > dr && dq > ds) {
      rq = -rr - rs;
    } else if (dr > ds) {
      rr = -rq - rs;
    }
    return new HexCoord(rq, rr);
  }

  /** Stable string id, usable as a Map/Set key. */
  key(): string {
    return `${this.q},${this.r}`;
  }

  equals(other: HexCoord): boolean {
    return this.q === other.q && this.r === other.r;
  }

  distance(other: HexCoord): number {
    return (
      (Math.abs(this.q - other.q) + Math.abs(this.r - other.r) + Math.abs(this.s - other.s)) / 2
    );
  }

  neighbors(): HexCoord[] {
    return DIRECTIONS.map(([dq, dr]) => new HexCoord(this.q + dq, this.r + dr));
  }

  /** All hexes within `n` steps, including this one. */
  hexesInRange(n: number): HexCoord[] {
    const result: HexCoord[] = [];
    for (let dq = -n; dq <= n; dq++) {
      const rMin = Math.max(-n, -dq - n);
      const rMax = Math.min(n, -dq + n);
      for (let dr = rMin; dr <= rMax; dr++) {
        result.push(new HexCoord(this.q + dq, this.r + dr));
      }
    }
    return result;
  }

  /** Hexes on the straight line from this hex to `target`, both ends included. */
  lineTo(target: HexCoord): HexCoord[] {
    const steps = this.distance(target);
    if (steps === 0) return [this];

    // Nudge off the exact center so samples that land on a shared edge always
    // round to the same side instead of flip-flopping.
    const EPSILON = 1e-6;
    const fromQ = this.q + EPSILON;
    const fromR = this.r + EPSILON;
    const toQ = target.q + EPSILON;
    const toR = target.r + EPSILON;

    const result: HexCoord[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      result.push(HexCoord.round(fromQ + (toQ - fromQ) * t, fromR + (toR - fromR) * t));
    }
    return result;
  }
}

/** Center of a hex in pixel space (flat-top). Hex (0, 0) sits at the origin. */
export function hexToPixel(hex: HexCoord, size: number = HEX_SIZE): Point {
  return {
    x: size * 1.5 * hex.q,
    y: size * ((SQRT3 / 2) * hex.q + SQRT3 * hex.r),
  };
}

export function pixelToHex(point: Point, size: number = HEX_SIZE): HexCoord {
  const q = ((2 / 3) * point.x) / size;
  const r = ((-1 / 3) * point.x + (SQRT3 / 3) * point.y) / size;
  return HexCoord.round(q, r);
}

/** The 6 corners of a flat-top hex centered on `center`, starting from the east corner. */
export function hexCorners(center: Point, size: number = HEX_SIZE): Point[] {
  const corners: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    corners.push({
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle),
    });
  }
  return corners;
}
