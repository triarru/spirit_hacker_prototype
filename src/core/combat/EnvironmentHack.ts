import hacksJson from '../data/hacks.json';
import type { Enemy } from '../entities/Enemy';
import type { HexCoord } from '../hex/HexCoord';
import type { HexGrid } from '../hex/HexGrid';

/** Hack rules, straight from hacks.json. */
export const HACK_RULES = hacksJson;

/**
 * What a hack does to a hex:
 * - TURRET:     terminal → fires at the nearest enemy each enemy turn, for a few turns
 * - TRAP:       floor → hurts and slows the first enemy to step on it
 * - WALL:       floor → temporary wall
 * - BREAK_WALL: wall → open floor, for good
 */
export const HACK_KINDS = ['TURRET', 'TRAP', 'WALL', 'BREAK_WALL'] as const;
export type HackKind = (typeof HACK_KINDS)[number];

/** `attackerId` of hits dealt by the environment rather than by an entity. */
export const TURRET_ID = 'turret';
export const TRAP_ID = 'trap';

export function hackRamCost(kind: HackKind): number {
  switch (kind) {
    case 'TURRET':
      return HACK_RULES.turret.ramCost;
    case 'TRAP':
      return HACK_RULES.trap.ramCost;
    case 'WALL':
      return HACK_RULES.wall.ramCost;
    case 'BREAK_WALL':
      return HACK_RULES.breakWall.ramCost;
  }
}

/** The hacks a hex can take, going only by what is on it. Range and cost are not considered. */
export function hackKindsAt(grid: HexGrid, hex: HexCoord): HackKind[] {
  const cell = grid.getCell(hex);
  if (!cell) return [];
  // A temporary wall is a wall like any other: it can be broken.
  if (cell.barrierTurns > 0) return ['BREAK_WALL'];

  switch (cell.terrain) {
    case 'TERMINAL':
      return cell.hacked === null ? ['TURRET'] : [];
    case 'WALL':
      return ['BREAK_WALL'];
    case 'FLOOR':
      return cell.entity === null && cell.hacked === null ? ['TRAP', 'WALL'] : [];
    case 'VEIL_TEAR':
    case 'OBSTACLE':
      return [];
  }
}

/** Every hex within hacking range of `origin` that can take at least one hack. */
export function hackableHexes(grid: HexGrid, origin: HexCoord): HexCoord[] {
  return origin
    .hexesInRange(HACK_RULES.range)
    .filter((hex) => !hex.equals(origin) && hackKindsAt(grid, hex).length > 0);
}

/** Changes the hex. The caller is responsible for having checked that the hack is allowed. */
export function applyHack(grid: HexGrid, hex: HexCoord, kind: HackKind): void {
  const cell = grid.getCell(hex);
  if (!cell) throw new Error(`Hex ${hex.key()} is outside the grid`);

  switch (kind) {
    case 'TURRET':
      cell.hacked = 'TURRET';
      cell.hackTurns = HACK_RULES.turret.turns;
      break;
    case 'TRAP':
      cell.hacked = 'TRAP';
      break;
    case 'WALL':
      grid.placeBarrier(hex, HACK_RULES.wall.turns);
      break;
    case 'BREAK_WALL':
      if (cell.barrierTurns > 0) cell.barrierTurns = 0;
      else grid.setTerrain(hex, 'FLOOR');
      break;
  }
}

/** Hexes with a running turret. */
export function turretHexes(grid: HexGrid): HexCoord[] {
  return grid
    .allCells()
    .filter((cell) => cell.hacked === 'TURRET')
    .map((cell) => cell.hex);
}

/** The enemy a turret on `turretHex` shoots: the nearest one within its range, if any. */
export function turretTarget(turretHex: HexCoord, enemies: readonly Enemy[]): Enemy | null {
  let nearest: Enemy | null = null;
  for (const enemy of enemies) {
    const distance = turretHex.distance(enemy.position);
    if (distance > HACK_RULES.turret.range) continue;
    if (!nearest || distance < turretHex.distance(nearest.position)) nearest = enemy;
  }
  return nearest;
}

/**
 * Winds a turret down by one turn. Returns true when that was its last turn,
 * leaving the terminal free to be hacked again.
 */
export function tickTurret(grid: HexGrid, turretHex: HexCoord): boolean {
  const cell = grid.getCell(turretHex);
  if (!cell || cell.hacked !== 'TURRET') return false;

  cell.hackTurns -= 1;
  if (cell.hackTurns > 0) return false;
  cell.hacked = null;
  cell.hackTurns = 0;
  return true;
}
