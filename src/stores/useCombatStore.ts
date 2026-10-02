import { create } from 'zustand';
import { affordablePath, moveRange, stepPlayer } from '../core/combat/Movement';
import { loadRoom } from '../core/data/RoomLoader';
import timing from '../core/data/timing.json';
import type { Enemy } from '../core/entities/Enemy';
import type { Player } from '../core/entities/Player';
import type { HexCoord } from '../core/hex/HexCoord';
import type { HexGrid } from '../core/hex/HexGrid';

const ROOM_ID = 'prototype_room';

/**
 * The live game state. Core logic mutates it in place; nothing outside this
 * module reads it directly — everyone else sees the snapshots published below.
 */
const room = loadRoom(ROOM_ID);

interface CombatSnapshot {
  grid: HexGrid;
  player: Player;
  enemies: Enemy[];
  moveRange: HexCoord[];
}

export interface CombatState extends CombatSnapshot {
  /** An action is still playing out; input is ignored until it finishes. */
  busy: boolean;
  /** Walks the player to `hex` one step at a time. Does nothing if it is out of reach. */
  movePlayerTo: (hex: HexCoord) => Promise<void>;
}

/** Copies of the live entities, so subscribers see a new reference whenever something changed. */
function snapshot(): CombatSnapshot {
  return {
    grid: room.grid,
    player: { ...room.player },
    enemies: room.enemies.map((enemy) => ({ ...enemy })),
    moveRange: moveRange(room.grid, room.player),
  };
}

const sleep = (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export const useCombatStore = create<CombatState>((set, get) => ({
  ...snapshot(),
  busy: false,

  movePlayerTo: async (hex) => {
    if (get().busy) return;
    const path = affordablePath(room.grid, room.player, hex);
    if (path.length < 2) return;

    set({ busy: true });
    for (const step of path.slice(1)) {
      if (!stepPlayer(room.grid, room.player, step)) break;
      set(snapshot());
      await sleep(timing.moveSecondsPerHex);
    }
    set({ busy: false });
  },
}));

/** The path a click on `hex` would walk right now. Empty while busy or when out of reach. */
export function previewPath(hex: HexCoord): HexCoord[] {
  if (useCombatStore.getState().busy) return [];
  return affordablePath(room.grid, room.player, hex);
}
