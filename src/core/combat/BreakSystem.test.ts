import { describe, expect, it } from 'vitest';
import type { Enemy } from '../entities/Enemy';
import { PLAYER_DATA } from '../entities/Player';
import type { SpellTag } from '../programs/Program';
import { getProgram, PROGRAMS } from '../programs/ProgramRegistry';
import { SpellDeck } from '../programs/SpellDeck';
import {
  BREAK_RULES,
  breachDamageMultiplier,
  damageFirewall,
  firewallDamageForHit,
  tickBreach,
} from './BreakSystem';
import { CombatManager } from './CombatManager';
import { at, makeRoom, runEnemyPhase } from './testRoom';

const NEVER_DODGE = (): number => 0.999;
const { basicAttack } = PLAYER_DATA;
const { injectVirus } = BREAK_RULES;

function soloEnemy(typeId: string): Enemy {
  const [enemy] = makeRoom({ player: at(3, 4), enemies: [[typeId, at(3, 3)]] }).enemies;
  if (!enemy) throw new Error('enemy missing');
  return enemy;
}

describe('firewall', () => {
  it('loses 1 bar to a normal hit and 2 to a hit on its weakness', () => {
    const crawler = soloEnemy('crawler');
    expect(firewallDamageForHit(crawler, null)).toBe(BREAK_RULES.normalHitFirewallDamage);
    expect(firewallDamageForHit(crawler, 'FIRE')).toBe(BREAK_RULES.normalHitFirewallDamage);
    expect(firewallDamageForHit(crawler, crawler.weakness)).toBe(BREAK_RULES.weaknessHitFirewallDamage);
  });

  it('breaches when the last bar goes, and not before', () => {
    const guardian = soloEnemy('guardian');
    expect(damageFirewall(guardian, guardian.firewallMax - 1)).toBe(false);
    expect(guardian.breached).toBe(false);

    expect(damageFirewall(guardian, 5)).toBe(true);
    expect(guardian.firewallCurrent).toBe(0);
    expect(guardian.breached).toBe(true);
  });

  it('cannot be breached again while already breached', () => {
    const crawler = soloEnemy('crawler');
    damageFirewall(crawler, 99);
    expect(damageFirewall(crawler, 1)).toBe(false);
  });

  it('amplifies damage only while breached', () => {
    const crawler = soloEnemy('crawler');
    expect(breachDamageMultiplier(crawler)).toBe(1);
    damageFirewall(crawler, 99);
    expect(breachDamageMultiplier(crawler)).toBe(BREAK_RULES.breachDamageMultiplier);
  });

  it('sits out its skipped turn(s), then recovers one bar short of full', () => {
    const guardian = soloEnemy('guardian');
    expect(tickBreach(guardian)).toBe('not_breached');

    damageFirewall(guardian, 99);
    for (let turn = 0; turn < BREAK_RULES.breachSkippedTurns; turn++) {
      expect(tickBreach(guardian)).toBe('skip_turn');
      expect(guardian.breached).toBe(true);
    }
    expect(tickBreach(guardian)).toBe('recovered');
    expect(guardian.breached).toBe(false);
    expect(guardian.firewallCurrent).toBe(guardian.firewallMax - BREAK_RULES.recoveryFirewallPenalty);
  });

  it('never recovers to an empty firewall', () => {
    const crawler = soloEnemy('crawler');
    crawler.firewallMax = 1;
    crawler.firewallCurrent = 1;
    expect(damageFirewall(crawler, 1)).toBe(true);

    const ticks = Array.from({ length: BREAK_RULES.breachSkippedTurns + 1 }, () => tickBreach(crawler));
    expect(ticks.at(-1)).toBe('recovered');
    expect(crawler.firewallCurrent).toBe(1);
  });
});

describe('breach in combat', () => {
  /** Player at (3, 4) with a crawler above and a guardian below, both adjacent. */
  function setup() {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['crawler', at(3, 3)], ['guardian', at(3, 5)]] }),
      NEVER_DODGE,
    );
    const [crawler, guardian] = combat.enemies;
    if (!crawler || !guardian) throw new Error('enemies missing');
    return { combat, crawler, guardian };
  }

  it('basic attacks strip the firewall one bar at a time until it breaches', () => {
    const { combat, crawler } = setup();
    crawler.hp = crawler.maxHp = 500;
    combat.player.ap = crawler.firewallMax;

    for (let stripped = 1; stripped < crawler.firewallMax; stripped++) {
      expect(combat.playerAttack(crawler.id).map((event) => event.type)).toEqual(['attacked']);
      expect(crawler.firewallCurrent).toBe(crawler.firewallMax - stripped);
    }

    expect(combat.playerAttack(crawler.id).map((event) => event.type)).toEqual(['attacked', 'breached']);
    expect(crawler.breached).toBe(true);
  });

  it('deals amplified damage to a breached enemy, but not on the breaching hit itself', () => {
    const { combat, crawler } = setup();
    // Enough HP to survive all three hits, so the damage of each can be read off.
    crawler.hp = crawler.maxHp = 100;
    // Two bars left, so the second hit is the one that breaches.
    crawler.firewallCurrent = 2;
    combat.playerAttack(crawler.id);
    combat.playerAttack(crawler.id);
    expect(crawler.hp).toBe(crawler.maxHp - basicAttack.damage * 2);

    const [hit] = combat.playerAttack(crawler.id);
    const amplified = Math.round(basicAttack.damage * BREAK_RULES.breachDamageMultiplier);
    expect(hit).toMatchObject({ type: 'attacked', damage: amplified, amplified: true });
    expect(crawler.hp).toBe(crawler.maxHp - basicAttack.damage * 2 - amplified);
  });

  it('skips the breached enemy turn, keeps it breached for the next player turn, then lets it recover and act', () => {
    const { combat, crawler, guardian } = setup();
    // Enough HP to still be standing after three enemy attacks.
    combat.player.hp = combat.player.maxHp = 1000;
    crawler.firewallCurrent = 2;
    combat.playerAttack(crawler.id);
    combat.playerAttack(crawler.id);
    combat.player.ap = 0;

    // Enemy turn 1: the crawler sits out; the guardian still attacks.
    combat.endPlayerTurn();
    const first = runEnemyPhase(combat);
    expect(first).toContainEqual({
      type: 'turnSkipped',
      entityId: crawler.id,
      at: crawler.position,
      reason: 'breached',
    });
    expect(first.filter((event) => event.type === 'attacked')).toHaveLength(1);
    expect(combat.player.hp).toBe(combat.player.maxHp - guardian.attackDamage);

    // Player turn 2: still breached, still taking amplified damage.
    expect(crawler.breached).toBe(true);
    expect(combat.getInjectableEnemies()).toEqual([crawler]);

    // Enemy turn 2: it recovers and acts again.
    combat.player.ap = 0;
    combat.endPlayerTurn();
    const second = runEnemyPhase(combat);
    expect(second).toContainEqual({ type: 'recovered', entityId: crawler.id, at: crawler.position });
    expect(crawler.breached).toBe(false);
    expect(crawler.firewallCurrent).toBe(crawler.firewallMax - BREAK_RULES.recoveryFirewallPenalty);
    expect(second.filter((event) => event.type === 'attacked')).toHaveLength(2);
  });

  it('a kill takes precedence over a breach', () => {
    const { combat, crawler } = setup();
    crawler.hp = basicAttack.damage;
    crawler.firewallCurrent = 1;

    expect(combat.playerAttack(crawler.id).map((event) => event.type)).toEqual(['attacked', 'died']);
  });
});

describe('inject virus', () => {
  /** A breached crawler next to the player, with a guardian 2 hexes and a ghost 4 hexes from it. */
  function setup() {
    const combat = new CombatManager(
      makeRoom({
        player: at(3, 4),
        enemies: [['crawler', at(3, 3)], ['ghost_process', at(3, 7)], ['guardian', at(3, 1)]],
      }),
      NEVER_DODGE,
    );
    const [crawler, ghost, guardian] = combat.enemies;
    if (!crawler || !ghost || !guardian) throw new Error('enemies missing');
    damageFirewall(crawler, 99);
    return { combat, crawler, ghost, guardian };
  }

  it('is offered only for breached enemies', () => {
    const { combat, crawler, guardian } = setup();
    expect(combat.getInjectableEnemies()).toEqual([crawler]);
    expect(combat.injectVirus(guardian.id)).toEqual([]);
  });

  it('makes the breached enemy hit its nearest ally, for AP and RAM', () => {
    const { combat, crawler, ghost, guardian } = setup();
    const events = combat.injectVirus(crawler.id);

    expect(combat.player.ap).toBe(combat.player.maxAp - injectVirus.apCost);
    expect(combat.player.ram).toBe(combat.player.maxRam - injectVirus.ramCost);
    expect(guardian.hp).toBe(guardian.maxHp - injectVirus.damage);
    // A forced blow is not one of the player's hits: the ally's firewall is untouched.
    expect(guardian.firewallCurrent).toBe(guardian.firewallMax);
    expect(ghost.hp).toBe(ghost.maxHp);
    expect(crawler.hp).toBe(crawler.maxHp);
    expect(events.map((event) => event.type)).toEqual(['virusInjected', 'attacked']);
    expect(events[1]).toMatchObject({ attackerId: crawler.id, targetId: guardian.id });
  });

  it('never breaches the ally it hits, however weak that ally\'s firewall is', () => {
    const { combat, crawler, guardian } = setup();
    guardian.hp = guardian.maxHp = 500;
    guardian.firewallCurrent = 1;

    const events = combat.injectVirus(crawler.id);

    expect(events.map((event) => event.type)).toEqual(['virusInjected', 'attacked']);
    expect([guardian.firewallCurrent, guardian.breached]).toEqual([1, false]);
    // No breach means no second virus to pass on: the chain stops here.
    expect(combat.getInjectableEnemies()).toEqual([]);
  });

  it('does the same damage whichever enemy carries it, however hard that enemy hits', () => {
    const { combat, crawler, guardian } = setup();
    guardian.hp = guardian.maxHp = 500;
    crawler.attackDamage = 99;

    combat.injectVirus(crawler.id);

    expect(guardian.hp).toBe(500 - injectVirus.damage);
  });

  it('still hits a breached ally for amplified damage', () => {
    const { combat, crawler, guardian } = setup();
    guardian.hp = guardian.maxHp = 500;
    damageFirewall(guardian, 99);

    combat.injectVirus(crawler.id);

    expect(guardian.hp).toBe(500 - Math.round(injectVirus.damage * BREAK_RULES.breachDamageMultiplier));
  });

  it('needs enough AP and enough RAM', () => {
    const { combat, crawler } = setup();
    combat.player.ram = injectVirus.ramCost - 1;
    expect(combat.getInjectableEnemies()).toEqual([]);
    expect(combat.injectVirus(crawler.id)).toEqual([]);

    combat.player.ram = combat.player.maxRam;
    combat.player.ap = 0;
    expect(combat.injectVirus(crawler.id)).toEqual([]);
    expect(combat.player.ram).toBe(combat.player.maxRam);
  });

  it('is unavailable when the breached enemy has no ally left', () => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['crawler', at(3, 3)]] }),
    );
    const [crawler] = combat.enemies;
    if (!crawler) throw new Error('crawler missing');
    damageFirewall(crawler, 99);

    expect(combat.getInjectableEnemies()).toEqual([]);
  });

  it('can finish off the ally, and wins the fight if the player then kills the last enemy', () => {
    const { combat, crawler, ghost, guardian } = setup();
    guardian.hp = 1;
    const events = combat.injectVirus(crawler.id);

    expect(events.map((event) => event.type)).toEqual(['virusInjected', 'attacked', 'died']);
    expect(combat.enemies).toEqual([crawler, ghost]);
    expect(combat.phase).toBe('PLAYER_TURN');
  });

  it('works once per breach', () => {
    const { combat, crawler, guardian } = setup();
    guardian.hp = guardian.maxHp = 500;

    expect(combat.injectVirus(crawler.id).length).toBeGreaterThan(0);
    expect(crawler.virusInjected).toBe(true);
    expect(guardian.hp).toBe(500 - injectVirus.damage);
  });

  it('is blocked on a second attempt during the same breach', () => {
    const { combat, crawler, guardian } = setup();
    guardian.hp = guardian.maxHp = 500;
    combat.injectVirus(crawler.id);
    const [apAfter, ramAfter] = [combat.player.ap, combat.player.ram];

    expect(combat.getInjectableEnemies()).toEqual([]);
    expect(combat.injectVirus(crawler.id)).toEqual([]);
    expect(guardian.hp).toBe(500 - injectVirus.damage);
    expect([combat.player.ap, combat.player.ram]).toEqual([apAfter, ramAfter]);
  });

  it('can be used again on a new breach, after the enemy has recovered', () => {
    const { combat, crawler, guardian } = setup();
    guardian.hp = guardian.maxHp = 500;
    combat.injectVirus(crawler.id);

    // Sit out its skipped turn, then recover: the flag clears with the breach.
    const ticks = Array.from({ length: BREAK_RULES.breachSkippedTurns + 1 }, () => tickBreach(crawler));
    expect(ticks.at(-1)).toBe('recovered');
    expect([crawler.breached, crawler.virusInjected]).toEqual([false, false]);
    expect(combat.getInjectableEnemies()).toEqual([]);

    damageFirewall(crawler, 99);
    expect(combat.getInjectableEnemies()).toEqual([crawler]);
    expect(combat.injectVirus(crawler.id).length).toBeGreaterThan(0);
  });

  it('cannot be used outside the player turn', () => {
    const { combat, crawler } = setup();
    combat.endPlayerTurn();
    expect(combat.injectVirus(crawler.id)).toEqual([]);
  });
});

describe('program tags against the crawler (weak to SHOCK)', () => {
  const cast = (programId: string, weakness?: SpellTag) => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['crawler', at(3, 3)]] }),
      NEVER_DODGE,
      new SpellDeck({ actives: [{ program: getProgram(programId), modifier: null }], passives: [], handSize: 1 }),
    );
    const [crawler] = combat.enemies;
    if (!crawler) throw new Error('crawler missing');
    crawler.hp = crawler.maxHp = 500;
    if (weakness) crawler.weakness = weakness;
    const events = combat.castSpell(0, crawler.position);
    return { combat, crawler, events };
  };

  it('brute_force is FIRE: against the crawler it strips 1 bar, like any normal hit', () => {
    const { crawler } = cast('brute_force');
    expect(getProgram('brute_force').tag).toBe('FIRE');
    expect(crawler.firewallCurrent).toBe(crawler.firewallMax - BREAK_RULES.normalHitFirewallDamage);
    expect(crawler.breached).toBe(false);
  });

  it('normal hits take three to breach a crawler', () => {
    const { combat, crawler } = cast('brute_force');
    expect(crawler.firewallMax).toBe(3);
    expect(crawler.breached).toBe(false);

    // The card is spent; the hits that follow are basic attacks.
    combat.playerAttack(crawler.id);
    expect(crawler.breached).toBe(false);
    combat.playerAttack(crawler.id);
    expect(crawler.breached).toBe(true);
  });

  it('brute_force strips 2 bars from an enemy that is weak to FIRE', () => {
    const { crawler } = cast('brute_force', 'FIRE');
    expect(crawler.firewallCurrent).toBe(crawler.firewallMax - BREAK_RULES.weaknessHitFirewallDamage);
  });

  it('nmap_scan is SHOCK: against the crawler it strips 2 bars, and does no damage', () => {
    const { crawler, events } = cast('nmap_scan');
    expect(getProgram('nmap_scan').tag).toBe('SHOCK');
    expect(crawler.firewallCurrent).toBe(crawler.firewallMax - BREAK_RULES.weaknessHitFirewallDamage);
    expect(crawler.breached).toBe(false);
    expect(crawler.hp).toBe(500);
    expect(events.map((event) => event.type)).toEqual(['spellCast']);
  });

  it('a hit on its weakness saves one hit: nmap_scan, then any second hit, breaches', () => {
    const { combat, crawler } = cast('nmap_scan');

    expect(combat.playerAttack(crawler.id).map((event) => event.type)).toEqual(['attacked', 'breached']);
    expect(crawler.breached).toBe(true);
  });

  it('no single cast breaches a crawler at full firewall, whatever is slotted with it', () => {
    const ids = Object.keys(PROGRAMS);
    const orNone = <T,>(options: T[]): Array<T | null> => [null, ...options];
    let checked = 0;

    for (const activeId of ids) {
      for (const modifierId of orNone(ids.filter((id) => id !== activeId))) {
        for (const passiveId of orNone(ids.filter((id) => id !== activeId && id !== modifierId))) {
          const combat = new CombatManager(
            makeRoom({ player: at(3, 4), enemies: [['crawler', at(3, 3)]] }),
            NEVER_DODGE,
            new SpellDeck({
              actives: [{ program: getProgram(activeId), modifier: modifierId ? getProgram(modifierId) : null }],
              passives: passiveId ? [getProgram(passiveId)] : [],
              handSize: 1,
            }),
          );
          const [crawler] = combat.enemies;
          if (!crawler) throw new Error('crawler missing');
          crawler.hp = crawler.maxHp = 500;

          for (const hit of combat.previewSpell(0, crawler.position)?.hits ?? []) {
            expect(hit.breaches, `${activeId} + ${modifierId} + ${passiveId}`).toBe(false);
            checked += 1;
          }
        }
      }
    }
    // Every program that can be aimed at an enemy was tried, in every pairing.
    expect(checked).toBeGreaterThan(50);
  });

  it('nmap_scan with tran_yem under it strips no more than nmap_scan alone', () => {
    const stripped = (modifier: string | null) => {
      const combat = new CombatManager(
        makeRoom({ player: at(3, 4), enemies: [['guardian', at(3, 2)]] }),
        NEVER_DODGE,
        new SpellDeck({
          actives: [{ program: getProgram('nmap_scan'), modifier: modifier ? getProgram(modifier) : null }],
          passives: [],
          handSize: 1,
        }),
      );
      const [guardian] = combat.enemies;
      if (!guardian) throw new Error('guardian missing');
      expect(combat.previewSpell(0, guardian.position)?.hits[0]?.firewallDamage).toBe(
        BREAK_RULES.normalHitFirewallDamage,
      );
      combat.castSpell(0, guardian.position);
      return guardian.firewallMax - guardian.firewallCurrent;
    };

    expect(stripped('tran_yem')).toBe(BREAK_RULES.normalHitFirewallDamage);
    expect(stripped('tran_yem')).toBe(stripped(null));
  });

  it('a damaging spell with tran_yem under it does strip the extra bar', () => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['guardian', at(3, 3)]] }),
      NEVER_DODGE,
      new SpellDeck({
        actives: [{ program: getProgram('brute_force'), modifier: getProgram('tran_yem') }],
        passives: [],
        handSize: 1,
      }),
    );
    const [guardian] = combat.enemies;
    if (!guardian) throw new Error('guardian missing');
    combat.castSpell(0, guardian.position);

    expect(guardian.firewallCurrent).toBe(guardian.firewallMax - BREAK_RULES.normalHitFirewallDamage - 1);
  });

  it('nmap_scan reaches an enemy 4 hexes away, and no further', () => {
    const scanFrom = (crawlerAt: ReturnType<typeof at>) =>
      new CombatManager(
        makeRoom({ player: at(3, 8), enemies: [['crawler', crawlerAt]] }),
        NEVER_DODGE,
        new SpellDeck({ actives: [{ program: getProgram('nmap_scan'), modifier: null }], passives: [], handSize: 1 }),
      );

    expect(scanFrom(at(3, 4)).getSpellTargets(0)).toEqual([at(3, 4)]);

    const tooFar = scanFrom(at(3, 3));
    expect(tooFar.getSpellTargets(0)).toEqual([]);
    expect(tooFar.castSpell(0, at(3, 3))).toEqual([]);
    expect(tooFar.player.ap).toBe(tooFar.player.maxAp);
  });
});
