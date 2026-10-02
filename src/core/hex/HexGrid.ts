import terrainJson from '../data/terrain.json';
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

interface TerrainRule {
  /** An entity can stand here. A terminal is a solid object, so it blocks like a wall. */
  walkable: boolean;
  /** AP spent to step in. Only meaningful for walkable terrain. */
  moveCost?: number;
}

const TERRAIN_RULES: Record<TerrainType, TerrainRule> = terrainJson;

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
    return cell !== undefined && TERRAIN_RULES[cell.terrain].walkable;
  }

  /** Nothing can move into this hex right now: off-grid, solid terrain, or occupied. */
  isBlocked(hex: HexCoord): boolean {
    return !this.isWalkable(hex) || this.getEntityAt(hex) !== null;
  }

  /** AP needed to step into this hex. Infinite for hexes that can never be entered. */
  moveCost(hex: HexCoord): number {
    const cell = this.getCell(hex);
    if (!cell) return Infinity;
    return TERRAIN_RULES[cell.terrain].moveCost ?? Infinity;
  }

  getEntityAt(hex: HexCoord): Entity | null {
    return this.getCell(hex)?.entity ?? null;
  }

  setEntityAt(hex: HexCoord, entity: Entity | null): void {
    this.requireCell(hex).entity = entity;
  }

  /** Relocates an entity, keeping its `position` and the grid's occupancy in step. */
  moveEntity(entity: Entity, to: HexCoord): void {
    const destination = this.requireCell(to);
    this.requireCell(entity.position).entity = null;
    destination.entity = entity;
    entity.position = to;
  }

  private requireCell(hex: HexCoord): HexCell {
    const cell = this.getCell(hex);
    if (!cell) throw new Error(`Hex ${hex.key()} is outside the grid`);
    return cell;
  }
}
