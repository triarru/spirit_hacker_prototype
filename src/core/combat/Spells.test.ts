import { describe, expect, it } from 'vitest';
import type { HexCoord } from '../hex/HexCoord';
import { findPath } from '../hex/HexPathfinding';
import { getProgram } from '../programs/ProgramRegistry';
import { createStarterDeck, SpellDeck } from '../programs/SpellDeck';
import { BREAK_RULES } from './BreakSystem';
import { CombatManager } from './CombatManager';
import { at, makeRoom, runEnemyPhase, seededRng } from './testRoom';

const NEVER_DODGE = (): number => 0.999;

/** A deck whose whole set of actives is in hand every turn, so tests can cast any of them. */
function deckOf(actives: Array<[program: string, modifier?: string]>, passives: string[] = []): SpellDeck {
  return new SpellDeck({
    actives: actives.map(([program, modifier]) => ({
      program: getProgram(program),
      modifier: modifier ? getProgram(modifier) : null,
    })),
    passives: passives.map(getProgram),
    handSize: actives.length,
  });
}

interface Setup {
  player?: HexCoord;
  enemies: Array<[string, HexCoord]>;
  walls?: HexCoord[];
  deck: SpellDeck;
}

function setup({ player = at(3, 4), enemies, walls, deck }: Setup) {
  const combat = new CombatManager(makeRoom({ player, enemies, walls }), NEVER_DODGE, deck);
  return { combat, enemies: combat.enemies.slice() };
}

const types = (events: Array<{ type: string }>): string[] => events.map((event) => event.type);

describe('casting', () => {
  it('brute_force: 20 damage for 1 AP and its RAM cost, and the card leaves the hand', () => {
    const { combat, enemies } = setup({ enemies: [['guardian', at(3, 3)]], deck: deckOf([['brute_force']]) });
    const [guardian] = enemies;
    if (!guardian) throw new Error('guardian missing');

    const events = combat.castSpell(0, guardian.position);

    expect(guardian.hp).toBe(guardian.maxHp - 20);
    expect(combat.player.ap).toBe(combat.player.maxAp - 1);
    expect(combat.player.ram).toBe(combat.player.maxRam - getProgram('brute_force').active.ramCost);
    expect(combat.getHand()).toEqual([]);
    expect(events[0]).toEqual({
      type: 'spellCast',
      programId: 'brute_force',
      programName: 'brute_force()',
      at: guardian.position,
    });
    expect(types(events)).toEqual(['spellCast', 'attacked']);
    // FIRE is not the guardian's weakness: one bar.
    expect(guardian.firewallCurrent).toBe(guardian.firewallMax - BREAK_RULES.normalHitFirewallDamage);
  });

  it('strips two firewall bars when the tag matches the weakness, which can breach outright', () => {
    const { combat, enemies } = setup({ enemies: [['crawler', at(3, 3)]], deck: deckOf([['nmap_scan']]) });
    const [crawler] = enemies;
    if (!crawler) throw new Error('crawler missing');
    expect(crawler.weakness).toBe(getProgram('nmap_scan').tag);
    crawler.firewallCurrent = BREAK_RULES.weaknessHitFirewallDamage;

    const events = combat.castSpell(0, crawler.position);

    expect(types(events)).toEqual(['spellCast', 'breached']);
    expect(crawler.breached).toBe(true);
  });

  it('refuses a cast the player cannot make, changing nothing', () => {
    const { combat, enemies } = setup({
      enemies: [['guardian', at(3, 3)], ['crawler', at(3, 0)]],
      deck: deckOf([['brute_force']]),
    });
    const [guardian, crawler] = enemies;
    if (!guardian || !crawler) throw new Error('enemies missing');
    const untouched = () => {
      expect(guardian.hp).toBe(guardian.maxHp);
      expect(combat.getHand()).toHaveLength(1);
    };

    // Out of range, an empty hex, and a slot that does not exist.
    expect(combat.castSpell(0, crawler.position)).toEqual([]);
    expect(combat.castSpell(0, at(3, 5))).toEqual([]);
    expect(combat.castSpell(3, guardian.position)).toEqual([]);
    untouched();

    combat.player.ram = 7;
    expect(combat.getHand()[0]?.affordable).toBe(false);
    expect(combat.getSpellTargets(0)).toEqual([]);
    expect(combat.castSpell(0, guardian.position)).toEqual([]);
    untouched();

    combat.player.ram = combat.player.maxRam;
    combat.player.ap = 0;
    expect(combat.castSpell(0, guardian.position)).toEqual([]);
    untouched();

    combat.player.ap = 3;
    combat.endPlayerTurn();
    expect(combat.castSpell(0, guardian.position)).toEqual([]);
    untouched();
  });

  it('cannot cast the same card twice in a turn, but gets it back on the next draw', () => {
    const { combat, enemies } = setup({ enemies: [['guardian', at(3, 3)]], deck: deckOf([['brute_force']]) });
    const [guardian] = enemies;
    if (!guardian) throw new Error('guardian missing');

    combat.castSpell(0, guardian.position);
    expect(combat.castSpell(0, guardian.position)).toEqual([]);
    expect(guardian.hp).toBe(guardian.maxHp - 20);

    combat.endPlayerTurn();
    runEnemyPhase(combat);
    expect(combat.getHand().map((card) => card.slot)).toEqual([0]);
  });

  it('wins the fight when a spell kills the last enemy', () => {
    const { combat, enemies } = setup({ enemies: [['ghost_process', at(3, 3)]], deck: deckOf([['brute_force']]) });
    const [ghost] = enemies;
    if (!ghost) throw new Error('ghost missing');
    ghost.hp = getProgram('brute_force').active.damage;

    expect(types(combat.castSpell(0, ghost.position))).toEqual(['spellCast', 'attacked', 'died', 'phaseChanged']);
    expect(combat.phase).toBe('VICTORY');
  });
});

describe('preview', () => {
  it('predicts exactly what the cast then does', () => {
    const { combat, enemies } = setup({
      player: at(3, 6),
      enemies: [['crawler', at(3, 5)], ['guardian', at(3, 4)], ['ghost_process', at(3, 3)]],
      deck: deckOf([['ping_flood']]),
    });
    const [crawler, guardian, ghost] = enemies;
    if (!crawler || !guardian || !ghost) throw new Error('enemies missing');
    ghost.hp = 5;

    const preview = combat.previewSpell(0, at(3, 5));
    if (!preview) throw new Error('no preview');
    const before = { crawler: crawler.hp, guardian: guardian.hp, guardianFirewall: guardian.firewallCurrent };
    expect(crawler.hp).toBe(crawler.maxHp);

    combat.castSpell(0, at(3, 5));

    expect(preview.affected).toEqual([at(3, 5), at(3, 4), at(3, 3)]);
    expect(preview.hits).toEqual([
      { enemyId: crawler.id, at: at(3, 5), damage: 12, firewallDamage: 1, breaches: false, kills: false, stunTurns: 0 },
      // CORRUPT is the guardian's weakness: two bars.
      { enemyId: guardian.id, at: at(3, 4), damage: 12, firewallDamage: 2, breaches: false, kills: false, stunTurns: 0 },
      { enemyId: ghost.id, at: at(3, 3), damage: 12, firewallDamage: 0, breaches: false, kills: true, stunTurns: 0 },
    ]);
    expect(crawler.hp).toBe(before.crawler - 12);
    expect(guardian.hp).toBe(before.guardian - 12);
    expect(guardian.firewallCurrent).toBe(before.guardianFirewall - 2);
    expect(combat.enemies).toEqual([crawler, guardian]);
  });

  it('shows amplified damage and no firewall loss on a breached enemy', () => {
    const { combat, enemies } = setup({ enemies: [['guardian', at(3, 3)]], deck: deckOf([['brute_force']]) });
    const [guardian] = enemies;
    if (!guardian) throw new Error('guardian missing');
    guardian.firewallCurrent = 0;
    guardian.breached = true;

    expect(combat.previewSpell(0, guardian.position)?.hits[0]).toMatchObject({
      damage: 30,
      firewallDamage: 0,
      breaches: false,
    });
  });

  it('is null for a target the spell cannot be aimed at', () => {
    const { combat } = setup({ enemies: [['guardian', at(3, 0)]], deck: deckOf([['brute_force']]) });
    expect(combat.previewSpell(0, at(3, 0))).toBeNull();
  });
});

describe('ping_flood', () => {
  it('hits every enemy on the line, but nothing behind a wall', () => {
    const { combat, enemies } = setup({
      player: at(3, 6),
      enemies: [['crawler', at(3, 5)], ['guardian', at(3, 3)]],
      walls: [at(3, 4)],
      deck: deckOf([['ping_flood']]),
    });
    const [crawler, guardian] = enemies;
    if (!crawler || !guardian) throw new Error('enemies missing');

    combat.castSpell(0, at(3, 5));

    expect(crawler.hp).toBe(crawler.maxHp - 12);
    expect(guardian.hp).toBe(guardian.maxHp);
    expect(combat.player.ap).toBe(combat.player.maxAp - 2);
    expect(combat.player.ram).toBe(combat.player.maxRam - getProgram('ping_flood').active.ramCost);
  });

  it('can be fired down an empty line, which just wastes it', () => {
    const { combat } = setup({ enemies: [['guardian', at(0, 0)]], deck: deckOf([['ping_flood']]) });
    expect(types(combat.castSpell(0, at(3, 5)))).toEqual(['spellCast']);
    expect(combat.getHand()).toEqual([]);
  });
});

describe('tran_yem', () => {
  it('stuns: the enemy loses its next turn, then acts again', () => {
    const { combat, enemies } = setup({ enemies: [['guardian', at(3, 3)]], deck: deckOf([['tran_yem']]) });
    const [guardian] = enemies;
    if (!guardian) throw new Error('guardian missing');

    const cast = combat.castSpell(0, guardian.position);
    expect(types(cast)).toEqual(['spellCast', 'stunned']);
    expect(guardian.hp).toBe(guardian.maxHp);
    expect(guardian.firewallCurrent).toBe(guardian.firewallMax - 1);
    expect(combat.player.qi).toBe(combat.player.maxQi - getProgram('tran_yem').active.qiCost);

    combat.player.ap = 0;
    combat.endPlayerTurn();
    const first = runEnemyPhase(combat);
    expect(first).toContainEqual({
      type: 'turnSkipped',
      entityId: guardian.id,
      at: guardian.position,
      reason: 'stunned',
    });
    expect(combat.player.hp).toBe(combat.player.maxHp);

    combat.player.ap = 0;
    combat.endPlayerTurn();
    runEnemyPhase(combat);
    expect(combat.player.hp).toBe(combat.player.maxHp - guardian.attackDamage);
  });

  it('breaches an enemy weak to it, and one skipped turn pays for both the breach and the stun', () => {
    const { combat, enemies } = setup({
      enemies: [['ghost_process', at(3, 2)]],
      deck: deckOf([['tran_yem']]),
    });
    const [ghost] = enemies;
    if (!ghost) throw new Error('ghost missing');

    expect(types(combat.castSpell(0, ghost.position))).toEqual(['spellCast', 'breached', 'stunned']);

    combat.endPlayerTurn();
    const events = runEnemyPhase(combat);
    expect(events.filter((event) => event.type === 'turnSkipped')).toEqual([
      { type: 'turnSkipped', entityId: ghost.id, at: ghost.position, reason: 'breached' },
    ]);
    expect(ghost.stunTurns).toBe(0);
  });
});

describe('firewall_up', () => {
  it('raises two temporary walls that block movement, then come down after 3 turns', () => {
    const { combat } = setup({ enemies: [['guardian', at(0, 0)]], deck: deckOf([['firewall_up']]) });
    const versionBefore = combat.terrainVersion;

    const events = combat.castSpell(0, at(3, 3));

    expect(types(events)).toEqual(['spellCast', 'terrainChanged']);
    expect(combat.terrainVersion).toBe(versionBefore + 1);
    for (const hex of [at(3, 3), at(4, 4)]) {
      expect(combat.grid.isBlocked(hex)).toBe(true);
      expect(combat.grid.getCell(hex)?.terrain).toBe('FLOOR');
    }
    expect(combat.getMoveRange().some((hex) => hex.equals(at(3, 3)))).toBe(false);
    expect(combat.stepPlayer(at(3, 3))).toEqual([]);

    for (let turn = 1; turn <= 3; turn++) {
      expect(combat.grid.isBlocked(at(3, 3))).toBe(true);
      combat.endPlayerTurn();
      const phase = runEnemyPhase(combat);
      expect(phase.some((event) => event.type === 'terrainChanged')).toBe(turn === 3);
    }
    expect(combat.grid.isBlocked(at(3, 3))).toBe(false);
    expect(combat.grid.isBlocked(at(4, 4))).toBe(false);
    expect(combat.terrainVersion).toBe(versionBefore + 2);
  });

  it('can be turned: six rotations give six different walls around the hex it is aimed at', () => {
    // Two hexes from the caster, so none of the target's neighbors is the caster's own hex.
    const target = at(3, 2);
    const fresh = () => setup({ enemies: [['guardian', at(0, 0)]], deck: deckOf([['firewall_up']]) }).combat;
    const walls = [0, 1, 2, 3, 4, 5].map((rotation) => fresh().previewSpell(0, target, rotation)?.walls ?? []);

    for (const wall of walls) {
      expect(wall).toHaveLength(2);
      expect(wall[0]?.equals(target)).toBe(true);
      expect(wall[1]?.distance(target)).toBe(1);
    }
    // Every neighbor of the target is used exactly once.
    expect(new Set(walls.map((wall) => wall[1]?.key())).size).toBe(6);
    // Unrotated, the wall runs around the caster: both hexes are the same distance from them.
    expect(walls[0]?.[1]?.distance(at(3, 4))).toBe(target.distance(at(3, 4)));
    // A seventh turn comes back round to where it started.
    expect(fresh().previewSpell(0, target, 6)?.walls).toEqual(walls[0]);
  });

  it('raises the wall exactly where the rotated preview showed it', () => {
    const { combat } = setup({ enemies: [['guardian', at(0, 0)]], deck: deckOf([['firewall_up']]) });
    const preview = combat.previewSpell(0, at(3, 3), 2)?.walls ?? [];

    combat.castSpell(0, at(3, 3), 2);

    expect(preview).toHaveLength(2);
    for (const hex of preview) expect(combat.grid.isBlocked(hex)).toBe(true);
    // The unrotated second hex stays open.
    expect(combat.grid.isBlocked(at(4, 4))).toBe(false);
  });

  it('is cut short when the rotated hex cannot hold a wall', () => {
    const { combat } = setup({
      enemies: [['guardian', at(0, 0)]],
      walls: at(3, 3).neighbors(),
      deck: deckOf([['firewall_up']]),
    });
    // The player stands on one of those neighbors; makeRoom put them there after the walls.
    for (const rotation of [0, 1, 2, 3, 4, 5]) {
      expect(combat.previewSpell(0, at(3, 3), rotation)?.walls).toEqual([at(3, 3)]);
    }
  });

  it('forces enemies to path around the wall', () => {
    const { combat, enemies } = setup({
      player: at(1, 4),
      enemies: [['crawler', at(1, 0)]],
      deck: deckOf([['firewall_up']]),
    });
    const [crawler] = enemies;
    if (!crawler) throw new Error('crawler missing');
    const direct = findPath(combat.grid, crawler.position, at(1, 3)).length;

    combat.castSpell(0, at(1, 2));

    const detour = findPath(combat.grid, crawler.position, at(1, 3));
    expect(detour.length).toBeGreaterThan(direct);
    for (const hex of detour) expect(combat.grid.isWalkable(hex)).toBe(true);
  });
});

describe('incense_burn', () => {
  it('heals the caster, up to full HP', () => {
    const { combat } = setup({ enemies: [['guardian', at(0, 0)]], deck: deckOf([['incense_burn']]) });
    combat.player.hp = 60;

    expect(combat.previewSpell(0, combat.player.position)?.heal).toBe(15);
    const events = combat.castSpell(0, combat.player.position);

    expect(combat.player.hp).toBe(75);
    expect(combat.player.qi).toBe(combat.player.maxQi - getProgram('incense_burn').active.qiCost);
    expect(events).toContainEqual({
      type: 'healed',
      entityId: combat.player.id,
      at: combat.player.position,
      amount: 15,
    });
  });

  it('heals only what is missing', () => {
    const { combat } = setup({ enemies: [['guardian', at(0, 0)]], deck: deckOf([['incense_burn']]) });
    combat.player.hp = combat.player.maxHp - 4;

    expect(combat.previewSpell(0, combat.player.position)?.heal).toBe(4);
    combat.castSpell(0, combat.player.position);
    expect(combat.player.hp).toBe(combat.player.maxHp);
  });
});

describe('modifiers in combat', () => {
  it('nmap_scan under brute_force: reaches an enemy 2 hexes away', () => {
    const plain = setup({ enemies: [['guardian', at(3, 2)]], deck: deckOf([['brute_force']]) });
    expect(plain.combat.getSpellTargets(0)).toEqual([]);

    const modified = setup({ enemies: [['guardian', at(3, 2)]], deck: deckOf([['brute_force', 'nmap_scan']]) });
    expect(modified.combat.getSpellTargets(0)).toEqual([at(3, 2)]);
    modified.combat.castSpell(0, at(3, 2));
    expect(modified.enemies[0]?.hp).toBe((modified.enemies[0]?.maxHp ?? 0) - 20);
  });

  it('brute_force under tran_yem: the stun also hurts', () => {
    const { combat, enemies } = setup({
      enemies: [['guardian', at(3, 3)]],
      deck: deckOf([['tran_yem', 'brute_force']]),
    });
    expect(types(combat.castSpell(0, at(3, 3)))).toEqual(['spellCast', 'attacked', 'stunned']);
    expect(enemies[0]?.hp).toBe((enemies[0]?.maxHp ?? 0) - 8);
  });

  it('ping_flood under brute_force: splashes onto enemies next to the target', () => {
    const { combat, enemies } = setup({
      enemies: [['guardian', at(3, 3)], ['crawler', at(3, 2)], ['ghost_process', at(3, 0)]],
      deck: deckOf([['brute_force', 'ping_flood']]),
    });
    const [guardian, crawler, ghost] = enemies;
    if (!guardian || !crawler || !ghost) throw new Error('enemies missing');

    combat.castSpell(0, guardian.position);

    expect(guardian.hp).toBe(guardian.maxHp - 20);
    expect(crawler.hp).toBe(crawler.maxHp - 20);
    expect(ghost.hp).toBe(ghost.maxHp);
  });

  it('firewall_up under ping_flood: costs 4 RAM less', () => {
    const { combat } = setup({ enemies: [['guardian', at(0, 0)]], deck: deckOf([['ping_flood', 'firewall_up']]) });
    combat.castSpell(0, at(3, 3));
    expect(combat.player.ram).toBe(combat.player.maxRam - (getProgram('ping_flood').active.ramCost - 4));
  });

  it('incense_burn under brute_force: the cast also heals 5', () => {
    const { combat } = setup({ enemies: [['guardian', at(3, 3)]], deck: deckOf([['brute_force', 'incense_burn']]) });
    combat.player.hp = 50;
    combat.castSpell(0, at(3, 3));
    expect(combat.player.hp).toBe(55);
  });

  it('tran_yem under brute_force: strips one extra firewall bar', () => {
    const { combat, enemies } = setup({ enemies: [['guardian', at(3, 3)]], deck: deckOf([['brute_force', 'tran_yem']]) });
    combat.castSpell(0, at(3, 3));
    expect(enemies[0]?.firewallCurrent).toBe(4 - 2);
  });
});

describe('passives in combat', () => {
  it('brute_force: basic attack +5', () => {
    const { combat, enemies } = setup({ enemies: [['guardian', at(3, 3)]], deck: deckOf([], ['brute_force']) });
    combat.playerAttack(enemies[0]?.id ?? '');
    expect(enemies[0]?.hp).toBe((enemies[0]?.maxHp ?? 0) - 15);
  });

  it('firewall_up: every hit taken is 2 weaker', () => {
    const { combat, enemies } = setup({ enemies: [['guardian', at(3, 3)]], deck: deckOf([], ['firewall_up']) });
    combat.player.ap = 0;
    combat.endPlayerTurn();
    runEnemyPhase(combat);
    expect(combat.player.hp).toBe(combat.player.maxHp - ((enemies[0]?.attackDamage ?? 0) - 2));
  });

  it('per-turn regeneration applies at the start of each new turn, capped at the maximum', () => {
    const { combat } = setup({
      enemies: [['guardian', at(0, 0)]],
      deck: deckOf([], ['incense_burn', 'ping_flood', 'tran_yem']),
    });
    combat.player.hp = 50;
    combat.player.ram = 10;
    combat.player.qi = combat.player.maxQi - 1;

    combat.endPlayerTurn();
    const events = runEnemyPhase(combat);

    expect(combat.player.hp).toBe(53);
    // Base regen plus the ping_flood passive.
    expect(combat.player.ram).toBe(10 + combat.player.ramRegen + 5);
    expect(combat.player.qi).toBe(combat.player.maxQi);
    expect(events).toContainEqual({
      type: 'healed',
      entityId: combat.player.id,
      at: combat.player.position,
      amount: 3,
    });
  });

  it('nmap_scan: a hit on the weakness strips one more bar', () => {
    const { combat, enemies } = setup({
      player: at(3, 6),
      enemies: [['guardian', at(3, 5)]],
      deck: deckOf([['ping_flood']], ['nmap_scan']),
    });
    combat.castSpell(0, at(3, 5));
    expect(enemies[0]?.firewallCurrent).toBe(4 - 3);
  });
});

describe('starter deck in the real room', () => {
  it('deals a hand of 3 each turn from the 4 actives', () => {
    const combat = new CombatManager(makeRoom({ player: at(3, 8), enemies: [['guardian', at(3, 1)]] }), seededRng(3), createStarterDeck());
    const seen = new Set<string>();

    for (let turn = 0; turn < 12; turn++) {
      const hand = combat.getHand();
      expect(hand).toHaveLength(3);
      for (const card of hand) seen.add(card.program.id);
      combat.endPlayerTurn();
      runEnemyPhase(combat);
    }
    expect([...seen].sort()).toEqual(['brute_force', 'firewall_up', 'ping_flood', 'tran_yem']);
    expect(combat.deck.passives.map((program) => program.id)).toEqual(['incense_burn']);
  });
});
