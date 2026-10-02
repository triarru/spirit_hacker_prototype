import { describe, expect, it } from 'vitest';
import { loadRoom } from '../data/RoomLoader';
import type { Entity } from '../entities/Entity';
import { HexCoord } from './HexCoord';
import { HexGrid } from './HexGrid';
import { findPath, reachableHexes } from './HexPathfinding';

const at = (col: number, row: number): HexCoord => HexCoord.fromOffset(col, row);

function expectContiguous(path: HexCoord[]): void {
  for (let i = 1; i < path.length; i++) {
    const previous = path[i - 1];
    const current = path[i];
    expect(previous && current && previous.distance(current)).toBe(1);
  }
}

function dummyEnemy(position: HexCoord): Entity {
  return { id: 'e', kind: 'enemy', typeId: 'crawler', name: 'Crawler', position, hp: 1, maxHp: 1, speed: 1 };
}

describe('findPath', () => {
  it('finds a shortest path on an open grid', () => {
    const grid = new HexGrid(7, 9);
    const start = at(3, 8);
    const goal = at(3, 2);
    const path = findPath(grid, start, goal);

    expect(path).toHaveLength(start.distance(goal) + 1);
    expect(path[0]?.equals(start)).toBe(true);
    expect(path.at(-1)?.equals(goal)).toBe(true);
    expectContiguous(path);
  });

  it('returns just the start when start equals goal', () => {
    const grid = new HexGrid(7, 9);
    expect(findPath(grid, at(2, 2), at(2, 2))).toHaveLength(1);
  });

  it('routes around walls', () => {
    const grid = new HexGrid(7, 9);
    for (const col of [1, 2, 3, 4, 5]) grid.setTerrain(at(col, 4), 'WALL');
    const start = at(3, 6);
    const goal = at(3, 2);
    const path = findPath(grid, start, goal);

    expect(path.length).toBeGreaterThan(start.distance(goal) + 1);
    expectContiguous(path);
    for (const hex of path) expect(grid.isWalkable(hex)).toBe(true);
  });

  it('treats an enemy as an obstacle', () => {
    const grid = new HexGrid(1, 3);
    const middle = at(0, 1);
    expect(findPath(grid, at(0, 0), at(0, 2))).toHaveLength(3);

    grid.setEntityAt(middle, dummyEnemy(middle));
    expect(findPath(grid, at(0, 0), at(0, 2))).toEqual([]);
  });

  it('returns an empty path when the goal is blocked, sealed off, or off-grid', () => {
    const grid = new HexGrid(7, 9);
    grid.setTerrain(at(3, 3), 'WALL');
    expect(findPath(grid, at(3, 8), at(3, 3))).toEqual([]);

    for (const neighbor of at(3, 3).neighbors()) grid.setTerrain(neighbor, 'WALL');
    grid.setTerrain(at(3, 3), 'FLOOR');
    expect(findPath(grid, at(3, 8), at(3, 3))).toEqual([]);

    expect(findPath(grid, at(3, 8), at(20, 20))).toEqual([]);
  });

  it('prefers the cheaper route when step costs differ', () => {
    // A 1-wide corridor would force the expensive hex; a 2-wide one lets A* step around it.
    const grid = new HexGrid(2, 5);
    const expensive = at(0, 2);
    const cost = (hex: HexCoord): number => (hex.equals(expensive) ? 5 : 1);
    const path = findPath(grid, at(0, 0), at(0, 4), cost);

    expect(path.some((hex) => hex.equals(expensive))).toBe(false);
    expectContiguous(path);
  });
});

describe('reachableHexes', () => {
  it('matches hexesInRange on an open grid, minus the start', () => {
    const grid = new HexGrid(7, 9);
    const start = at(3, 4);
    expect(reachableHexes(grid, start, 2)).toHaveLength(start.hexesInRange(2).length - 1);
  });

  it('counts the budget along the walked path, not the straight-line distance', () => {
    const grid = new HexGrid(7, 9);
    const start = at(3, 6);
    const behindWall = at(3, 4);
    grid.setTerrain(at(3, 5), 'WALL');
    grid.setTerrain(at(2, 5), 'WALL');
    grid.setTerrain(at(4, 5), 'WALL');

    expect(start.distance(behindWall)).toBe(2);
    expect(reachableHexes(grid, start, 2).some((hex) => hex.equals(behindWall))).toBe(false);
  });

  it('charges step cost against the budget', () => {
    const grid = new HexGrid(1, 4);
    const cost = (hex: HexCoord): number => (hex.equals(at(0, 1)) ? 2 : 1);
    const keys = reachableHexes(grid, at(0, 0), 3, cost).map((hex) => hex.key());

    expect(keys).toEqual([at(0, 1).key(), at(0, 2).key()]);
  });
});

describe('prototype_room', () => {
  const { grid, entities, playerId } = loadRoom('prototype_room');
  const player = entities.find((entity) => entity.id === playerId);

  it('spawns the player and 3 enemies on a 7x9 grid', () => {
    expect(grid.allCells()).toHaveLength(63);
    expect(player).toBeDefined();
    expect(entities.filter((entity) => entity.kind === 'enemy')).toHaveLength(3);
    for (const entity of entities) expect(grid.getEntityAt(entity.position)).toBe(entity);
  });

  it('lets the player reach a hex next to every enemy', () => {
    if (!player) throw new Error('player missing');
    for (const enemy of entities.filter((entity) => entity.kind === 'enemy')) {
      const reachable = enemy.position
        .neighbors()
        .some((hex) => findPath(grid, player.position, hex).length > 0);
      expect(reachable).toBe(true);
    }
  });

  it('forces a detour around the central wall', () => {
    if (!player) throw new Error('player missing');
    const goal = at(3, 4);
    const path = findPath(grid, player.position, goal);
    expect(path.length).toBeGreaterThan(player.position.distance(goal) + 1);
  });
});
