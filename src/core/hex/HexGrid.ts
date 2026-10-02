import type { Entity } from '../entities/Entity';
import { HexCoord } from './HexCoord';

export const TERRAIN_TYPES = ['FLOOR', 'WALL', 'TERMINAL', 'VEIL_TEAR', 'OBSTACLE'] as const;
export type TerrainType = (typeof TERRAIN_TYPES)[number];

export function isTerrainType(value: string): value is TerrainType {
  return (TERRAIN_TYPES as readonly string[]).includes(value);
}

export type HackType = 'TURRET' | 'TRAP' | 'WALL' | 'BREACHED_WALL';

export interface HexCell {
  readonly hex: HexCoord;
  terrain: TerrainType;
  entity: Entity | null;
  hacked: HackType | null;
}

/** Terrain an entity can stand on. A terminal is a solid object, so it blocks like a wall. */
const WALKABLE_TERRAIN: ReadonlySet<TerrainType> = new Set<TerrainType>(['FLOOR', 'VEIL_TEAR']);

/**
 * Rectangular hex grid (flat-top, odd-q offset) addressed by cube coordinates.
 * The grid is the occupancy index: `cell.entity` says who stands where.
 */
export class HexGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly cells = new Map<string, HexCell>();

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const hex = HexCoord.fromOffset(col, row);
        this.cells.set(hex.key(), { hex, terrain: 'FLOOR', entity: null, hacked: null });
      }
    }
  }

  has(hex: HexCoord): boolean {
    return this.cells.has(hex.key());
  }

  getCell(hex: HexCoord): HexCell | undefined {
    return this.cells.get(hex.key());
  }

  allCells(): HexCell[] {
    return [...this.cells.values()];
  }

  setTerrain(hex: HexCoord, terrain: TerrainType): void {
    this.requireCell(hex).terrain = terrain;
  }

  /** Terrain allows standing here. Ignores entities. */
  isWalkable(hex: HexCoord): boolean {
    const cell = this.getCell(hex);
    return cell !== undefined && WALKABLE_TERRAIN.has(cell.terrain);
  }

  /** Nothing can move into this hex right now: off-grid, solid terrain, or occupied. */
  isBlocked(hex: HexCoord): boolean {
    return !this.isWalkable(hex) || this.getEntityAt(hex) !== null;
  }

  getEntityAt(hex: HexCoord): Entity | null {
    return this.getCell(hex)?.entity ?? null;
  }

  setEntityAt(hex: HexCoord, entity: Entity | null): void {
    this.requireCell(hex).entity = entity;
  }

  private requireCell(hex: HexCoord): HexCell {
    const cell = this.getCell(hex);
    if (!cell) throw new Error(`Hex ${hex.key()} is outside the grid`);
    return cell;
  }
}
