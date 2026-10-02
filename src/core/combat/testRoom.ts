import type { RoomState } from '../data/RoomLoader';
import { createEnemy } from '../entities/Enemy';
import { createPlayer } from '../entities/Player';
import { HexCoord } from '../hex/HexCoord';
import { HexGrid } from '../hex/HexGrid';

/** Offset-coordinate shorthand. */
export const at = (col: number, row: number): HexCoord => HexCoord.fromOffset(col, row);

interface TestRoomOptions {
  cols?: number;
  rows?: number;
  player: HexCoord;
  enemies?: Array<[typeId: string, position: HexCoord]>;
  walls?: HexCoord[];
}

/** Builds a small hand-made room for tests, wired up the same way RoomLoader does it. */
export function makeRoom({
  cols = 7,
  rows = 9,
  player: playerStart,
  enemies: enemySpawns = [],
  walls = [],
}: TestRoomOptions): RoomState {
  const grid = new HexGrid(cols, rows);
  for (const wall of walls) grid.setTerrain(wall, 'WALL');

  const player = createPlayer(playerStart);
  grid.setEntityAt(playerStart, player);

  const enemies = enemySpawns.map(([typeId, position], index) => {
    const enemy = createEnemy(typeId, `${typeId}_${index}`, position);
    grid.setEntityAt(position, enemy);
    return enemy;
  });

  return { grid, player, enemies };
}

/** Small deterministic PRNG (mulberry32), so randomized tests are repeatable. */
export function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
