import { create } from 'zustand';
import playerData from '../core/data/player.json';
import type { HexCoord } from '../core/hex/HexCoord';
import { findPath, reachableHexes } from '../core/hex/HexPathfinding';
import { selectPlayer, useCombatStore } from './useCombatStore';

interface UIState {
  hoveredHex: HexCoord | null;
  selectedHex: HexCoord | null;
  /** Path from the player to `selectedHex`, both ends included. Empty when unreachable. */
  path: HexCoord[];
  selectedEntityId: string | null;
  moveRange: HexCoord[];
  spellRange: HexCoord[];

  setHoveredHex: (hex: HexCoord | null) => void;
  selectHex: (hex: HexCoord | null) => void;
  setMoveRangeVisible: (visible: boolean) => void;
  /** Highlights every hex within `range` of the player; `null` clears the preview. */
  previewSpellRange: (range: number | null) => void;
}

function computeMoveRange(): HexCoord[] {
  const combat = useCombatStore.getState();
  return reachableHexes(combat.grid, selectPlayer(combat).position, playerData.maxAp);
}

export const useUIStore = create<UIState>((set, get) => ({
  hoveredHex: null,
  selectedHex: null,
  path: [],
  selectedEntityId: null,
  moveRange: computeMoveRange(),
  spellRange: [],

  setHoveredHex: (hex) => {
    const current = get().hoveredHex;
    // pointermove fires per pixel; only notify subscribers when the hex actually changes.
    if (current === hex || (current && hex && current.equals(hex))) return;
    set({ hoveredHex: hex });
  },

  selectHex: (hex) => {
    const combat = useCombatStore.getState();
    if (!hex || !combat.grid.has(hex)) {
      set({ selectedHex: null, selectedEntityId: null, path: [] });
      return;
    }

    const entity = combat.grid.getEntityAt(hex);
    if (entity?.kind === 'enemy') {
      set({ selectedHex: hex, selectedEntityId: entity.id, path: [] });
      return;
    }

    const path = findPath(combat.grid, selectPlayer(combat).position, hex);
    set({ selectedHex: hex, selectedEntityId: null, path });
  },

  setMoveRangeVisible: (visible) => set({ moveRange: visible ? computeMoveRange() : [] }),

  previewSpellRange: (range) => {
    if (range === null) {
      set({ spellRange: [] });
      return;
    }
    const combat = useCombatStore.getState();
    const origin = selectPlayer(combat).position;
    set({
      spellRange: origin
        .hexesInRange(range)
        .filter((hex) => combat.grid.has(hex) && !hex.equals(origin)),
    });
  },
}));
