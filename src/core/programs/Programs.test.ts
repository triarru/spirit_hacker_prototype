import { describe, expect, it } from 'vitest';
import { at, makeRoom, seededRng } from '../combat/testRoom';
import type { ActiveSpec } from './Program';
import {
  applyModifier,
  combinePassives,
  getProgram,
  MODIFIERS,
  noBonuses,
  PASSIVES,
  PROGRAMS,
} from './ProgramRegistry';
import { createEmptyDeck, createStarterDeck, SpellDeck } from './SpellDeck';
import { affectedHexes, validTargets } from './SpellTargeting';

const keys = (hexes: Array<{ key(): string }>): string[] => hexes.map((hex) => hex.key()).sort();

describe('program registry', () => {
  it('loads the six starter programs with the stats from the design', () => {
    expect(Object.keys(PROGRAMS).sort()).toEqual(
      ['brute_force', 'firewall_up', 'incense_burn', 'nmap_scan', 'ping_flood', 'tran_yem'],
    );
    expect(getProgram('brute_force').active).toMatchObject({ damage: 20, range: 1, targeting: 'ENEMY' });
    expect(getProgram('ping_flood').active).toMatchObject({ damage: 12, range: 3, targeting: 'LINE' });
    expect(getProgram('firewall_up').active).toMatchObject({
      range: 2,
      targeting: 'FLOOR',
      effects: [{ type: 'createWall', count: 2 }],
    });
    expect(getProgram('incense_burn').active.effects).toContainEqual({ type: 'heal', amount: 15 });
    expect(getProgram('tran_yem').active).toMatchObject({ range: 2, effects: [{ type: 'stun', turns: 1 }] });
    expect(getProgram('nmap_scan').active).toMatchObject({ range: null, targeting: 'ENEMY' });
  });

  it('pays for RAM programs with RAM and Qi programs with Qi', () => {
    for (const program of Object.values(PROGRAMS)) {
      const { ramCost, qiCost } = program.active;
      if (program.resourceType === 'RAM') expect([ramCost > 0, qiCost]).toEqual([true, 0]);
      if (program.resourceType === 'QI') expect([ramCost, qiCost > 0]).toEqual([0, true]);
    }
  });

  it('gives every program a modifier and a passive that exist in the function maps', () => {
    for (const program of Object.values(PROGRAMS)) {
      expect(MODIFIERS[program.modifier.modifyFn]).toBeTypeOf('function');
      expect(PASSIVES[program.passive.passiveFn]).toBeTypeOf('function');
    }
  });

  it('rejects an unknown program id', () => {
    expect(() => getProgram('rm_rf')).toThrow();
  });
});

describe('modifiers', () => {
  const host: ActiveSpec = {
    apCost: 1,
    ramCost: 3,
    qiCost: 10,
    targeting: 'ENEMY',
    range: 2,
    aoe: 0,
    damage: 10,
    firewallBonus: 0,
    effects: [{ type: 'stun', turns: 1 }],
  };
  const modify = (name: string, value: number): ActiveSpec => {
    const fn = MODIFIERS[name];
    if (!fn) throw new Error(`no modifier ${name}`);
    return fn(host, value);
  };

  it('each change exactly one aspect of the host spell', () => {
    expect(modify('addDamage', 8)).toEqual({ ...host, damage: 18 });
    expect(modify('addRange', 1)).toEqual({ ...host, range: 3 });
    expect(modify('addAoe', 1)).toEqual({ ...host, aoe: 1 });
    expect(modify('addFirewallDamage', 1)).toEqual({ ...host, firewallBonus: 1 });
    expect(modify('addHeal', 5).effects).toEqual([...host.effects, { type: 'heal', amount: 5 }]);
  });

  it('reduceCost lowers RAM and Qi but never below zero', () => {
    expect(modify('reduceCost', 4)).toEqual({ ...host, ramCost: 0, qiCost: 6 });
  });

  it('addRange leaves an unlimited range unlimited', () => {
    const addRange = MODIFIERS.addRange;
    if (!addRange) throw new Error('no addRange');
    expect(addRange({ ...host, range: null }, 1).range).toBeNull();
  });

  it('never alter the host spec they were given', () => {
    const before = structuredClone(host);
    for (const name of Object.keys(MODIFIERS)) modify(name, 3);
    expect(host).toEqual(before);
  });

  it('are applied through the program slotted as modifier', () => {
    const bruteForce = getProgram('brute_force');
    expect(applyModifier(bruteForce.active, null)).toBe(bruteForce.active);
    expect(applyModifier(bruteForce.active, getProgram('nmap_scan')).range).toBe(2);
    expect(applyModifier(getProgram('ping_flood').active, bruteForce).damage).toBe(20);
  });
});

describe('passives', () => {
  it('add up across slotted programs', () => {
    expect(combinePassives([])).toEqual(noBonuses());
    expect(combinePassives([getProgram('incense_burn'), getProgram('brute_force')])).toEqual({
      ...noBonuses(),
      hpPerTurn: 3,
      basicAttackDamage: 5,
    });
    expect(combinePassives([getProgram('brute_force'), getProgram('brute_force')]).basicAttackDamage).toBe(10);
  });
});

describe('SpellDeck', () => {
  it('builds the starter deck from loadout.json: 4 actives, a hand of 3', () => {
    const deck = createStarterDeck();
    expect(deck.slots).toHaveLength(4);
    expect(deck.getHand()).toEqual([]);

    deck.drawHand(seededRng(1));
    expect(deck.getHand()).toHaveLength(3);
    expect(new Set(deck.getHand()).size).toBe(3);
    for (const slot of deck.getHand()) expect(deck.slots[slot]).toBeDefined();
  });

  it('draws a different hand over time, leaving each slot out sometimes', () => {
    const deck = createStarterDeck();
    const rng = seededRng(42);
    const leftOut = new Set<number>();
    for (let turn = 0; turn < 60; turn++) {
      deck.drawHand(rng);
      const missing = [0, 1, 2, 3].find((slot) => !deck.inHand(slot));
      if (missing !== undefined) leftOut.add(missing);
    }
    expect([...leftOut].sort()).toEqual([0, 1, 2, 3]);
  });

  it('discards a cast card until the next draw', () => {
    const deck = createStarterDeck();
    deck.drawHand(() => 0);
    const [first] = deck.getHand();
    if (first === undefined) throw new Error('empty hand');

    deck.discard(first);
    expect(deck.inHand(first)).toBe(false);
    expect(deck.getHand()).toHaveLength(2);

    deck.drawHand(() => 0);
    expect(deck.getHand()).toHaveLength(3);
  });

  it('casts a slot with its modifier applied', () => {
    const deck = new SpellDeck({
      actives: [
        { program: getProgram('brute_force'), modifier: getProgram('nmap_scan') },
        { program: getProgram('ping_flood'), modifier: null },
      ],
      passives: [],
      handSize: 2,
    });
    expect(deck.specOf(0)?.range).toBe(2);
    expect(deck.specOf(1)).toBe(getProgram('ping_flood').active);
    expect(deck.specOf(7)).toBeNull();
  });

  it('can be empty', () => {
    const deck = createEmptyDeck();
    deck.drawHand(() => 0.5);
    expect(deck.getHand()).toEqual([]);
    expect(deck.bonuses).toEqual(noBonuses());
  });
});

describe('spell targeting', () => {
  const bruteForce = getProgram('brute_force').active;
  const pingFlood = getProgram('ping_flood').active;
  const firewallUp = getProgram('firewall_up').active;
  const tranYem = getProgram('tran_yem').active;
  const incense = getProgram('incense_burn').active;

  it('ENEMY: only enemies within range can be targeted', () => {
    const { grid } = makeRoom({
      player: at(3, 4),
      enemies: [['crawler', at(3, 3)], ['guardian', at(3, 2)], ['ghost_process', at(3, 0)]],
    });
    expect(keys(validTargets(grid, at(3, 4), bruteForce))).toEqual(keys([at(3, 3)]));
    expect(keys(validTargets(grid, at(3, 4), tranYem))).toEqual(keys([at(3, 3), at(3, 2)]));
    expect(affectedHexes(grid, at(3, 4), bruteForce, at(3, 3))).toEqual([at(3, 3)]);
  });

  it('ENEMY with aoe: also covers the hexes around the target', () => {
    const { grid } = makeRoom({ player: at(3, 4), enemies: [['crawler', at(3, 3)]] });
    const splash = { ...bruteForce, aoe: 1 };
    expect(affectedHexes(grid, at(3, 4), splash, at(3, 3))).toHaveLength(7);
  });

  it('LINE: runs the full range in the aimed direction, even when aimed at a near hex', () => {
    const { grid } = makeRoom({ player: at(3, 6) });
    const line = [at(3, 5), at(3, 4), at(3, 3)];
    expect(affectedHexes(grid, at(3, 6), pingFlood, at(3, 5))).toEqual(line);
    expect(affectedHexes(grid, at(3, 6), pingFlood, at(3, 3))).toEqual(line);
  });

  it('LINE: passes through enemies but stops at a wall and at the grid edge', () => {
    const { grid } = makeRoom({
      player: at(3, 6),
      enemies: [['crawler', at(3, 5)]],
      walls: [at(3, 3)],
    });
    expect(affectedHexes(grid, at(3, 6), pingFlood, at(3, 5))).toEqual([at(3, 5), at(3, 4)]);
    expect(affectedHexes(grid, at(3, 6), pingFlood, at(3, 7))).toEqual([at(3, 7), at(3, 8)]);
  });

  it('LINE: can be aimed at any hex within range', () => {
    const { grid } = makeRoom({ player: at(3, 4) });
    expect(validTargets(grid, at(3, 4), pingFlood)).toHaveLength(at(3, 4).hexesInRange(3).length - 1);
  });

  it('FLOOR: a wall is the target plus the next hex clockwise around the caster', () => {
    const { grid } = makeRoom({ player: at(3, 4) });
    // Straight up from the player; clockwise from there is up-right.
    expect(affectedHexes(grid, at(3, 4), firewallUp, at(3, 3))).toEqual([at(3, 3), at(4, 4)]);
    // Two hexes up: the next hex on that ring going clockwise.
    const wall = affectedHexes(grid, at(3, 4), firewallUp, at(3, 2));
    expect(wall).toHaveLength(2);
    expect(wall[0]).toEqual(at(3, 2));
    expect(wall[1]?.distance(at(3, 4))).toBe(2);
    expect(wall[1]?.distance(at(3, 2))).toBe(1);
  });

  it('FLOOR: only empty floor within range is a valid spot, and the wall stops at anything in the way', () => {
    const { grid } = makeRoom({
      player: at(3, 4),
      enemies: [['crawler', at(4, 4)]],
      walls: [at(2, 4)],
    });
    grid.setTerrain(at(3, 5), 'VEIL_TEAR');
    const targets = keys(validTargets(grid, at(3, 4), firewallUp));

    expect(targets).toContain(at(3, 3).key());
    expect(targets).not.toContain(at(4, 4).key());
    expect(targets).not.toContain(at(2, 4).key());
    expect(targets).not.toContain(at(3, 5).key());
    expect(targets).not.toContain(at(3, 1).key());
    // Clockwise of (3, 3) is (4, 4), where the crawler stands: the wall is one hex short.
    expect(affectedHexes(grid, at(3, 4), firewallUp, at(3, 3))).toEqual([at(3, 3)]);
  });

  it('SELF: the only target is the caster', () => {
    const { grid } = makeRoom({ player: at(3, 4) });
    expect(validTargets(grid, at(3, 4), incense)).toEqual([at(3, 4)]);
    expect(affectedHexes(grid, at(3, 4), incense, at(3, 4))).toEqual([at(3, 4)]);
  });
});
