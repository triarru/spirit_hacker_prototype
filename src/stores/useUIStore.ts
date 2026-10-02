import { create } from 'zustand';
import type { HackOption, SpellPreview } from '../core/combat/CombatManager';
import type { HackKind } from '../core/combat/EnvironmentHack';
import type { HexCoord, Point } from '../core/hex/HexCoord';
import { WALL_ROTATIONS } from '../core/programs/SpellTargeting';
import {
  hackOptions,
  previewPath,
  previewSpell,
  spellTargets,
  useCombatStore,
  type CombatState,
} from './useCombatStore';

/** The choice of hacks for a hex that can take more than one, shown where the player clicked. */
export interface HackMenu {
  hex: HexCoord;
  /** Where on screen to show it, in CSS px. */
  at: Point;
  options: HackOption[];
}

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
  /** How many 60° steps the wall of the card being aimed has been turned. */
  targetRotation: number;

  /** The next click on a hackable hex hacks it. */
  hackMode: boolean;
  hackMenu: HackMenu | null;

  setHoveredHex: (hex: HexCoord | null) => void;
  /**
   * Primary click. Depending on the mode it casts the card being aimed, hacks
   * the hex, or (normally) attacks or selects an enemy, or walks.
   * `at` is where on screen the click landed.
   */
  clickHex: (hex: HexCoord | null, at: Point) => void;
  /** Secondary click: cancel the current mode; otherwise select the enemy on `hex` without acting on it. */
  selectHex: (hex: HexCoord | null) => void;
  /** Starts aiming the hand card from `slot`; picking the card already being aimed puts it back. */
  selectCard: (slot: number) => void;
  /** Turns the wall of the card being aimed one step clockwise. Does nothing outside targeting mode. */
  rotateTarget: () => void;
  toggleHackMode: () => void;
  /** Carries out one of the hacks offered by the open hack menu. */
  chooseHack: (kind: HackKind) => void;
  /** Leaves targeting or hack mode, whichever is on. */
  cancelAction: () => void;
}

type ModeState = Pick<
  UIState,
  'targetingSlot' | 'spellTargets' | 'spellPreview' | 'targetRotation' | 'hackMode' | 'hackMenu'
>;

/** No special mode: clicks select, attack and move. */
const NORMAL_MODE: ModeState = {
  targetingSlot: null,
  spellTargets: [],
  spellPreview: null,
  targetRotation: 0,
  hackMode: false,
  hackMenu: null,
};

export const useUIStore = create<UIState>((set, get) => ({
  hoveredHex: null,
  selectedEntityId: null,
  path: [],
  ...NORMAL_MODE,

  setHoveredHex: (hex) => {
    const { hoveredHex: current, targetingSlot, targetRotation, hackMode } = get();
    // pointermove fires per pixel; only notify subscribers when the hex actually changes.
    if (current === hex || (current && hex && current.equals(hex))) return;

    if (targetingSlot !== null) {
      set({
        hoveredHex: hex,
        path: [],
        spellPreview: hex ? previewSpell(targetingSlot, hex, targetRotation) : null,
      });
    } else if (hackMode) {
      set({ hoveredHex: hex, path: [] });
    } else {
      set({ hoveredHex: hex, path: hex ? previewPath(hex) : [] });
    }
  },

  clickHex: (hex, at) => {
    const combat = useCombatStore.getState();
    // While a prompt is up, a click is a parry, not a selection.
    if (combat.reactive) return;

    const { targetingSlot, targetRotation, hackMode, hackMenu } = get();
    if (targetingSlot !== null) {
      // A click always ends targeting: on a valid hex it casts, anywhere else it cancels.
      set(NORMAL_MODE);
      if (hex) combat.castSpell(targetingSlot, hex, targetRotation);
      return;
    }

    if (hackMode) {
      // With the menu open, a click on the grid is a click away from it.
      const options = hex && !hackMenu ? hackOptions(hex) : [];
      const [only] = options;
      if (!hex || !only) {
        set(NORMAL_MODE);
      } else if (options.length > 1) {
        set({ hackMenu: { hex, at, options } });
      } else {
        set(NORMAL_MODE);
        combat.hack(hex, only.kind);
      }
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
    const { targetingSlot, hackMode } = get();
    if (targetingSlot !== null || hackMode) {
      set(NORMAL_MODE);
      return;
    }
    const entity = hex ? combat.grid.getEntityAt(hex) : null;
    set({ selectedEntityId: entity?.kind === 'enemy' ? entity.id : null });
  },

  selectCard: (slot) => {
    const { targetingSlot, hoveredHex } = get();
    if (targetingSlot === slot) {
      set(NORMAL_MODE);
      return;
    }
    const targets = spellTargets(slot);
    if (targets.length === 0) return;
    set({
      ...NORMAL_MODE,
      targetingSlot: slot,
      spellTargets: targets,
      spellPreview: hoveredHex ? previewSpell(slot, hoveredHex) : null,
      path: [],
    });
  },

  rotateTarget: () => {
    const { targetingSlot, targetRotation, hoveredHex } = get();
    if (targetingSlot === null) return;
    const next = (targetRotation + 1) % WALL_ROTATIONS;
    set({
      targetRotation: next,
      spellPreview: hoveredHex ? previewSpell(targetingSlot, hoveredHex, next) : null,
    });
  },

  toggleHackMode: () => {
    if (get().hackMode) {
      set(NORMAL_MODE);
      return;
    }
    if (useCombatStore.getState().hackTargets.length === 0) return;
    set({ ...NORMAL_MODE, hackMode: true, path: [] });
  },

  chooseHack: (kind) => {
    const { hackMenu } = get();
    if (!hackMenu) return;
    set(NORMAL_MODE);
    useCombatStore.getState().hack(hackMenu.hex, kind);
  },

  cancelAction: () => {
    const { targetingSlot, hackMode } = get();
    if (targetingSlot !== null || hackMode) set(NORMAL_MODE);
  },
}));

// Whatever the pointer is over stays put while the game changes around it, so
// everything derived from it is recomputed whenever combat state moves on.
useCombatStore.subscribe((combat, previous) => {
  // A new grid means a new fight: nothing selected or in progress carries over.
  if (combat.grid !== previous.grid) {
    useUIStore.setState({ ...NORMAL_MODE, selectedEntityId: null, path: [] });
    return;
  }

  const { hoveredHex, path, targetingSlot, targetRotation, hackMode } = useUIStore.getState();

  if (targetingSlot !== null) {
    const targets = spellTargets(targetingSlot);
    // The card was cast, the turn ended, or it can no longer be paid for.
    if (targets.length === 0) useUIStore.setState(NORMAL_MODE);
    else {
      useUIStore.setState({
        spellTargets: targets,
        spellPreview: hoveredHex ? previewSpell(targetingSlot, hoveredHex, targetRotation) : null,
      });
    }
    return;
  }

  if (hackMode) {
    // The turn ended, or there is nothing left the player can afford to hack.
    if (combat.busy || combat.hackTargets.length === 0) useUIStore.setState(NORMAL_MODE);
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
