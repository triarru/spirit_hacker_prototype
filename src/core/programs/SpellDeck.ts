import type { Rng } from '../combat/CombatResolver';
import loadoutJson from '../data/loadout.json';
import type { ActiveSpec, Program } from './Program';
import {
  applyModifier,
  combinePassives,
  getProgram,
  PROGRAMS,
  type PassiveBonuses,
} from './ProgramRegistry';

/** An Active slot: the program that gets cast, and the program (if any) modifying it. */
export interface ActiveSlot {
  program: Program;
  modifier: Program | null;
}

export interface Loadout {
  actives: ActiveSlot[];
  passives: Program[];
  /** Cards drawn from the Active slots each turn. */
  handSize: number;
}

/**
 * The player's programs for a fight. Each turn a random hand is drawn from the
 * Active slots; a card that is cast leaves the hand until the next draw.
 */
export class SpellDeck {
  readonly slots: readonly ActiveSlot[];
  readonly passives: readonly Program[];
  readonly bonuses: PassiveBonuses;
  private readonly handSize: number;
  /** Slot indexes currently in hand, in slot order. */
  private hand: number[] = [];

  constructor(loadout: Loadout) {
    this.slots = loadout.actives;
    this.passives = loadout.passives;
    this.handSize = loadout.handSize;
    this.bonuses = combinePassives(loadout.passives);
  }

  /** Replaces the hand with a fresh random draw from the Active slots. */
  drawHand(rng: Rng): void {
    // Partial Fisher–Yates: shuffle only as many positions as there are cards to draw.
    const pool = this.slots.map((_, index) => index);
    const count = Math.min(this.handSize, pool.length);
    for (let i = 0; i < count; i++) {
      const j = i + Math.min(Math.floor(rng() * (pool.length - i)), pool.length - i - 1);
      const picked = pool[j];
      const displaced = pool[i];
      if (picked === undefined || displaced === undefined) break;
      pool[i] = picked;
      pool[j] = displaced;
    }
    this.hand = pool.slice(0, count).sort((a, b) => a - b);
  }

  getHand(): readonly number[] {
    return this.hand;
  }

  inHand(slotIndex: number): boolean {
    return this.hand.includes(slotIndex);
  }

  /** Removes a cast card from the hand. */
  discard(slotIndex: number): void {
    this.hand = this.hand.filter((index) => index !== slotIndex);
  }

  /** The slot's Active as it actually casts, with its modifier applied. */
  specOf(slotIndex: number): ActiveSpec | null {
    const slot = this.slots[slotIndex];
    return slot ? applyModifier(slot.program.active, slot.modifier) : null;
  }
}

/** A deck with nothing slotted: no hand, no passives. */
export function createEmptyDeck(): SpellDeck {
  return new SpellDeck({ actives: [], passives: [], handSize: 0 });
}

// --- Choosing a loadout --------------------------------------------------------

/** How many slots a loadout has, and how many cards are drawn each turn. From loadout.json. */
export const LOADOUT_SHAPE = {
  activeSlots: loadoutJson.activeSlots,
  passiveSlots: loadoutJson.passiveSlots,
  handSize: loadoutJson.handSize,
} as const;

/** A loadout being put together: program ids per slot, null where a slot is empty. */
export interface LoadoutSelection {
  /** One entry per Active slot. A modifier only counts when its Active is filled. */
  actives: Array<{ program: string | null; modifier: string | null }>;
  /** One entry per Passive slot. */
  passives: Array<string | null>;
}

export type LoadoutSlot =
  | { kind: 'active'; index: number }
  | { kind: 'modifier'; index: number }
  | { kind: 'passive'; index: number };

/** The loadout in loadout.json, padded with empty slots up to the full shape. */
export function starterSelection(): LoadoutSelection {
  const actives: LoadoutSelection['actives'] = loadoutJson.actives.map(({ program, modifier }) => ({
    program,
    modifier,
  }));
  const passives: LoadoutSelection['passives'] = [...loadoutJson.passives];
  while (actives.length < LOADOUT_SHAPE.activeSlots) actives.push({ program: null, modifier: null });
  while (passives.length < LOADOUT_SHAPE.passiveSlots) passives.push(null);
  return { actives, passives };
}

/**
 * Puts a program in a slot (or empties the slot, with null) and returns the
 * new selection. A program can only sit in one slot, so assigning one that is
 * already in use moves it here. An Active that leaves its slot takes that
 * slot's modifier with it, since a modifier needs an Active to modify.
 */
export function assignSlot(
  selection: LoadoutSelection,
  slot: LoadoutSlot,
  programId: string | null,
): LoadoutSelection {
  if (slot.kind === 'passive') {
    if (slot.index >= selection.passives.length) return selection;
  } else {
    const column = selection.actives[slot.index];
    if (!column) return selection;
    // A modifier needs an Active above it, and a program cannot modify itself.
    if (slot.kind === 'modifier' && (column.program === null || column.program === programId)) {
      return selection;
    }
  }

  // Take the program out of wherever it is now.
  const actives = selection.actives.map(({ program, modifier }) => {
    if (programId !== null && program === programId) return { program: null, modifier: null };
    return { program, modifier: programId !== null && modifier === programId ? null : modifier };
  });
  const passives = selection.passives.map((program) =>
    programId !== null && program === programId ? null : program,
  );

  if (slot.kind === 'passive') {
    passives[slot.index] = programId;
  } else {
    const target = actives[slot.index];
    if (target && slot.kind === 'active') {
      actives[slot.index] = { program: programId, modifier: programId === null ? null : target.modifier };
    } else if (target) {
      actives[slot.index] = { ...target, modifier: programId };
    }
  }
  return { actives, passives };
}

/** Why this selection cannot be played, as sentences for the player. Empty when it is fine. */
export function loadoutProblems(selection: LoadoutSelection): string[] {
  const problems: string[] = [];
  if (selection.actives.length > LOADOUT_SHAPE.activeSlots) {
    problems.push(`Only ${LOADOUT_SHAPE.activeSlots} Active slots are available.`);
  }
  if (selection.passives.length > LOADOUT_SHAPE.passiveSlots) {
    problems.push(`Only ${LOADOUT_SHAPE.passiveSlots} Passive slots are available.`);
  }

  const uses = new Map<string, number>();
  const count = (id: string | null): void => {
    if (id !== null) uses.set(id, (uses.get(id) ?? 0) + 1);
  };
  for (const { program, modifier } of selection.actives) {
    count(program);
    count(modifier);
    if (program === null && modifier !== null) {
      problems.push('A modifier needs an Active program in the slot above it.');
    }
  }
  selection.passives.forEach(count);

  for (const [id, times] of uses) {
    if (!PROGRAMS[id]) problems.push(`Unknown program "${id}".`);
    else if (times > 1) problems.push(`${PROGRAMS[id].name} is in ${times} slots; a program can only be in one.`);
  }
  if (!selection.actives.some(({ program }) => program !== null)) {
    problems.push('Put a program in at least one Active slot.');
  }
  return problems;
}

/** The deck for a selection. Empty Active slots are left out. Throws if the selection has problems. */
export function buildDeck(selection: LoadoutSelection): SpellDeck {
  const problems = loadoutProblems(selection);
  if (problems.length > 0) throw new Error(`Invalid loadout: ${problems.join(' ')}`);

  return new SpellDeck({
    actives: selection.actives.flatMap(({ program, modifier }) =>
      program === null
        ? []
        : [{ program: getProgram(program), modifier: modifier === null ? null : getProgram(modifier) }],
    ),
    passives: selection.passives.flatMap((program) => (program === null ? [] : [getProgram(program)])),
    handSize: LOADOUT_SHAPE.handSize,
  });
}

/** The deck described by loadout.json. */
export function createStarterDeck(): SpellDeck {
  return buildDeck(starterSelection());
}
