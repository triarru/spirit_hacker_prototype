import { createEnemy, type Enemy } from '../entities/Enemy';
import type { Entity } from '../entities/Entity';
import { createPlayer, type Player } from '../entities/Player';
import { HexCoord, type OffsetCoord } from '../hex/HexCoord';
import { HexGrid, isTerrainType } from '../hex/HexGrid';
import roomsJson from './rooms.json';

interface RoomDefinition {
  cols: number;
  rows: number;
  playerStart: OffsetCoord;
  enemies: Array<OffsetCoord & { type: string }>;
  terrain: Array<OffsetCoord & { type: string }>;
}

const ROOMS: Record<string, RoomDefinition> = roomsJson;

export interface RoomState {
  grid: HexGrid;
  player: Player;
  enemies: Enemy[];
}

/** Builds a fresh grid and its entities from a room definition in rooms.json. */
export function loadRoom(roomId: string): RoomState {
  const room = ROOMS[roomId];
  if (!room) throw new Error(`Unknown room "${roomId}"`);

  const grid = new HexGrid(room.cols, room.rows);

  for (const { type, col, row } of room.terrain) {
    if (!isTerrainType(type)) throw new Error(`Room "${roomId}": unknown terrain "${type}"`);
    grid.setTerrain(HexCoord.fromOffset(col, row), type);
  }

  const place = <T extends Entity>(entity: T): T => {
    if (grid.isBlocked(entity.position)) {
      const { col, row } = entity.position.toOffset();
      throw new Error(`Room "${roomId}": cannot spawn ${entity.id} on blocked hex (${col}, ${row})`);
    }
    grid.setEntityAt(entity.position, entity);
    return entity;
  };

  const player = place(
    createPlayer(HexCoord.fromOffset(room.playerStart.col, room.playerStart.row)),
  );
  const enemies = room.enemies.map(({ type, col, row }, index) =>
    place(createEnemy(type, `${type}_${index}`, HexCoord.fromOffset(col, row))),
  );

  return { grid, player, enemies };
}
