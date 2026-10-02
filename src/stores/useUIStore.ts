import { create } from 'zustand';
import type { SpellPreview } from '../core/combat/CombatManager';
import type { HexCoord } from '../core/hex/HexCoord';
import {
  previewPath,
  previewSpell,
  spellTargets,
  useCombatStore,
  type CombatState,
} from './useCombatStore';

export interface UIState {
  hoveredHex: HexCoord | null;
  selectedEntityId: string | null;
  /** Path the player would walk to `hoveredHex`, both ends included. Empty when out of reach. */
  path: HexCoord[];

  /** Active slot of the hand card being aimed; null when not in targeting mode. */
  targetingSlot: number | null;
  /** Hexes the card being aimed can be cast at. */
  spellTargets: HexCoord[];
  /** What casting at `hoveredHex` would do; null when it is not a valid target. */
  spellPreview: SpellPreview | null;

  setHoveredHex: (hex: HexCoord | null) => void;
  /** Primary click: cast the card being aimed; otherwise attack or select an enemy, or walk. */
  clickHex: (hex: HexCoord | null) => void;
  /** Secondary click: cancel targeting; otherwise select the enemy on `hex` without acting on it. */
  selectHex: (hex: HexCoord | null) => void;
  /** Starts aiming the hand card from `slot`; picking the card already being aimed puts it back. */
  selectCard: (slot: number) => void;
  cancelTargeting: () => void;
}

const NOT_TARGETING: Pick<UIState, 'targetingSlot' | 'spellTargets' | 'spellPreview'> = {
  targetingSlot: null,
  spellTargets: [],
  spellPreview: null,
};

export const useUIStore = create<UIState>((set, get) => ({
  hoveredHex: null,
  selectedEntityId: null,
  path: [],
  ...NOT_TARGETING,

  setHoveredHex: (hex) => {
    const { hoveredHex: current, targetingSlot } = get();
    // pointermove fires per pixel; only notify subscribers when the hex actually changes.
    if (current === hex || (current && hex && current.equals(hex))) return;

    if (targetingSlot !== null) {
      set({ hoveredHex: hex, path: [], spellPreview: hex ? previewSpell(targetingSlot, hex) : null });
    } else {
      set({ hoveredHex: hex, path: hex ? previewPath(hex) : [] });
    }
  },

  clickHex: (hex) => {
    const combat = useCombatStore.getState();
    // While a prompt is up, a click is a parry, not a selection.
    if (combat.reactive) return;

    const { targetingSlot } = get();
    if (targetingSlot !== null) {
      // A click always ends targeting: on a valid hex it casts, anywhere else it cancels.
      set(NOT_TARGETING);
      if (hex) combat.castSpell(targetingSlot, hex);
      return;
    }

    const entity = hex ? combat.grid.getEntityAt(hex) : null;
    if (entity?.kind === 'enemy') {
      set({ selectedEntityId: entity.id });
      // Out of range or out of AP, this is a no-op and the click only selects.
      combat.attackEnemy(entity.id);
      return;
    }

    set({ selectedEntityId: null });
    if (hex) void combat.movePlayerTo(hex);
  },

  selectHex: (hex) => {
    const combat = useCombatStore.getState();
    if (combat.reactive) return;
    if (get().targetingSlot !== null) {
      set(NOT_TARGETING);
      return;
    }
    const entity = hex ? combat.grid.getEntityAt(hex) : null;
    set({ selectedEntityId: entity?.kind === 'enemy' ? entity.id : null });
  },

  selectCard: (slot) => {
    const { targetingSlot, hoveredHex } = get();
    if (targetingSlot === slot) {
      set(NOT_TARGETING);
      return;
    }
    const targets = spellTargets(slot);
    if (targets.length === 0) return;
    set({
      targetingSlot: slot,
      spellTargets: targets,
      spellPreview: hoveredHex ? previewSpell(slot, hoveredHex) : null,
      path: [],
    });
  },

  cancelTargeting: () => {
    if (get().targetingSlot !== null) set(NOT_TARGETING);
  },
}));

// Whatever the pointer is over stays put while the game changes around it, so
// everything derived from it is recomputed whenever combat state moves on.
useCombatStore.subscribe(() => {
  const { hoveredHex, path, targetingSlot } = useUIStore.getState();

  if (targetingSlot !== null) {
    const targets = spellTargets(targetingSlot);
    // The card was cast, the turn ended, or it can no longer be paid for.
    if (targets.length === 0) useUIStore.setState(NOT_TARGETING);
    else {
      useUIStore.setState({
        spellTargets: targets,
        spellPreview: hoveredHex ? previewSpell(targetingSlot, hoveredHex) : null,
      });
    }
    return;
  }

  const next = hoveredHex ? previewPath(hoveredHex) : [];
  if (next.length === 0 && path.length === 0) return;
  useUIStore.setState({ path: next });
});

/** The enemy the info panel should describe: the hovered one, else the selected one. */
export function selectFocusedEnemyId(
  combat: Pick<CombatState, 'grid'>,
  ui: Pick<UIState, 'hoveredHex' | 'selectedEntityId'>,
): string | null {
  const hovered = ui.hoveredHex ? combat.grid.getEntityAt(ui.hoveredHex) : null;
  return hovered?.kind === 'enemy' ? hovered.id : ui.selectedEntityId;
}
