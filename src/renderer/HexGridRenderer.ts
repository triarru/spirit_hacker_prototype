import { Container, Graphics } from 'pixi.js';
import { HEX_SIZE, hexCorners, hexToPixel, type HexCoord } from '../core/hex/HexCoord';
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
  private readonly rangeLayer = new Graphics();
  private readonly pathLayer = new Graphics();
  private readonly cursorLayer = new Graphics();

  constructor() {
    this.container.addChild(this.terrainLayer, this.rangeLayer, this.pathLayer, this.cursorLayer);
  }

  drawTerrain(grid: HexGrid): void {
    const g = this.terrainLayer.clear();
    const cells = grid.allCells();

    // Floor outlines first, so the special terrain drawn after sits on top of them.
    for (const cell of cells) {
      g.poly(hexCorners(hexToPixel(cell.hex))).stroke({ width: 1.5, color: COLOR.floorOutline });
    }
    for (const cell of cells) this.drawSpecialTerrain(g, cell);
  }

  drawRanges({ move, spell, attack }: RangeHighlights): void {
    const g = this.rangeLayer.clear();
    // Two translucent tints on one hex blend into mud, so each hex gets only its
    // highest-priority tint: attack target, then spell range, then move range.
    const claimed = new Set<string>();
    for (const [hexes, color] of [
      [attack, COLOR.attackTarget],
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
