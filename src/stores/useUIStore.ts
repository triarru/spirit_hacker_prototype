import { create } from 'zustand';
import type { HexCoord } from '../core/hex/HexCoord';
import { previewPath, useCombatStore, type CombatState } from './useCombatStore';

interface UIState {
  hoveredHex: HexCoord | null;
  selectedEntityId: string | null;
  /** Path the player would walk to `hoveredHex`, both ends included. Empty when out of reach. */
  path: HexCoord[];
  /** Radius of the spell range preview around the player; `null` hides it. */
  spellPreviewRange: number | null;

  setHoveredHex: (hex: HexCoord | null) => void;
  clickHex: (hex: HexCoord | null) => void;
  setSpellPreviewRange: (range: number | null) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  hoveredHex: null,
  selectedEntityId: null,
  path: [],
  spellPreviewRange: null,

  setHoveredHex: (hex) => {
    const current = get().hoveredHex;
    // pointermove fires per pixel; only notify subscribers when the hex actually changes.
    if (current === hex || (current && hex && current.equals(hex))) return;
    set({ hoveredHex: hex, path: hex ? previewPath(hex) : [] });
  },

  clickHex: (hex) => {
    const combat = useCombatStore.getState();
    const entity = hex ? combat.grid.getEntityAt(hex) : null;
    if (entity?.kind === 'enemy') {
      set({ selectedEntityId: entity.id });
      return;
    }

    set({ selectedEntityId: null });
    if (hex) void combat.movePlayerTo(hex);
  },

  setSpellPreviewRange: (range) => set({ spellPreviewRange: range }),
}));

// The hovered hex stays put while the player walks, but the path to it does not.
useCombatStore.subscribe(() => {
  const { hoveredHex, path } = useUIStore.getState();
  const next = hoveredHex ? previewPath(hoveredHex) : [];
  if (next.length === 0 && path.length === 0) return;
  useUIStore.setState({ path: next });
});

/** Hexes covered by the spell range preview. Stand-in until spells define their own targeting. */
export function selectSpellRange(
  combat: Pick<CombatState, 'grid' | 'player'>,
  range: number | null,
): HexCoord[] {
  if (range === null) return [];
  const origin = combat.player.position;
  return origin.hexesInRange(range).filter((hex) => combat.grid.has(hex) && !hex.equals(origin));
}

/** The enemy the info panel should describe: the hovered one, else the selected one. */
export function selectFocusedEnemyId(
  combat: Pick<CombatState, 'grid'>,
  ui: Pick<UIState, 'hoveredHex' | 'selectedEntityId'>,
): string | null {
  const hovered = ui.hoveredHex ? combat.grid.getEntityAt(ui.hoveredHex) : null;
  return hovered?.kind === 'enemy' ? hovered.id : ui.selectedEntityId;
}
