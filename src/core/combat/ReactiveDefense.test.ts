import { describe, expect, it } from 'vitest';
import reactive from '../data/reactive.json';
import { PLAYER_DATA } from '../entities/Player';
import { CombatManager } from './CombatManager';
import {
  createDefensePrompt,
  defenseEffects,
  dodgeAnswer,
  dodgeDestination,
  gradeTiming,
  isAttempt,
  ReactiveDefense,
  type DefenseResult,
  type DodgePrompt,
  type ParryPrompt,
} from './ReactiveDefense';
import { at, makeRoom } from './testRoom';

const NEVER_DODGE = (): number => 0.999;
const { parry } = reactive;

const PARRY_PROMPT: ParryPrompt = {
  kind: 'parry',
  attackerId: 'enemy',
  durationSeconds: parry.durationSeconds,
  perfectAtSeconds: parry.perfectAtSeconds,
  perfectToleranceSeconds: parry.perfectToleranceSeconds,
  goodToleranceSeconds: parry.goodToleranceSeconds,
  judgeToleranceSeconds: parry.judgeToleranceSeconds,
};
const PERFECT = parry.perfectAtSeconds;
const PERFECT_TOLERANCE = parry.perfectToleranceSeconds;
/** The first moment a press counts as an attempt. */
const JUDGED_FROM = PERFECT - parry.judgeToleranceSeconds;

/** The dodge prompt for a ghost standing straight above the player: the way out is down. */
function dodgePrompt(): DodgePrompt {
  const { player, enemies } = makeRoom({ player: at(3, 4), enemies: [['ghost_process', at(3, 2)]] });
  const [ghost] = enemies;
  if (!ghost) throw new Error('ghost missing');
  const prompt = createDefensePrompt(ghost, player);
  if (prompt?.kind !== 'dodge') throw new Error('expected a dodge prompt');
  return prompt;
}

describe('gradeTiming', () => {
  it('is perfect within the perfect tolerance of the mark, early or late', () => {
    expect(gradeTiming(PARRY_PROMPT, PERFECT)).toBe('perfect');
    expect(gradeTiming(PARRY_PROMPT, PERFECT - PERFECT_TOLERANCE + 0.001)).toBe('perfect');
    expect(gradeTiming(PARRY_PROMPT, PERFECT + PERFECT_TOLERANCE - 0.001)).toBe('perfect');
  });

  it('is good just outside the perfect tolerance, early or late', () => {
    expect(gradeTiming(PARRY_PROMPT, PERFECT - PERFECT_TOLERANCE - 0.01)).toBe('good');
    expect(gradeTiming(PARRY_PROMPT, PERFECT + PERFECT_TOLERANCE + 0.01)).toBe('good');
    expect(gradeTiming(PARRY_PROMPT, PERFECT - parry.goodToleranceSeconds + 0.001)).toBe('good');
  });

  it('is a miss beyond the good tolerance', () => {
    expect(gradeTiming(PARRY_PROMPT, 0)).toBe('miss');
    expect(gradeTiming(PARRY_PROMPT, PERFECT - parry.goodToleranceSeconds - 0.01)).toBe('miss');
    expect(gradeTiming(PARRY_PROMPT, PERFECT + parry.goodToleranceSeconds + 0.01)).toBe('miss');
  });
});

describe('the timing rules in reactive.json', () => {
  it.each([
    ['parry', reactive.parry],
    ['dodge', reactive.dodge],
  ])('%s: the windows nest, and fit inside the prompt', (_name, rules) => {
    expect(rules.perfectToleranceSeconds).toBeLessThan(rules.goodToleranceSeconds);
    // Outside the good window but still judged: where an honest, mistimed press lands.
    expect(rules.goodToleranceSeconds).toBeLessThan(rules.judgeToleranceSeconds);
    expect(rules.perfectAtSeconds - rules.judgeToleranceSeconds).toBeGreaterThan(0);
    // A late-but-good press still fits before the prompt ends.
    expect(rules.perfectAtSeconds + rules.goodToleranceSeconds).toBeLessThanOrEqual(rules.durationSeconds);
  });

  it('gives a dodge time to read the arrow before anything is judged', () => {
    const { dodge } = reactive;
    expect(dodge.perfectAtSeconds - dodge.judgeToleranceSeconds).toBeGreaterThanOrEqual(0.35);
  });
});

describe('dodgeAnswer', () => {
  const player = at(3, 4);

  it('is the opposite of where the shooter is: away from the shot', () => {
    // Shooter above → dodge down; shooter to the left → dodge right; and so on.
    expect(dodgeAnswer(at(3, 2), player)).toBe('down');
    expect(dodgeAnswer(at(3, 6), player)).toBe('up');
    expect(dodgeAnswer(at(1, 4), player)).toBe('right');
    expect(dodgeAnswer(at(5, 4), player)).toBe('left');
  });

  it('resolves the diagonals a hex grid produces', () => {
    // An adjacent diagonal neighbor sits 30° off horizontal: mostly sideways.
    expect(dodgeAnswer(at(2, 4), player)).toBe('right');
    expect(dodgeAnswer(at(4, 5), player)).toBe('left');
    // Two hexes out at 60° off horizontal: mostly vertical.
    expect(dodgeAnswer(at(2, 3), player)).toBe('down');
    expect(dodgeAnswer(at(4, 6), player)).toBe('up');
  });
});

describe('dodgeDestination', () => {
  it('is the hex directly behind the defender, away from the shooter', () => {
    const { grid } = makeRoom({ player: at(3, 4) });
    expect(dodgeDestination(grid, at(3, 4), at(3, 2))).toEqual(at(3, 5));
    expect(dodgeDestination(grid, at(3, 4), at(3, 6))).toEqual(at(3, 3));
  });

  it('follows the hex direction of the shot, not the screen axis of the key', () => {
    const { grid } = makeRoom({ player: at(3, 4) });
    // Shot from the upper left neighbor: the hex behind is the lower right one.
    expect(dodgeDestination(grid, at(3, 4), at(2, 4))).toEqual(at(4, 5));
    // The same line from two hexes out.
    expect(dodgeDestination(grid, at(3, 4), at(1, 3))).toEqual(at(4, 5));
  });

  it('ends up one hex farther from the shooter', () => {
    const { grid } = makeRoom({ player: at(3, 4) });
    for (const shooter of at(3, 4).hexesInRange(2)) {
      if (shooter.equals(at(3, 4))) continue;
      const destination = dodgeDestination(grid, at(3, 4), shooter);
      expect(destination?.distance(at(3, 4))).toBe(1);
      expect(destination?.distance(shooter)).toBe(shooter.distance(at(3, 4)) + 1);
    }
  });

  it('is null when the hex behind is blocked: there is no falling back to another side', () => {
    const { grid } = makeRoom({ player: at(3, 4), walls: [at(3, 5)] });
    expect(dodgeDestination(grid, at(3, 4), at(3, 2))).toBeNull();
  });

  it('is null at the edge of the grid, or with an enemy standing behind', () => {
    const { grid } = makeRoom({ player: at(3, 8), enemies: [['crawler', at(3, 5)]] });
    expect(dodgeDestination(grid, at(3, 8), at(3, 6))).toBeNull();
    expect(dodgeDestination(grid, at(3, 4), at(3, 3))).toBeNull();
  });

  it('when the shot runs between two hex directions, takes whichever of the two is free', () => {
    // A shot along a row is exactly between the two hexes on the far side.
    const open = makeRoom({ player: at(3, 4) });
    const behind = [at(4, 4), at(4, 5)];
    const chosen = dodgeDestination(open.grid, at(3, 4), at(1, 4));
    expect(behind.some((hex) => chosen?.equals(hex))).toBe(true);

    for (const [blocked, free] of [behind, [...behind].reverse()]) {
      if (!blocked || !free) throw new Error('unreachable');
      const { grid } = makeRoom({ player: at(3, 4), walls: [blocked] });
      expect(dodgeDestination(grid, at(3, 4), at(1, 4))).toEqual(free);
    }
  });
});

describe('ReactiveDefense session', () => {
  it('grades a parry by when the input arrived', () => {
    const session = new ReactiveDefense(PARRY_PROMPT);
    session.advanceTo(0.5);
    expect(session.result).toBeNull();

    session.handleInput({ kind: 'parry' }, PERFECT);
    expect(session.result).toMatchObject({ kind: 'parry', grade: 'perfect' });
  });

  it('ignores a press long before the mark: it is not an attempt, and the real one still counts', () => {
    const session = new ReactiveDefense(PARRY_PROMPT);
    expect(isAttempt(PARRY_PROMPT, JUDGED_FROM - 0.01)).toBe(false);

    session.handleInput({ kind: 'parry' }, 0.05);
    session.handleInput({ kind: 'parry' }, JUDGED_FROM - 0.01);
    expect(session.result).toBeNull();

    session.handleInput({ kind: 'parry' }, PERFECT);
    expect(session.result).toMatchObject({ kind: 'parry', grade: 'perfect' });
  });

  it('gives one attempt: a press near the mark but too early is a miss, and later presses do nothing', () => {
    const session = new ReactiveDefense(PARRY_PROMPT);
    session.handleInput({ kind: 'parry' }, JUDGED_FROM + 0.01);
    session.handleInput({ kind: 'parry' }, PERFECT);

    expect(session.result).toMatchObject({ kind: 'parry', grade: 'miss', missedBy: 'early' });
  });

  it('says a press past the good window was too late', () => {
    const session = new ReactiveDefense(PARRY_PROMPT);
    session.handleInput({ kind: 'parry' }, PERFECT + parry.goodToleranceSeconds + 0.01);

    expect(session.result).toMatchObject({ kind: 'parry', grade: 'miss', missedBy: 'late' });
  });

  it('makes mashing lose: the first press that counts lands too early to be good', () => {
    // Eight presses a second, at every possible phase.
    const interval = 1 / 8;
    for (let phase = 0; phase < interval; phase += 0.005) {
      const session = new ReactiveDefense(PARRY_PROMPT);
      for (let press = phase; press < parry.durationSeconds; press += interval) {
        session.handleInput({ kind: 'parry' }, press);
      }
      expect(session.result?.grade).toBe('miss');
    }
  });

  it('reports how far off the mark the press was: negative early, positive late', () => {
    const at = (seconds: number) => {
      const session = new ReactiveDefense(PARRY_PROMPT);
      session.handleInput({ kind: 'parry' }, seconds);
      return session.result?.offBySeconds;
    };

    expect(at(PERFECT - 0.02)).toBeCloseTo(-0.02);
    expect(at(PERFECT + 0.03)).toBeCloseTo(0.03);
    // A miss is measured too: that is how the player learns which way they were off.
    expect(at(JUDGED_FROM + 0.01)).toBeCloseTo(0.01 - parry.judgeToleranceSeconds);
  });

  it('times out as a miss, with no reason and no offset', () => {
    const session = new ReactiveDefense(PARRY_PROMPT);
    session.advanceTo(parry.durationSeconds);
    expect(session.result).toEqual({ kind: 'parry', grade: 'miss' });
    expect(session.elapsedSeconds).toBe(parry.durationSeconds);
  });

  it('ignores input of the wrong kind and input after the time is up', () => {
    const session = new ReactiveDefense(PARRY_PROMPT);
    session.handleInput({ kind: 'dodge', direction: 'up' }, PERFECT);
    expect(session.result).toBeNull();

    session.handleInput({ kind: 'parry' }, parry.durationSeconds + 0.01);
    expect(session.result).toBeNull();
  });

  describe('dodge', () => {
    const { dodge } = reactive;
    const press = (direction: 'up' | 'down', atSeconds: number) => {
      const session = new ReactiveDefense(dodgePrompt());
      session.handleInput({ kind: 'dodge', direction }, atSeconds);
      return session.result;
    };

    it('needs the right direction at the right moment to be perfect', () => {
      expect(dodgePrompt().answer).toBe('down');
      expect(press('down', dodge.perfectAtSeconds)).toMatchObject({ kind: 'dodge', grade: 'perfect', direction: 'down' });
    });

    it('is only good when the direction is right but the timing is a little off', () => {
      const off = (dodge.perfectToleranceSeconds + dodge.goodToleranceSeconds) / 2;
      expect(press('down', dodge.perfectAtSeconds - off)).toMatchObject({ kind: 'dodge', grade: 'good', direction: 'down' });
      expect(press('down', dodge.perfectAtSeconds + off)).toMatchObject({ kind: 'dodge', grade: 'good', direction: 'down' });
    });

    it('misses when the direction is right but the timing is well off', () => {
      const off = dodge.goodToleranceSeconds + 0.02;
      expect(press('down', dodge.perfectAtSeconds - off)).toMatchObject({ grade: 'miss', missedBy: 'early' });
      expect(press('down', dodge.perfectAtSeconds + off)).toMatchObject({ grade: 'miss', missedBy: 'late' });
    });

    it('misses on the wrong direction, however good the timing', () => {
      expect(press('up', dodge.perfectAtSeconds)).toMatchObject({
        kind: 'dodge',
        grade: 'miss',
        direction: 'up',
        missedBy: 'wrong_way',
      });
    });

    it('ignores any key pressed while the arrow is still being read', () => {
      const session = new ReactiveDefense(dodgePrompt());
      session.handleInput({ kind: 'dodge', direction: 'up' }, 0.1);
      session.handleInput({ kind: 'dodge', direction: 'down' }, 0.2);
      expect(session.result).toBeNull();

      session.handleInput({ kind: 'dodge', direction: 'down' }, dodge.perfectAtSeconds);
      expect(session.result?.grade).toBe('perfect');
    });
  });
});

describe('defense prompts by attack type', () => {
  it('gives a parry for melee, a dodge for ranged, and nothing for AoE', () => {
    const { player, enemies } = makeRoom({
      player: at(3, 4),
      enemies: [['crawler', at(3, 3)], ['ghost_process', at(3, 6)]],
    });
    const [crawler, ghost] = enemies;
    if (!crawler || !ghost) throw new Error('enemies missing');

    expect(createDefensePrompt(crawler, player)?.kind).toBe('parry');
    expect(createDefensePrompt(ghost, player)?.kind).toBe('dodge');
    crawler.attackType = 'aoe';
    expect(createDefensePrompt(crawler, player)).toBeNull();
  });
});

describe('defenseEffects', () => {
  it('maps each outcome to its effect on the attack', () => {
    expect(defenseEffects(null).damageMultiplier).toBe(1);
    expect(defenseEffects({ kind: 'parry', grade: 'miss' }).damageMultiplier).toBe(1);
    expect(defenseEffects({ kind: 'parry', grade: 'good' })).toMatchObject({
      damageMultiplier: parry.goodDamageMultiplier,
      apBank: 0,
      firewallDamage: 0,
    });
    expect(defenseEffects({ kind: 'parry', grade: 'perfect' })).toMatchObject({
      damageMultiplier: 0,
      apBank: parry.perfectApBank,
      firewallDamage: parry.perfectFirewallDamage,
    });
    expect(defenseEffects({ kind: 'dodge', grade: 'perfect', direction: 'up' })).toMatchObject({
      damageMultiplier: 0,
      teleportHexes: reactive.dodge.perfectTeleportHexes,
    });
    expect(defenseEffects({ kind: 'dodge', grade: 'good', direction: 'up' })).toMatchObject({
      damageMultiplier: reactive.dodge.goodDamageMultiplier,
      teleportHexes: 0,
    });
    expect(defenseEffects({ kind: 'dodge', grade: 'miss', direction: 'up', missedBy: 'late' }).damageMultiplier).toBe(1);
  });
});

describe('enemy attacks resolved through CombatManager', () => {
  /** Ends the player turn with no AP left (so no dodge bonus) and applies the enemy's attack. */
  function attackWith(
    enemyType: string,
    enemyAt: ReturnType<typeof at>,
    defense: DefenseResult | null,
    /** Hexes the player cannot step onto. Terminals: they block movement but not a shot. */
    blocked: Array<ReturnType<typeof at>> = [],
  ) {
    const room = makeRoom({ player: at(3, 4), enemies: [[enemyType, enemyAt]] });
    for (const hex of blocked) room.grid.setTerrain(hex, 'TERMINAL');
    const combat = new CombatManager(room, NEVER_DODGE);
    const [enemy] = combat.enemies;
    if (!enemy) throw new Error('enemy missing');
    combat.player.ap = 0;
    combat.endPlayerTurn();

    const action = { type: 'attack', targetId: combat.player.id } as const;
    const prompt = combat.getDefensePrompt(enemy.id, action);
    const events = combat.applyEnemyAction(enemy.id, action, defense);
    return { combat, enemy, prompt, events };
  }

  it('offers a prompt only for an attack that can land', () => {
    const { combat, enemy, prompt } = attackWith('guardian', at(3, 3), null);
    expect(prompt?.kind).toBe('parry');
    expect(combat.getDefensePrompt(enemy.id, { type: 'move', to: at(3, 2) })).toBeNull();

    const far = attackWith('guardian', at(3, 0), null);
    expect(far.prompt).toBeNull();
  });

  it('perfect parry: no damage, +1 banked AP, -1 enemy firewall', () => {
    const { combat, enemy, events } = attackWith('guardian', at(3, 3), {
      kind: 'parry',
      grade: 'perfect',
    });

    expect(combat.player.hp).toBe(combat.player.maxHp);
    expect(combat.player.apBank).toBe(parry.perfectApBank);
    expect(enemy.firewallCurrent).toBe(enemy.firewallMax - parry.perfectFirewallDamage);
    expect(events).toEqual([
      {
        type: 'defended',
        kind: 'parry',
        grade: 'perfect',
        attackerId: enemy.id,
        at: at(3, 4),
        apBanked: parry.perfectApBank,
      },
    ]);

    combat.endEnemyPhase();
    expect(combat.player.ap).toBe(PLAYER_DATA.maxAp + parry.perfectApBank);
    expect(combat.player.apBank).toBe(0);
  });

  it('breaches the attacker when the parry strips its last firewall bar', () => {
    const { combat, enemy } = attackWith('guardian', at(3, 3), null);
    enemy.firewallCurrent = 1;
    const action = { type: 'attack', targetId: combat.player.id } as const;
    const events = combat.applyEnemyAction(enemy.id, action, { kind: 'parry', grade: 'perfect' });

    expect(enemy.firewallCurrent).toBe(0);
    expect(enemy.breached).toBe(true);
    expect(events.map((event) => event.type)).toEqual(['defended', 'breached']);
  });

  it('good parry: half damage, no bonus', () => {
    const { combat, enemy, events } = attackWith('guardian', at(3, 3), { kind: 'parry', grade: 'good' });
    const halved = Math.round(enemy.attackDamage * parry.goodDamageMultiplier);

    expect(combat.player.hp).toBe(combat.player.maxHp - halved);
    expect(combat.player.apBank).toBe(0);
    expect(enemy.firewallCurrent).toBe(enemy.firewallMax);
    expect(events.map((event) => event.type)).toEqual(['defended', 'attacked']);
  });

  it('missed or unanswered: full damage', () => {
    for (const defense of [null, { kind: 'parry', grade: 'miss' } as const]) {
      const { combat, enemy, events } = attackWith('guardian', at(3, 3), defense);
      expect(combat.player.hp).toBe(combat.player.maxHp - enemy.attackDamage);
      expect(events.map((event) => event.type)).toEqual(['attacked']);
    }
  });

  it('the dodge direction is opposite to where the enemy is', () => {
    const { prompt } = attackWith('ghost_process', at(3, 2), null);
    if (prompt?.kind !== 'dodge') throw new Error('expected a dodge prompt');
    expect(prompt.answer).toBe('down');
  });

  it('perfect dodge: no damage and a free one-hex step away from the shooter', () => {
    const { combat, enemy, events } = attackWith('ghost_process', at(3, 2), {
      kind: 'dodge',
      grade: 'perfect',
      direction: 'down',
    });

    expect(combat.player.hp).toBe(combat.player.maxHp);
    expect(combat.player.position.equals(at(3, 5))).toBe(true);
    expect(combat.grid.getEntityAt(at(3, 5))).toBe(combat.player);
    expect(combat.grid.getEntityAt(at(3, 4))).toBeNull();
    expect(combat.player.position.distance(enemy.position)).toBe(3);
    expect(events.map((event) => event.type)).toEqual(['defended', 'moved']);
  });

  it('blocked hex behind: the dodge still succeeds, with no teleport', () => {
    const { combat, events } = attackWith(
      'ghost_process',
      at(3, 2),
      { kind: 'dodge', grade: 'perfect', direction: 'down' },
      [at(3, 5)],
    );

    expect(combat.player.hp).toBe(combat.player.maxHp);
    expect(combat.player.position.equals(at(3, 4))).toBe(true);
    expect(events.map((event) => event.type)).toEqual(['defended']);
  });

  it('good dodge: a fraction of the damage gets through, and there is no step away', () => {
    const { combat, enemy, events } = attackWith('ghost_process', at(3, 2), {
      kind: 'dodge',
      grade: 'good',
      direction: 'down',
    });
    const grazed = Math.round(enemy.attackDamage * reactive.dodge.goodDamageMultiplier);

    expect(grazed).toBeGreaterThan(0);
    expect(combat.player.hp).toBe(combat.player.maxHp - grazed);
    expect(combat.player.position.equals(at(3, 4))).toBe(true);
    expect(events.map((event) => event.type)).toEqual(['defended', 'attacked']);
  });

  it('wrong-way dodge: full damage, no step, and the reason is reported', () => {
    const { combat, enemy, events } = attackWith('ghost_process', at(3, 2), {
      kind: 'dodge',
      grade: 'miss',
      direction: 'up',
      missedBy: 'wrong_way',
    });

    expect(combat.player.hp).toBe(combat.player.maxHp - enemy.attackDamage);
    expect(combat.player.position.equals(at(3, 4))).toBe(true);
    expect(events[0]).toEqual({
      type: 'defenseMissed',
      kind: 'dodge',
      reason: 'wrong_way',
      attackerId: enemy.id,
      at: at(3, 4),
    });
    expect(events.map((event) => event.type)).toEqual(['defenseMissed', 'attacked']);
  });

  it('a mistimed parry reports whether it was early or late', () => {
    const { events } = attackWith('guardian', at(3, 3), { kind: 'parry', grade: 'miss', missedBy: 'early' });
    expect(events[0]).toMatchObject({ type: 'defenseMissed', kind: 'parry', reason: 'early' });
  });

  it('lets the end-turn dodge bonus save a missed defense', () => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['guardian', at(3, 3)]] }),
      () => 0,
    );
    const [guardian] = combat.enemies;
    if (!guardian) throw new Error('guardian missing');
    combat.endPlayerTurn();

    const action = { type: 'attack', targetId: combat.player.id } as const;
    const events = combat.applyEnemyAction(guardian.id, action, { kind: 'parry', grade: 'miss' });

    expect(combat.player.hp).toBe(combat.player.maxHp);
    expect(events[0]).toMatchObject({ type: 'attacked', dodged: true });
  });
});
