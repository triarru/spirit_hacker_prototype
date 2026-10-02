import type { Entity } from '../entities/Entity';
import { HexCoord, type OffsetCoord } from '../hex/HexCoord';
import { HexGrid, isTerrainType } from '../hex/HexGrid';
import enemiesJson from './enemies.json';
import playerJson from './player.json';
import roomsJson from './rooms.json';

interface EntityDefinition {
  name: string;
  maxHp: number;
  speed: number;
}

interface RoomDefinition {
  cols: number;
  rows: number;
  playerStart: OffsetCoord;
  enemies: Array<OffsetCoord & { type: string }>;
  terrain: Array<OffsetCoord & { type: string }>;
}

const ROOMS: Record<string, RoomDefinition> = roomsJson;
const ENEMIES: Record<string, EntityDefinition> = enemiesJson;

export const PLAYER_ID = 'player';

export interface RoomState {
  grid: HexGrid;
  entities: Entity[];
  playerId: string;
}

/** Builds a fresh grid and entity list from a room definition in rooms.json. */
export function loadRoom(roomId: string): RoomState {
  const room = ROOMS[roomId];
  if (!room) throw new Error(`Unknown room "${roomId}"`);

  const grid = new HexGrid(room.cols, room.rows);

  for (const { type, col, row } of room.terrain) {
    if (!isTerrainType(type)) throw new Error(`Room "${roomId}": unknown terrain "${type}"`);
    grid.setTerrain(HexCoord.fromOffset(col, row), type);
  }

  const entities: Entity[] = [];
  const spawn = (entity: Entity): void => {
    if (grid.isBlocked(entity.position)) {
      const { col, row } = entity.position.toOffset();
      throw new Error(`Room "${roomId}": cannot spawn ${entity.id} on blocked hex (${col}, ${row})`);
    }
    grid.setEntityAt(entity.position, entity);
    entities.push(entity);
  };

  spawn({
    id: PLAYER_ID,
    kind: 'player',
    typeId: 'player',
    name: playerJson.name,
    position: HexCoord.fromOffset(room.playerStart.col, room.playerStart.row),
    hp: playerJson.maxHp,
    maxHp: playerJson.maxHp,
    speed: playerJson.speed,
  });

  room.enemies.forEach(({ type, col, row }, index) => {
    const definition = ENEMIES[type];
    if (!definition) throw new Error(`Room "${roomId}": unknown enemy type "${type}"`);
    spawn({
      id: `${type}_${index}`,
      kind: 'enemy',
      typeId: type,
      name: definition.name,
      position: HexCoord.fromOffset(col, row),
      hp: definition.maxHp,
      maxHp: definition.maxHp,
      speed: definition.speed,
    });
  });

  return { grid, entities, playerId: PLAYER_ID };
}
