import { Container, Graphics, Text } from 'pixi.js';
import { HEX_SIZE, hexToPixel, pixelToHex, type HexCoord, type Point } from '../core/hex/HexCoord';
import type { HexCell, HexGrid } from '../core/hex/HexGrid';
import {
  BODY_LIFT,
  BODY_RADIUS,
  groundCorners,
  groundPoint,
  raise,
  STANDING,
  standingOn,
  TILT,
  type Standing,
} from './projection';

const COLOR = {
  /** Floor tiles vary a little from one to the next, so the platform does not read as one flat sheet. */
  floor: [0x101c27, 0x122030, 0x0f1a24],
  floorOutline: 0x24384a,
  /** The platform's edge, where the floor ends: the faces toward the camera. */
  slab: [0x0a121a, 0x0c1620, 0x091018],
  glow: 0x14b8a6,
  wall: { top: 0x3a4660, sides: [0x1c2434, 0x283248, 0x161d2b], outline: 0x52648a },
  obstacle: { top: 0x4a433d, sides: [0x2a2622, 0x35302b, 0x221f1c], outline: 0x6b6258 },
  terminal: { top: 0x22d3ee, sides: [0x0c2a33, 0x103742, 0x0a222a], outline: 0x22d3ee },
  barrier: { top: 0x38bdf8, sides: [0x38bdf8, 0x38bdf8, 0x38bdf8], outline: 0x7dd3fc },
  terminalRing: 0x22d3ee,
  veilTear: 0xa855f7,
  moveRange: 0x22c55e,
  spellRange: 0xf97316,
  attackTarget: 0xef4444,
  hackTarget: 0x22d3ee,
  turret: 0x22d3ee,
  trap: 0xfacc15,
  path: 0x7dd3fc,
  hover: 0xe2e8f0,
  selected: 0xfacc15,
} as const;

/** Colored outlines are drawn slightly inside the hex so neighbors' shared edges don't paint over them. */
const INSET = 4;
/** How far the platform's edge drops below the floor, in px. */
const SLAB_DEPTH = 14;
/** Room kept above the top row for a unit standing there: its body and the status strip over it. */
const HEADROOM = BODY_LIFT + BODY_RADIUS + 26;

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

/** Turret: how far its dot orbits from the top of the terminal (px), and how fast (radians per second). */
const TURRET_ORBIT = { radius: 22, speed: 3.2, lift: 10 } as const;
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

interface BlockLook {
  top: number;
  /** The three faces toward the camera, left to right. */
  sides: readonly [number, number, number];
  outline: number;
  /** Below 1 for something see-through, like a temporary wall. */
  alpha?: number;
}

/**
 * An upright hexagonal block on the outline `base`: the three faces toward the
 * camera, then its top. Corners 0 to 3 of a hex run right, lower right, lower
 * left, left, so the edges between them are the ones that face the camera.
 */
function drawBlock(g: Graphics, base: Point[], height: number, look: BlockLook): void {
  const top = raise(base, height);
  const alpha = look.alpha ?? 1;
  const faces: Array<[number, number, number]> = [
    [2, 3, look.sides[0]],
    [1, 2, look.sides[1]],
    [0, 1, look.sides[2]],
  ];
  for (const [a, b, color] of faces) {
    const corners = [top[a], top[b], base[b], base[a]].filter((corner): corner is Point => corner !== undefined);
    g.poly(corners).fill({ color, alpha: alpha * 0.9 }).stroke({ width: 1, color: look.outline, alpha: alpha * 0.45 });
  }
  g.poly(top).fill({ color: look.top, alpha }).stroke({ width: 1.5, color: look.outline, alpha: Math.min(1, alpha + 0.4) });
}

/** The hex on the other side of edge `edge` (0 = lower right, going clockwise) of `hex`. */
function neighborAcross(hex: HexCoord, edge: number): HexCoord {
  const center = hexToPixel(hex);
  const angle = (Math.PI / 3) * (edge + 0.5);
  const reach = HEX_SIZE * Math.sqrt(3);
  return pixelToHex({ x: center.x + Math.cos(angle) * reach, y: center.y + Math.sin(angle) * reach });
}

export interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Draws the board as a platform seen from a tilted camera. It is split into
 * layers so cheap, frequent changes (hover) never force a redraw of the
 * expensive, static one (terrain), and so that what stands up can hide what is
 * behind it:
 *
 * - `ground`: the floor and everything flat on it. Goes under all units.
 * - the shared standing layer (given to the constructor): walls, terminals and
 *   temporary walls, depth-sorted together with the units.
 * - `overlay`: highlights for hexes that have something standing on them, drawn
 *   on its top so they are not buried inside it.
 */
export class HexGridRenderer {
  readonly ground = new Container();
  readonly overlay = new Container();

  private readonly standingLayer: Container;
  private readonly terrainLayer = new Graphics();
  /** The moving parts of hacked hexes: one small Graphics each, animated in `update`. */
  private readonly trapLayer = new Container();
  private readonly turretLayer = new Container();
  private readonly rangeLayer = new Graphics();
  private readonly raisedRangeLayer = new Graphics();
  private readonly pathLayer = new Graphics();
  private readonly cursorLayer = new Graphics();
  private readonly raisedCursorLayer = new Graphics();
  /** The AP cost shown at the end of the previewed path. */
  private readonly pathLabel: Text;

  /** What stands on each hex, by hex key, as of the last terrain draw. */
  private standing = new Map<string, Standing>();
  private blocks: Graphics[] = [];
  private turretDots: Array<{ dot: Graphics; center: Point }> = [];
  private trapGlows: Graphics[] = [];
  private clock = 0;

  /** `standingLayer` is depth-sorted by `zIndex`; units live in it too. */
  constructor(standingLayer: Container) {
    this.standingLayer = standingLayer;
    this.pathLabel = new Text({
      text: '',
      style: {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: 13,
        fontWeight: '700',
        fill: COLOR.path,
        stroke: { color: 0x0b0f17, width: 4 },
      },
      resolution: 2,
    });
    this.pathLabel.anchor.set(0.5, 1);
    this.pathLabel.visible = false;

    this.ground.addChild(this.terrainLayer, this.trapLayer, this.rangeLayer, this.pathLayer, this.cursorLayer);
    this.overlay.addChild(this.raisedRangeLayer, this.raisedCursorLayer, this.turretLayer, this.pathLabel);
  }

  drawTerrain(grid: HexGrid): void {
    const g = this.terrainLayer.clear();
    const cells = grid.allCells();

    this.drawGlow(g, grid);
    // The platform's edge first, so the floor tiles drawn after it sit on top.
    for (const cell of cells) this.drawSlabEdge(g, grid, cell);
    for (const cell of cells) {
      const shade = COLOR.floor[Math.abs(cell.hex.q * 7 + cell.hex.r * 13) % COLOR.floor.length];
      g.poly(groundCorners(cell.hex)).fill({ color: shade ?? COLOR.floor[0] }).stroke({
        width: 1.5,
        color: COLOR.floorOutline,
      });
    }
    for (const cell of cells) this.drawFloorMarking(g, cell);

    this.drawBlocks(cells);
    this.drawHacks(g, cells);
  }

  /** Advances the turret and trap animations. Call once per frame. */
  update(deltaSeconds: number): void {
    this.clock += deltaSeconds;
    const angle = this.clock * TURRET_ORBIT.speed;
    for (const { dot, center } of this.turretDots) {
      // A circle lying flat, seen from the tilted camera, is an ellipse.
      dot.position.set(
        center.x + Math.cos(angle) * TURRET_ORBIT.radius,
        center.y + Math.sin(angle) * TURRET_ORBIT.radius * TILT,
      );
    }
    const breath = (Math.sin(this.clock * TRAP_GLOW.speed) + 1) / 2;
    for (const glow of this.trapGlows) {
      glow.alpha = TRAP_GLOW.min + (TRAP_GLOW.max - TRAP_GLOW.min) * breath;
    }
  }

  drawRanges({ move, spell, attack, hack }: RangeHighlights): void {
    const ground = this.rangeLayer.clear();
    const raised = this.raisedRangeLayer.clear();
    // Two translucent tints on one hex blend into mud, so each hex gets only its
    // highest-priority tint: attack target, then hack or spell target, then move range.
    const claimed = new Set<string>();
    for (const [hexes, color] of [
      [attack, COLOR.attackTarget],
      [hack, COLOR.hackTarget],
      [spell, COLOR.spellRange],
      [move, COLOR.moveRange],
    ] as const) {
      for (const hex of hexes) {
        if (claimed.has(hex.key())) continue;
        claimed.add(hex.key());
        const standing = this.standing.get(hex.key());
        (standing ? raised : ground)
          .poly(this.outlineOf(hex))
          .fill({ color, alpha: standing ? 0.3 : 0.16 })
          .stroke({ width: 1.5, color, alpha: standing ? 0.9 : 0.55 });
      }
    }
  }

  /** `apCost` is what walking the path would cost; it is shown at the destination. */
  drawPath(path: HexCoord[], apCost: number): void {
    const g = this.pathLayer.clear();
    const [first, ...rest] = path.map((hex) => groundPoint(hex));
    const last = rest.at(-1);
    this.pathLabel.visible = last !== undefined;
    if (!first || !last) return;

    this.pathLabel.text = `${apCost} AP`;
    this.pathLabel.position.set(last.x, last.y - 10);

    g.moveTo(first.x, first.y);
    for (const point of rest) g.lineTo(point.x, point.y);
    g.stroke({ width: 4, color: COLOR.path, alpha: 0.85, cap: 'round', join: 'round' });

    for (const point of rest) g.ellipse(point.x, point.y, 5, 5 * TILT).fill({ color: COLOR.path });
  }

  drawCursor(hovered: HexCoord | null, selected: HexCoord | null): void {
    const ground = this.cursorLayer.clear();
    const raised = this.raisedCursorLayer.clear();
    const layerFor = (hex: HexCoord): Graphics => (this.standing.has(hex.key()) ? raised : ground);

    if (selected) {
      layerFor(selected).poly(this.outlineOf(selected)).stroke({ width: 3, color: COLOR.selected });
    }
    if (hovered) {
      layerFor(hovered)
        .poly(this.outlineOf(hovered))
        .fill({ color: COLOR.hover, alpha: 0.06 })
        .stroke({ width: 2, color: COLOR.hover, alpha: 0.9 });
    }
  }

  /** Extent of the whole board as drawn, with room for the units on its top row and the edge below. */
  getBounds(grid: HexGrid): PixelBounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of grid.allCells()) {
      for (const corner of groundCorners(cell.hex)) {
        minX = Math.min(minX, corner.x);
        minY = Math.min(minY, corner.y);
        maxX = Math.max(maxX, corner.x);
        maxY = Math.max(maxY, corner.y);
      }
    }
    return { x: minX, y: minY - HEADROOM, width: maxX - minX, height: maxY - minY + HEADROOM + SLAB_DEPTH };
  }

  /** Where a highlight for `hex` goes: on the floor, or on top of what stands there. */
  private outlineOf(hex: HexCoord): Point[] {
    const standing = this.standing.get(hex.key());
    if (!standing) return groundCorners(hex, HEX_SIZE - INSET);
    return raise(groundCorners(hex, Math.min(standing.size, HEX_SIZE - INSET)), standing.height);
  }

  /** A pool of light under the platform, so it does not float in plain black. */
  private drawGlow(g: Graphics, grid: HexGrid): void {
    const bounds = this.floorBounds(grid);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2 + SLAB_DEPTH;
    // Many faint rings rather than a few strong ones, so the falloff reads as light, not as bands.
    const RINGS = 14;
    for (let ring = 0; ring < RINGS; ring++) {
      const scale = 1.05 - (ring / RINGS) * 0.75;
      g.ellipse(centerX, centerY, bounds.width * scale, bounds.height * scale * 0.9).fill({
        color: COLOR.glow,
        alpha: 0.012,
      });
    }
  }

  private floorBounds(grid: HexGrid): PixelBounds {
    const bounds = this.getBounds(grid);
    return { x: bounds.x, y: bounds.y + HEADROOM, width: bounds.width, height: bounds.height - HEADROOM - SLAB_DEPTH };
  }

  /** The faces of the platform's edge under a floor tile with nothing in front of it. */
  private drawSlabEdge(g: Graphics, grid: HexGrid, cell: HexCell): void {
    const corners = groundCorners(cell.hex);
    for (let edge = 0; edge < 3; edge++) {
      if (grid.has(neighborAcross(cell.hex, edge))) continue;
      const from = corners[edge];
      const to = corners[edge + 1];
      if (!from || !to) continue;
      g.poly([from, to, { x: to.x, y: to.y + SLAB_DEPTH }, { x: from.x, y: from.y + SLAB_DEPTH }])
        .fill({ color: COLOR.slab[edge] ?? COLOR.slab[0] })
        .stroke({ width: 1, color: COLOR.floorOutline, alpha: 0.6 });
    }
  }

  /** Terrain that is a marking on the floor rather than something standing on it. */
  private drawFloorMarking(g: Graphics, cell: HexCell): void {
    switch (cell.terrain) {
      case 'TERMINAL':
        g.poly(groundCorners(cell.hex, HEX_SIZE - INSET))
          .fill({ color: COLOR.terminalRing, alpha: 0.08 })
          .stroke({ width: 2, color: COLOR.terminalRing });
        break;
      case 'VEIL_TEAR': {
        const center = groundPoint(cell.hex);
        g.poly(groundCorners(cell.hex, HEX_SIZE - INSET))
          .fill({ color: COLOR.veilTear, alpha: 0.16 })
          .stroke({ width: 2, color: COLOR.veilTear });
        g.ellipse(center.x, center.y, HEX_SIZE * 0.42, HEX_SIZE * 0.42 * TILT).stroke({
          width: 1.5,
          color: COLOR.veilTear,
          alpha: 0.7,
        });
        break;
      }
      default:
        break;
    }
  }

  /** Walls, obstacles, terminals and temporary walls: one Graphics each, so they sort among the units. */
  private drawBlocks(cells: HexCell[]): void {
    for (const block of this.blocks) block.destroy();
    this.blocks = [];
    this.standing = new Map();

    for (const cell of cells) {
      const standing = standingOn(cell);
      if (!standing) continue;
      this.standing.set(cell.hex.key(), standing);

      const g = new Graphics();
      const base = groundCorners(cell.hex, standing.size);
      if (cell.barrierTurns > 0) {
        // See-through, with a dashed rim: hacked in, not part of the room.
        drawBlock(g, base, standing.height, { ...COLOR.barrier, alpha: 0.3 });
        dashedOutline(g, raise(base, standing.height));
        g.stroke({ width: 2, color: COLOR.barrier.outline });
      } else if (cell.terrain === 'TERMINAL') {
        drawBlock(g, base, standing.height, COLOR.terminal);
      } else if (cell.terrain === 'OBSTACLE') {
        drawBlock(g, base, standing.height, COLOR.obstacle);
      } else {
        drawBlock(g, base, standing.height, COLOR.wall);
      }
      // Nearer the camera is lower on screen, and drawn later.
      g.zIndex = groundPoint(cell.hex).y;
      this.standingLayer.addChild(g);
      this.blocks.push(g);
    }
  }

  /** Turrets and traps: the still parts go on the floor, the moving parts get their own Graphics. */
  private drawHacks(g: Graphics, cells: HexCell[]): void {
    for (const child of this.trapLayer.removeChildren()) child.destroy();
    for (const child of this.turretLayer.removeChildren()) child.destroy();
    this.turretDots = [];
    this.trapGlows = [];

    for (const cell of cells) {
      const center = groundPoint(cell.hex);

      if (cell.hacked === 'TURRET') {
        g.ellipse(center.x, center.y, TURRET_ORBIT.radius + 6, (TURRET_ORBIT.radius + 6) * TILT).stroke({
          width: 1.5,
          color: COLOR.turret,
          alpha: 0.45,
        });
        // One pip per turn the turret has left, on the floor in front of it.
        for (let turn = 0; turn < cell.hackTurns; turn++) {
          const x = center.x + (turn - (cell.hackTurns - 1) / 2) * 8;
          g.circle(x, center.y + 15, 2.5).fill({ color: COLOR.turret });
        }
        const dot = new Graphics().circle(0, 0, 4.5).fill({ color: COLOR.turret });
        this.turretLayer.addChild(dot);
        const top = center.y - STANDING.terminal.height - TURRET_ORBIT.lift;
        this.turretDots.push({ dot, center: { x: center.x, y: top } });
      }

      if (cell.hacked === 'TRAP') {
        const glow = new Graphics().ellipse(0, 0, 16, 16 * TILT).fill({ color: COLOR.trap });
        glow.position.set(center.x, center.y);
        this.trapLayer.addChild(glow);
        this.trapGlows.push(glow);
        g.ellipse(center.x, center.y, 5.5, 5.5 * TILT).fill({ color: COLOR.trap });
      }
    }
    this.update(0);
  }
}
