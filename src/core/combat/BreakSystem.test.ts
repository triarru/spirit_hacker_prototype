import { describe, expect, it } from 'vitest';
import type { Enemy } from '../entities/Enemy';
import { PLAYER_DATA } from '../entities/Player';
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

    expect(combat.playerAttack(crawler.id).map((event) => event.type)).toEqual(['attacked']);
    expect(crawler.firewallCurrent).toBe(crawler.firewallMax - 1);

    expect(combat.playerAttack(crawler.id).map((event) => event.type)).toEqual(['attacked', 'breached']);
    expect(crawler.breached).toBe(true);
  });

  it('deals amplified damage to a breached enemy, but not on the breaching hit itself', () => {
    const { combat, crawler } = setup();
    // Enough HP to survive all three hits, so the damage of each can be read off.
    crawler.hp = crawler.maxHp = 100;
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
    expect(guardian.hp).toBe(guardian.maxHp - crawler.attackDamage);
    expect(guardian.firewallCurrent).toBe(guardian.firewallMax - BREAK_RULES.normalHitFirewallDamage);
    expect(ghost.hp).toBe(ghost.maxHp);
    expect(crawler.hp).toBe(crawler.maxHp);
    expect(events.map((event) => event.type)).toEqual(['virusInjected', 'attacked']);
    expect(events[1]).toMatchObject({ attackerId: crawler.id, targetId: guardian.id });
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

  it('cannot be used outside the player turn', () => {
    const { combat, crawler } = setup();
    combat.endPlayerTurn();
    expect(combat.injectVirus(crawler.id)).toEqual([]);
  });
});
