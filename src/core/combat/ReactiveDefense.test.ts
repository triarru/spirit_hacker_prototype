import { describe, expect, it } from 'vitest';
import reactive from '../data/reactive.json';
import { PLAYER_DATA } from '../entities/Player';
import { CombatManager } from './CombatManager';
import {
  createDefensePrompt,
  defenseEffects,
  dodgeAnswer,
  dodgeDestination,
  gradeParry,
  ReactiveDefense,
  type DefenseResult,
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
  perfectWindowSeconds: parry.perfectWindowSeconds,
  goodToleranceSeconds: parry.goodToleranceSeconds,
};
const PERFECT = parry.perfectAtSeconds;
const HALF_WINDOW = parry.perfectWindowSeconds / 2;

describe('gradeParry', () => {
  it('is perfect inside the window around the moment the rings meet', () => {
    expect(gradeParry(PARRY_PROMPT, PERFECT)).toBe('perfect');
    expect(gradeParry(PARRY_PROMPT, PERFECT - HALF_WINDOW + 0.001)).toBe('perfect');
    expect(gradeParry(PARRY_PROMPT, PERFECT + HALF_WINDOW - 0.001)).toBe('perfect');
  });

  it('is good just outside the perfect window, early or late', () => {
    expect(gradeParry(PARRY_PROMPT, PERFECT - HALF_WINDOW - 0.01)).toBe('good');
    expect(gradeParry(PARRY_PROMPT, PERFECT + HALF_WINDOW + 0.01)).toBe('good');
    expect(gradeParry(PARRY_PROMPT, PERFECT - parry.goodToleranceSeconds + 0.001)).toBe('good');
  });

  it('is a miss beyond the good tolerance', () => {
    expect(gradeParry(PARRY_PROMPT, 0)).toBe('miss');
    expect(gradeParry(PARRY_PROMPT, PERFECT - parry.goodToleranceSeconds - 0.01)).toBe('miss');
  });

  it('leaves room for a late-but-good parry before the prompt ends', () => {
    expect(PERFECT + parry.goodToleranceSeconds).toBeLessThanOrEqual(parry.durationSeconds);
  });
});

describe('dodgeAnswer', () => {
  const player = at(3, 4);

  it('points back at the shooter along the axis the shot mostly travels', () => {
    expect(dodgeAnswer(at(3, 2), player)).toBe('up');
    expect(dodgeAnswer(at(3, 6), player)).toBe('down');
    expect(dodgeAnswer(at(1, 4), player)).toBe('left');
    expect(dodgeAnswer(at(5, 4), player)).toBe('right');
  });

  it('resolves the diagonals a hex grid produces', () => {
    // An adjacent diagonal neighbor sits 30° off horizontal: mostly sideways.
    expect(dodgeAnswer(at(2, 4), player)).toBe('left');
    expect(dodgeAnswer(at(4, 5), player)).toBe('right');
    // Two hexes out at 60° off horizontal: mostly vertical.
    expect(dodgeAnswer(at(2, 3), player)).toBe('up');
    expect(dodgeAnswer(at(4, 6), player)).toBe('down');
  });
});

describe('dodgeDestination', () => {
  it('goes straight up or down when asked', () => {
    const { grid } = makeRoom({ player: at(3, 4) });
    expect(dodgeDestination(grid, at(3, 4), 'up', at(3, 2))?.equals(at(3, 3))).toBe(true);
    expect(dodgeDestination(grid, at(3, 4), 'down', at(3, 6))?.equals(at(3, 5))).toBe(true);
  });

  it('picks the sideways neighbor nearer the shooter', () => {
    const { grid } = makeRoom({ player: at(3, 4) });
    // The two left-hand neighbors of (3, 4) are (2, 4) and (2, 5).
    expect(dodgeDestination(grid, at(3, 4), 'left', at(1, 3))?.equals(at(2, 4))).toBe(true);
    expect(dodgeDestination(grid, at(3, 4), 'left', at(1, 6))?.equals(at(2, 5))).toBe(true);
  });

  it('falls back to the other neighbor on that side when the first is blocked', () => {
    const { grid } = makeRoom({ player: at(3, 4), walls: [at(2, 4)] });
    expect(dodgeDestination(grid, at(3, 4), 'left', at(1, 3))?.equals(at(2, 5))).toBe(true);
  });

  it('returns null when that whole side is blocked or off the grid', () => {
    const { grid } = makeRoom({ player: at(3, 4), walls: [at(3, 3), at(2, 4), at(4, 4)] });
    expect(dodgeDestination(grid, at(3, 4), 'up', at(3, 2))).toBeNull();
    expect(dodgeDestination(grid, at(0, 4), 'left', at(0, 2))).toBeNull();
  });
});

describe('ReactiveDefense session', () => {
  it('grades a parry by when the input arrived', () => {
    const session = new ReactiveDefense(PARRY_PROMPT);
    session.advanceTo(0.5);
    expect(session.result).toBeNull();

    session.handleInput({ kind: 'parry' }, PERFECT);
    expect(session.result).toEqual({ kind: 'parry', grade: 'perfect' });
  });

  it('gives one attempt: an early press is a miss and later presses do nothing', () => {
    const session = new ReactiveDefense(PARRY_PROMPT);
    session.handleInput({ kind: 'parry' }, 0.2);
    session.handleInput({ kind: 'parry' }, PERFECT);
    expect(session.result).toEqual({ kind: 'parry', grade: 'miss' });
  });

  it('times out as a miss', () => {
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

  it('judges a dodge by direction, not timing', () => {
    const { player, enemies } = makeRoom({ player: at(3, 4), enemies: [['ghost_process', at(3, 2)]] });
    const [ghost] = enemies;
    if (!ghost) throw new Error('ghost missing');
    const prompt = createDefensePrompt(ghost, player);
    if (prompt?.kind !== 'dodge') throw new Error('expected a dodge prompt');
    expect(prompt.answer).toBe('up');

    const right = new ReactiveDefense(prompt);
    right.handleInput({ kind: 'dodge', direction: 'up' }, 0.01);
    expect(right.result).toEqual({ kind: 'dodge', grade: 'perfect', direction: 'up' });

    const wrong = new ReactiveDefense(prompt);
    wrong.handleInput({ kind: 'dodge', direction: 'down' }, 0.4);
    expect(wrong.result).toEqual({ kind: 'dodge', grade: 'miss', direction: 'down' });
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
  });
});

describe('enemy attacks resolved through CombatManager', () => {
  /** Ends the player turn with no AP left (so no dodge bonus) and applies the enemy's attack. */
  function attackWith(
    enemyType: string,
    enemyAt: ReturnType<typeof at>,
    defense: DefenseResult | null,
    walls: Array<ReturnType<typeof at>> = [],
  ) {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [[enemyType, enemyAt]], walls }),
      NEVER_DODGE,
    );
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

  it('perfect dodge: no damage and a free one-hex step toward the shooter', () => {
    const { combat, events } = attackWith('ghost_process', at(3, 2), {
      kind: 'dodge',
      grade: 'perfect',
      direction: 'up',
    });

    expect(combat.player.hp).toBe(combat.player.maxHp);
    expect(combat.player.position.equals(at(3, 3))).toBe(true);
    expect(combat.grid.getEntityAt(at(3, 3))).toBe(combat.player);
    expect(combat.grid.getEntityAt(at(3, 4))).toBeNull();
    expect(events.map((event) => event.type)).toEqual(['defended', 'moved']);
  });

  it('perfect dodge with nowhere to go still avoids the damage', () => {
    const { combat, events } = attackWith(
      'ghost_process',
      at(3, 2),
      { kind: 'dodge', grade: 'perfect', direction: 'up' },
      [at(3, 3), at(2, 4), at(4, 4)],
    );

    expect(combat.player.hp).toBe(combat.player.maxHp);
    expect(combat.player.position.equals(at(3, 4))).toBe(true);
    expect(events.map((event) => event.type)).toEqual(['defended']);
  });

  it('wrong-way dodge: full damage, no step', () => {
    const { combat, enemy } = attackWith('ghost_process', at(3, 2), {
      kind: 'dodge',
      grade: 'miss',
      direction: 'down',
    });

    expect(combat.player.hp).toBe(combat.player.maxHp - enemy.attackDamage);
    expect(combat.player.position.equals(at(3, 4))).toBe(true);
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
