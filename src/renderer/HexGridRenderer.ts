import { Container, Graphics } from 'pixi.js';
import { HEX_SIZE, hexCorners, hexToPixel, type HexCoord, type Point } from '../core/hex/HexCoord';
import type { HexCell, HexGrid } from '../core/hex/HexGrid';

const COLOR = {
  floorOutline: 0x263244,
  wallFill: 0x2a2f3a,
  wallOutline: 0x3b4252,
  obstacleFill: 0x3f3a36,
  terminal: 0x22d3ee,
  veilTear: 0xa855f7,
  moveRange: 0x22c55e,
  spellRange: 0xf97316,
  attackTarget: 0xef4444,
  barrierFill: 0x16303f,
  barrierOutline: 0x38bdf8,
  hackTarget: 0x22d3ee,
  turret: 0x22d3ee,
  trap: 0xfacc15,
  path: 0x7dd3fc,
  hover: 0xe2e8f0,
  selected: 0xfacc15,
} as const;

/** Colored outlines are drawn slightly inside the hex so neighbors' shared edges don't paint over them. */
const INSET = 4;

export interface RangeHighlights {
  /** Hexes the player can walk to (green). */
  move: HexCoord[];
  /** Hexes a spell can reach (orange). */
  spell: HexCoord[];
  /** Hexes holding an enemy that a click would attack (red). */
  attack: HexCoord[];
  /** Hexes the player can hack (cyan). */
  hack: HexCoord[];
}

/** Turret: how far its dot orbits from the hex center (px), and how fast (radians per second). */
const TURRET_ORBIT = { radius: 22, speed: 3.2 } as const;
/** Trap: its glow breathes between these alphas, at this rate (radians per second). */
const TRAP_GLOW = { min: 0.12, max: 0.42, speed: 3 } as const;
const DASH = { length: 7, gap: 5 } as const;

/** Strokes the outline of a polygon as dashes; PixiJS has no dashed line of its own. */
function dashedOutline(g: Graphics, corners: Point[]): void {
  corners.forEach((from, index) => {
    const to = corners[(index + 1) % corners.length];
    if (!to) return;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const unitX = (to.x - from.x) / length;
    const unitY = (to.y - from.y) / length;
    for (let start = 0; start < length; start += DASH.length + DASH.gap) {
      const end = Math.min(start + DASH.length, length);
      g.moveTo(from.x + unitX * start, from.y + unitY * start);
      g.lineTo(from.x + unitX * end, from.y + unitY * end);
    }
  });
}

export interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Draws the grid as stacked layers so cheap, frequent changes (hover) never
 * force a redraw of the expensive, static one (terrain).
 */
export class HexGridRenderer {
  readonly container = new Container();

  private readonly terrainLayer = new Graphics();
  /** The moving parts of hacked hexes: one small Graphics each, animated in `update`. */
  private readonly hackLayer = new Container();
  private readonly rangeLayer = new Graphics();
  private readonly pathLayer = new Graphics();
  private readonly cursorLayer = new Graphics();

  private turretDots: Array<{ dot: Graphics; center: Point }> = [];
  private trapGlows: Graphics[] = [];
  private clock = 0;

  constructor() {
    this.container.addChild(
      this.terrainLayer,
      this.hackLayer,
      this.rangeLayer,
      this.pathLayer,
      this.cursorLayer,
    );
  }

  drawTerrain(grid: HexGrid): void {
    const g = this.terrainLayer.clear();
    const cells = grid.allCells();

    // Floor outlines first, so the special terrain drawn after sits on top of them.
    for (const cell of cells) {
      g.poly(hexCorners(hexToPixel(cell.hex))).stroke({ width: 1.5, color: COLOR.floorOutline });
    }
    for (const cell of cells) this.drawSpecialTerrain(g, cell);
    // Temporary walls sit on top of floor, so they are drawn last. The dashed
    // border marks them as hacked in, not part of the room.
    for (const cell of cells) {
      if (cell.barrierTurns === 0) continue;
      const corners = hexCorners(hexToPixel(cell.hex), HEX_SIZE - INSET);
      g.poly(corners).fill({ color: COLOR.barrierFill });
      dashedOutline(g, corners);
      g.stroke({ width: 2, color: COLOR.barrierOutline });
    }

    this.drawHacks(g, cells);
  }

  /** Advances the turret and trap animations. Call once per frame. */
  update(deltaSeconds: number): void {
    this.clock += deltaSeconds;
    const angle = this.clock * TURRET_ORBIT.speed;
    for (const { dot, center } of this.turretDots) {
      dot.position.set(
        center.x + Math.cos(angle) * TURRET_ORBIT.radius,
        center.y + Math.sin(angle) * TURRET_ORBIT.radius,
      );
    }
    const breath = (Math.sin(this.clock * TRAP_GLOW.speed) + 1) / 2;
    for (const glow of this.trapGlows) {
      glow.alpha = TRAP_GLOW.min + (TRAP_GLOW.max - TRAP_GLOW.min) * breath;
    }
  }

  /** Turrets and traps: the still parts go on the terrain layer, the moving parts get their own Graphics. */
  private drawHacks(g: Graphics, cells: HexCell[]): void {
    for (const child of this.hackLayer.removeChildren()) child.destroy();
    this.turretDots = [];
    this.trapGlows = [];

    for (const cell of cells) {
      const center = hexToPixel(cell.hex);

      if (cell.hacked === 'TURRET') {
        g.circle(center.x, center.y, TURRET_ORBIT.radius).stroke({
          width: 1.5,
          color: COLOR.turret,
          alpha: 0.45,
        });
        // One pip per turn the turret has left.
        for (let turn = 0; turn < cell.hackTurns; turn++) {
          const x = center.x + (turn - (cell.hackTurns - 1) / 2) * 8;
          g.circle(x, center.y + 17, 2.5).fill({ color: COLOR.turret });
        }
        const dot = new Graphics().circle(0, 0, 4.5).fill({ color: COLOR.turret });
        this.hackLayer.addChild(dot);
        this.turretDots.push({ dot, center });
      }

      if (cell.hacked === 'TRAP') {
        const glow = new Graphics().circle(0, 0, 15).fill({ color: COLOR.trap });
        glow.position.set(center.x, center.y);
        this.hackLayer.addChild(glow);
        this.trapGlows.push(glow);
        g.circle(center.x, center.y, 5).fill({ color: COLOR.trap });
      }
    }
    this.update(0);
  }

  drawRanges({ move, spell, attack, hack }: RangeHighlights): void {
    const g = this.rangeLayer.clear();
    // Two translucent tints on one hex blend into mud, so each hex gets only its
    // highest-priority tint: attack target, then hack or spell target, then move range.
    const claimed = new Set<string>();
    for (const [hexes, color] of [
      [attack, COLOR.attackTarget],
      [hack, COLOR.hackTarget],
      [spell, COLOR.spellRange],
      [move, COLOR.moveRange],
    ] as const) {
      this.tint(
        g,
        hexes.filter((hex) => !claimed.has(hex.key())),
        color,
      );
      for (const hex of hexes) claimed.add(hex.key());
    }
  }

  drawPath(path: HexCoord[]): void {
    const g = this.pathLayer.clear();
    const [first, ...rest] = path.map((hex) => hexToPixel(hex));
    if (!first || rest.length === 0) return;

    g.moveTo(first.x, first.y);
    for (const point of rest) g.lineTo(point.x, point.y);
    g.stroke({ width: 4, color: COLOR.path, alpha: 0.85, cap: 'round', join: 'round' });

    for (const point of rest) g.circle(point.x, point.y, 5).fill({ color: COLOR.path });
  }

  drawCursor(hovered: HexCoord | null, selected: HexCoord | null): void {
    const g = this.cursorLayer.clear();
    if (selected) {
      g.poly(hexCorners(hexToPixel(selected), HEX_SIZE - INSET)).stroke({
        width: 3,
        color: COLOR.selected,
      });
    }
    if (hovered) {
      g.poly(hexCorners(hexToPixel(hovered), HEX_SIZE - INSET))
        .fill({ color: COLOR.hover, alpha: 0.06 })
        .stroke({ width: 2, color: COLOR.hover, alpha: 0.9 });
    }
  }

  /** Extent of the whole grid in this container's local pixel space. */
  getBounds(grid: HexGrid): PixelBounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of grid.allCells()) {
      for (const corner of hexCorners(hexToPixel(cell.hex))) {
        minX = Math.min(minX, corner.x);
        minY = Math.min(minY, corner.y);
        maxX = Math.max(maxX, corner.x);
        maxY = Math.max(maxY, corner.y);
      }
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  private tint(g: Graphics, hexes: HexCoord[], color: number): void {
    for (const hex of hexes) {
      g.poly(hexCorners(hexToPixel(hex), HEX_SIZE - INSET))
        .fill({ color, alpha: 0.16 })
        .stroke({ width: 1.5, color, alpha: 0.55 });
    }
  }

  private drawSpecialTerrain(g: Graphics, cell: HexCell): void {
    const center = hexToPixel(cell.hex);
    switch (cell.terrain) {
      case 'FLOOR':
        break;
      case 'WALL':
        g.poly(hexCorners(center))
          .fill({ color: COLOR.wallFill })
          .stroke({ width: 1.5, color: COLOR.wallOutline });
        break;
      case 'OBSTACLE':
        g.poly(hexCorners(center, HEX_SIZE * 0.6)).fill({ color: COLOR.obstacleFill });
        break;
      case 'TERMINAL':
        g.poly(hexCorners(center, HEX_SIZE - INSET)).stroke({ width: 2, color: COLOR.terminal });
        g.rect(center.x - 11, center.y - 8, 22, 16).fill({ color: COLOR.terminal });
        break;
      case 'VEIL_TEAR':
        g.poly(hexCorners(center, HEX_SIZE - INSET))
          .fill({ color: COLOR.veilTear, alpha: 0.14 })
          .stroke({ width: 2, color: COLOR.veilTear });
        g.poly(hexCorners(center, HEX_SIZE * 0.45)).stroke({
          width: 1.5,
          color: COLOR.veilTear,
          alpha: 0.6,
        });
        break;
    }
  }
}
