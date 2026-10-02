import type { Rng } from '../combat/CombatResolver';
import loadoutJson from '../data/loadout.json';
import type { ActiveSpec, Program } from './Program';
import {
  applyModifier,
  combinePassives,
  getProgram,
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

/** The deck described by loadout.json. */
export function createStarterDeck(): SpellDeck {
  const { activeSlots, passiveSlots, handSize, actives, passives } = loadoutJson;
  if (actives.length > activeSlots) {
    throw new Error(`Loadout has ${actives.length} actives but only ${activeSlots} Active slots`);
  }
  if (passives.length > passiveSlots) {
    throw new Error(`Loadout has ${passives.length} passives but only ${passiveSlots} Passive slots`);
  }

  return new SpellDeck({
    actives: actives.map(({ program, modifier }) => ({
      program: getProgram(program),
      modifier: modifier === null ? null : getProgram(modifier),
    })),
    passives: passives.map(getProgram),
    handSize,
  });
}
