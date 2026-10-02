import { describe, expect, it } from 'vitest';
import { loadRoom } from '../data/RoomLoader';
import { createPlayer, type Player } from '../entities/Player';
import { HexCoord } from '../hex/HexCoord';
import { HexGrid } from '../hex/HexGrid';
import { affordablePath, moveRange, pathCost, stepPlayer } from './Movement';

const at = (col: number, row: number): HexCoord => HexCoord.fromOffset(col, row);

function spawnPlayer(grid: HexGrid, position: HexCoord, ap: number): Player {
  const player = createPlayer(position);
  player.ap = ap;
  grid.setEntityAt(position, player);
  return player;
}

describe('stepPlayer', () => {
  it('moves one hex, charges the terrain cost, and updates occupancy', () => {
    const grid = new HexGrid(1, 4);
    const player = spawnPlayer(grid, at(0, 0), 3);

    expect(stepPlayer(grid, player, at(0, 1))).toBe(true);
    expect(player.position.equals(at(0, 1))).toBe(true);
    expect(player.ap).toBe(2);
    expect(grid.getEntityAt(at(0, 0))).toBeNull();
    expect(grid.getEntityAt(at(0, 1))).toBe(player);
  });

  it('charges 2 AP to enter a veil tear', () => {
    const grid = new HexGrid(1, 4);
    grid.setTerrain(at(0, 1), 'VEIL_TEAR');
    const player = spawnPlayer(grid, at(0, 0), 3);

    expect(stepPlayer(grid, player, at(0, 1))).toBe(true);
    expect(player.ap).toBe(1);
  });

  it('refuses steps that are too far, blocked, or unaffordable', () => {
    const grid = new HexGrid(1, 5);
    grid.setTerrain(at(0, 1), 'VEIL_TEAR');
    const player = spawnPlayer(grid, at(0, 0), 1);

    expect(stepPlayer(grid, player, at(0, 2))).toBe(false);
    expect(stepPlayer(grid, player, at(0, 1))).toBe(false);
    grid.setTerrain(at(0, 1), 'WALL');
    expect(stepPlayer(grid, player, at(0, 1))).toBe(false);

    expect(player.position.equals(at(0, 0))).toBe(true);
    expect(player.ap).toBe(1);
  });
});

describe('moveRange and affordablePath', () => {
  it('shrinks the range as AP is spent', () => {
    const grid = new HexGrid(7, 9);
    const player = spawnPlayer(grid, at(3, 4), 2);
    expect(moveRange(grid, player)).toHaveLength(18);

    player.ap = 0;
    expect(moveRange(grid, player)).toEqual([]);
  });

  it('only returns paths the player can pay for', () => {
    const grid = new HexGrid(1, 6);
    const player = spawnPlayer(grid, at(0, 0), 3);

    expect(affordablePath(grid, player, at(0, 3))).toHaveLength(4);
    expect(affordablePath(grid, player, at(0, 4))).toEqual([]);
  });

  it('avoids a veil tear when an equally short route goes around it', () => {
    // (1, 1) is two steps from (0, 0), by way of either (1, 0) or (0, 1).
    const grid = new HexGrid(3, 3);
    grid.setTerrain(at(1, 0), 'VEIL_TEAR');
    const player = spawnPlayer(grid, at(0, 0), 3);
    const path = affordablePath(grid, player, at(1, 1));

    expect(path).toHaveLength(3);
    expect(path.some((hex) => hex.equals(at(1, 0)))).toBe(false);
    expect(pathCost(grid, path)).toBe(2);
  });
});

describe('prototype_room', () => {
  it('starts the player with full AP and a 3-AP move range that stops at the wall', () => {
    const { grid, player } = loadRoom('prototype_room');
    const range = moveRange(grid, player);

    expect(player.ap).toBe(player.maxAp);
    expect(range.length).toBeGreaterThan(0);
    for (const hex of range) {
      expect(pathCost(grid, affordablePath(grid, player, hex))).toBeLessThanOrEqual(player.ap);
    }
    // Directly behind the central wall: 4 hexes away in a straight line, far more on foot.
    expect(range.some((hex) => hex.equals(at(3, 4)))).toBe(false);
  });
});
