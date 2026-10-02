import { describe, expect, it } from 'vitest';
import { CombatManager } from '../combat/CombatManager';
import { at, makeRoom, seededRng } from '../combat/testRoom';
import { PROGRAMS } from './ProgramRegistry';
import {
  assignSlot,
  buildDeck,
  createEmptyDeck,
  LOADOUT_SHAPE,
  loadoutProblems,
  starterSelection,
  type LoadoutSelection,
  type LoadoutSlot,
} from './SpellDeck';

/** Every program id in the selection, one entry per slot it occupies. */
function slotted(selection: LoadoutSelection): string[] {
  return [
    ...selection.actives.flatMap(({ program, modifier }) => [program, modifier]),
    ...selection.passives,
  ].filter((id): id is string => id !== null);
}

const empty = (): LoadoutSelection => ({
  actives: Array.from({ length: LOADOUT_SHAPE.activeSlots }, () => ({ program: null, modifier: null })),
  passives: Array.from({ length: LOADOUT_SHAPE.passiveSlots }, () => null),
});

describe('starterSelection', () => {
  it('pre-fills from loadout.json, padded to 4 Active and 2 Passive slots', () => {
    const selection = starterSelection();
    expect(selection.actives).toEqual([
      { program: 'brute_force', modifier: 'nmap_scan' },
      { program: 'ping_flood', modifier: null },
      { program: 'tran_yem', modifier: null },
      { program: 'firewall_up', modifier: null },
    ]);
    expect(selection.passives).toEqual(['incense_burn', null]);
    expect(loadoutProblems(selection)).toEqual([]);
  });
});

describe('buildDeck: a loadout applies the effects of what is slotted', () => {
  it('gives each Active the effect of the modifier under it', () => {
    let selection = empty();
    selection = assignSlot(selection, { kind: 'active', index: 0 }, 'brute_force');
    selection = assignSlot(selection, { kind: 'modifier', index: 0 }, 'nmap_scan');
    selection = assignSlot(selection, { kind: 'active', index: 1 }, 'ping_flood');
    selection = assignSlot(selection, { kind: 'modifier', index: 1 }, 'firewall_up');
    const deck = buildDeck(selection);

    // nmap_scan: +1 range. firewall_up: 4 RAM cheaper.
    expect(deck.specOf(0)).toMatchObject({ damage: 20, range: 2 });
    expect(deck.specOf(1)).toMatchObject({ damage: 12, ramCost: 8 });
  });

  it('changes the same Active when a different modifier is slotted', () => {
    const withModifier = (modifier: string) => {
      let selection = assignSlot(empty(), { kind: 'active', index: 0 }, 'brute_force');
      selection = assignSlot(selection, { kind: 'modifier', index: 0 }, modifier);
      return buildDeck(selection).specOf(0);
    };
    const base = PROGRAMS.brute_force?.active;

    expect(withModifier('tran_yem')).toEqual({ ...base, firewallBonus: 1 });
    expect(withModifier('ping_flood')).toEqual({ ...base, aoe: 1 });
    expect(withModifier('incense_burn')?.effects).toEqual([{ type: 'heal', amount: 5 }]);
  });

  it('turns slotted passives into bonuses', () => {
    let selection = assignSlot(empty(), { kind: 'active', index: 0 }, 'tran_yem');
    selection = assignSlot(selection, { kind: 'passive', index: 0 }, 'brute_force');
    selection = assignSlot(selection, { kind: 'passive', index: 1 }, 'ping_flood');
    const deck = buildDeck(selection);

    expect(deck.bonuses).toMatchObject({ basicAttackDamage: 5, ramPerTurn: 5 });
    expect(deck.passives.map((program) => program.id)).toEqual(['brute_force', 'ping_flood']);
  });

  it('leaves empty Active slots out of the deck, and deals a smaller hand if need be', () => {
    let selection = assignSlot(empty(), { kind: 'active', index: 2 }, 'brute_force');
    selection = assignSlot(selection, { kind: 'active', index: 3 }, 'ping_flood');
    const deck = buildDeck(selection);
    deck.drawHand(seededRng(1));

    expect(deck.slots.map((slot) => slot.program.id)).toEqual(['brute_force', 'ping_flood']);
    expect(deck.getHand()).toEqual([0, 1]);
  });
});

describe('assignSlot: a program is never in two slots at once', () => {
  it('moves a program that is already slotted elsewhere', () => {
    const start = starterSelection();
    // incense_burn is the passive; make it the Active of slot 2 instead.
    const moved = assignSlot(start, { kind: 'active', index: 1 }, 'incense_burn');

    expect(moved.actives[1]).toEqual({ program: 'incense_burn', modifier: null });
    expect(moved.passives).toEqual([null, null]);
    expect(slotted(moved).filter((id) => id === 'incense_burn')).toHaveLength(1);
    // ping_flood was pushed out of slot 2 and is now free.
    expect(slotted(moved)).not.toContain('ping_flood');
  });

  it('holds for any sequence of assignments', () => {
    const rng = seededRng(11);
    const ids = [...Object.keys(PROGRAMS), null];
    const slots: LoadoutSlot[] = [
      ...Array.from({ length: LOADOUT_SHAPE.activeSlots }, (_, index) => ({ kind: 'active', index }) as const),
      ...Array.from({ length: LOADOUT_SHAPE.activeSlots }, (_, index) => ({ kind: 'modifier', index }) as const),
      ...Array.from({ length: LOADOUT_SHAPE.passiveSlots }, (_, index) => ({ kind: 'passive', index }) as const),
    ];
    let selection = starterSelection();

    for (let step = 0; step < 500; step++) {
      const slot = slots[Math.floor(rng() * slots.length)];
      const id = ids[Math.floor(rng() * ids.length)];
      if (!slot || id === undefined) continue;
      selection = assignSlot(selection, slot, id);

      const used = slotted(selection);
      expect(new Set(used).size).toBe(used.length);
      // No modifier is ever left under an empty Active.
      for (const { program, modifier } of selection.actives) {
        if (program === null) expect(modifier).toBeNull();
      }
    }
  });

  it('takes the modifier along when its Active leaves the slot', () => {
    const start = starterSelection();
    expect(start.actives[0]).toEqual({ program: 'brute_force', modifier: 'nmap_scan' });

    const cleared = assignSlot(start, { kind: 'active', index: 0 }, null);
    expect(cleared.actives[0]).toEqual({ program: null, modifier: null });

    const moved = assignSlot(start, { kind: 'passive', index: 1 }, 'brute_force');
    expect(moved.actives[0]).toEqual({ program: null, modifier: null });
    expect(moved.passives[1]).toBe('brute_force');
  });

  it('keeps the modifier when only the Active above it is swapped', () => {
    const swapped = assignSlot(starterSelection(), { kind: 'active', index: 0 }, 'incense_burn');
    expect(swapped.actives[0]).toEqual({ program: 'incense_burn', modifier: 'nmap_scan' });
  });

  it('refuses a modifier under an empty Active, or a program modifying itself', () => {
    const start = assignSlot(empty(), { kind: 'active', index: 0 }, 'brute_force');
    expect(assignSlot(start, { kind: 'modifier', index: 1 }, 'ping_flood')).toBe(start);
    expect(assignSlot(start, { kind: 'modifier', index: 0 }, 'brute_force')).toBe(start);
  });

  it('does not change the selection it was given', () => {
    const start = starterSelection();
    const before = structuredClone(start);
    assignSlot(start, { kind: 'active', index: 0 }, 'incense_burn');
    expect(start).toEqual(before);
  });
});

describe('loadoutProblems', () => {
  it('flags a program slotted twice, and buildDeck refuses it', () => {
    const selection = starterSelection();
    selection.passives[1] = 'brute_force';

    expect(loadoutProblems(selection)).toEqual(['brute_force() is in 2 slots; a program can only be in one.']);
    expect(() => buildDeck(selection)).toThrow(/2 slots/);
  });

  it('flags a loadout with no Active at all', () => {
    expect(loadoutProblems(empty())).toEqual(['Put a program in at least one Active slot.']);
  });

  it('flags an unknown program and a stray modifier', () => {
    const selection = empty();
    selection.actives[0] = { program: 'rm_rf', modifier: null };
    selection.actives[1] = { program: null, modifier: 'ping_flood' };
    const problems = loadoutProblems(selection);

    expect(problems).toContain('Unknown program "rm_rf".');
    expect(problems).toContain('A modifier needs an Active program in the slot above it.');
  });
});

describe('the LOADOUT phase', () => {
  const waiting = () =>
    new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['guardian', at(3, 3)]] }),
      seededRng(5),
      createEmptyDeck(),
      'LOADOUT',
    );

  it('holds the fight: nothing can be done until a deck is chosen', () => {
    const combat = waiting();
    const [guardian] = combat.enemies;
    if (!guardian) throw new Error('guardian missing');

    expect(combat.phase).toBe('LOADOUT');
    expect(combat.getMoveRange()).toEqual([]);
    expect(combat.getHand()).toEqual([]);
    expect(combat.stepPlayer(at(3, 5))).toEqual([]);
    expect(combat.playerAttack(guardian.id)).toEqual([]);
    expect(combat.getHackTargets()).toEqual([]);
    expect(combat.endPlayerTurn()).toEqual([]);
    expect(combat.phase).toBe('LOADOUT');
  });

  it('starts turn 1 with the chosen deck and a hand drawn from it', () => {
    const combat = waiting();
    const events = combat.startCombat(buildDeck(starterSelection()));

    expect(events).toEqual([{ type: 'phaseChanged', phase: 'PLAYER_TURN' }]);
    expect([combat.phase, combat.turn, combat.player.ap]).toEqual(['PLAYER_TURN', 1, combat.player.maxAp]);
    expect(combat.getHand()).toHaveLength(LOADOUT_SHAPE.handSize);
    expect(combat.deck.passives.map((program) => program.id)).toEqual(['incense_burn']);
  });

  it('uses the modifier and passive the player picked', () => {
    // Slot 1 becomes nmap_scan with tran_yem under it; brute_force moves to a passive slot.
    let selection = assignSlot(starterSelection(), { kind: 'active', index: 0 }, 'nmap_scan');
    selection = assignSlot(selection, { kind: 'modifier', index: 0 }, 'tran_yem');
    selection = assignSlot(selection, { kind: 'passive', index: 0 }, 'brute_force');
    const combat = waiting();
    combat.startCombat(buildDeck(selection));

    // nmap_scan deals no damage, so tran_yem under it adds no firewall bar.
    expect(combat.deck.specOf(0)).toMatchObject({ range: 4, firewallBonus: 0 });
    expect(combat.deck.bonuses.basicAttackDamage).toBe(5);
  });

  it('cannot be started twice', () => {
    const combat = waiting();
    combat.startCombat(buildDeck(starterSelection()));
    const hand = combat.getHand().map((card) => card.slot);

    expect(combat.startCombat(createEmptyDeck())).toEqual([]);
    expect(combat.getHand().map((card) => card.slot)).toEqual(hand);
  });
});
