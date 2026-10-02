import { describe, expect, it } from 'vitest';
import type { HexCoord } from '../hex/HexCoord';
import { BREAK_RULES } from './BreakSystem';
import { CombatManager } from './CombatManager';
import { HACK_RULES, hackableHexes, hackKindsAt, TRAP_ID, TURRET_ID } from './EnvironmentHack';
import { at, makeRoom, runEnemyPhase } from './testRoom';

const NEVER_DODGE = (): number => 0.999;
const { turret, trap, wall, breakWall } = HACK_RULES;
const types = (events: Array<{ type: string }>): string[] => events.map((event) => event.type);

interface Setup {
  cols?: number;
  rows?: number;
  player?: HexCoord;
  enemies: Array<[string, HexCoord]>;
  walls?: HexCoord[];
  terminals?: HexCoord[];
}

function setup({ player = at(3, 4), terminals = [], ...room }: Setup) {
  const state = makeRoom({ player, ...room });
  for (const hex of terminals) state.grid.setTerrain(hex, 'TERMINAL');
  const combat = new CombatManager(state, NEVER_DODGE);
  return { combat, grid: combat.grid, enemies: combat.enemies.slice() };
}

/** Ends the player turn with no AP to spare (so no dodge bonus) and plays the enemy turn. */
function passTurn(combat: CombatManager) {
  combat.player.ap = 0;
  combat.endPlayerTurn();
  return runEnemyPhase(combat);
}

describe('what can be hacked', () => {
  it('depends on what is on the hex', () => {
    const { grid } = setup({
      enemies: [['crawler', at(3, 2)]],
      walls: [at(2, 4)],
      terminals: [at(4, 4)],
    });
    grid.setTerrain(at(3, 5), 'VEIL_TEAR');
    grid.setTerrain(at(2, 5), 'OBSTACLE');

    expect(hackKindsAt(grid, at(3, 3))).toEqual(['TRAP', 'WALL']);
    expect(hackKindsAt(grid, at(4, 4))).toEqual(['TURRET']);
    expect(hackKindsAt(grid, at(2, 4))).toEqual(['BREAK_WALL']);
    // Occupied floor, the veil tear, an obstacle, and off the grid: nothing.
    expect(hackKindsAt(grid, at(3, 2))).toEqual([]);
    expect(hackKindsAt(grid, at(3, 4))).toEqual([]);
    expect(hackKindsAt(grid, at(3, 5))).toEqual([]);
    expect(hackKindsAt(grid, at(2, 5))).toEqual([]);
    expect(hackKindsAt(grid, at(30, 30))).toEqual([]);
  });

  it('is limited to hexes within range of the player', () => {
    const { grid } = setup({ enemies: [['crawler', at(0, 0)]] });
    const hexes = hackableHexes(grid, at(3, 4));
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) {
      expect(hex.distance(at(3, 4))).toBeGreaterThanOrEqual(1);
      expect(hex.distance(at(3, 4))).toBeLessThanOrEqual(HACK_RULES.range);
    }
    expect(hexes.some((hex) => hex.equals(at(3, 1)))).toBe(true);
    expect(hexes.some((hex) => hex.equals(at(3, 0)))).toBe(false);
  });
});

describe('hacking', () => {
  it('costs 1 AP plus the RAM of the hack, and reports what was done', () => {
    const { combat, grid } = setup({ enemies: [['guardian', at(0, 0)]], terminals: [at(3, 3)] });

    const events = combat.hack(at(3, 3), 'TURRET');

    expect(events).toEqual([{ type: 'hacked', kind: 'TURRET', at: at(3, 3) }, { type: 'terrainChanged' }]);
    expect(combat.player.ap).toBe(combat.player.maxAp - HACK_RULES.apCost);
    expect(combat.player.ram).toBe(combat.player.maxRam - turret.ramCost);
    expect(grid.getCell(at(3, 3))).toMatchObject({ hacked: 'TURRET', hackTurns: turret.turns });
    // A terminal that is already a turret cannot be hacked again.
    expect(combat.getHackOptions(at(3, 3))).toEqual([]);
  });

  it('prices each hack from hacks.json', () => {
    const { combat } = setup({ enemies: [['guardian', at(0, 0)]], walls: [at(2, 4)], terminals: [at(4, 4)] });
    const cost = (hex: HexCoord) => combat.getHackOptions(hex).map((option) => [option.kind, option.ramCost]);

    expect(cost(at(3, 3))).toEqual([['TRAP', trap.ramCost], ['WALL', wall.ramCost]]);
    expect(cost(at(4, 4))).toEqual([['TURRET', turret.ramCost]]);
    expect(cost(at(2, 4))).toEqual([['BREAK_WALL', breakWall.ramCost]]);
  });

  it('refuses a hack that is out of range, unaffordable, the wrong kind, or out of turn', () => {
    const { combat, grid } = setup({ enemies: [['guardian', at(0, 0)]], terminals: [at(3, 3), at(3, 0)] });
    const untouched = () => expect(grid.allCells().every((cell) => cell.hacked === null)).toBe(true);

    expect(combat.hack(at(3, 0), 'TURRET')).toEqual([]);
    expect(combat.hack(at(3, 3), 'TRAP')).toEqual([]);
    untouched();

    combat.player.ram = turret.ramCost - 1;
    expect(combat.getHackOptions(at(3, 3))).toMatchObject([{ kind: 'TURRET', affordable: false }]);
    expect(combat.getHackTargets().some((hex) => hex.equals(at(3, 3)))).toBe(false);
    expect(combat.hack(at(3, 3), 'TURRET')).toEqual([]);
    untouched();

    combat.player.ram = combat.player.maxRam;
    combat.player.ap = 0;
    expect(combat.getHackTargets()).toEqual([]);
    expect(combat.hack(at(3, 3), 'TURRET')).toEqual([]);
    untouched();

    combat.player.ap = 3;
    combat.endPlayerTurn();
    expect(combat.getHackTargets()).toEqual([]);
    expect(combat.hack(at(3, 3), 'TURRET')).toEqual([]);
    untouched();
  });
});

describe('turret', () => {
  it('shoots the nearest enemy in range each enemy turn: 8 damage and 1 firewall bar', () => {
    const { combat, enemies } = setup({
      enemies: [['guardian', at(3, 1)], ['guardian', at(3, 0)]],
      terminals: [at(3, 3)],
    });
    const [near, far] = enemies;
    if (!near || !far) throw new Error('enemies missing');
    combat.hack(at(3, 3), 'TURRET');

    const events = passTurn(combat);

    expect(near.hp).toBe(near.maxHp - turret.damage);
    expect(near.firewallCurrent).toBe(near.firewallMax - BREAK_RULES.normalHitFirewallDamage);
    expect(far.hp).toBe(far.maxHp);
    expect(events).toContainEqual({ type: 'turretFired', at: at(3, 3), targetId: near.id, targetAt: at(3, 1) });
    expect(events).toContainEqual(expect.objectContaining({ type: 'attacked', attackerId: TURRET_ID, damage: turret.damage }));
  });

  it('ignores enemies beyond its range', () => {
    const { combat, enemies } = setup({ enemies: [['guardian', at(3, 7)]], terminals: [at(3, 3)] });
    combat.hack(at(3, 3), 'TURRET');

    const events = passTurn(combat);

    expect(enemies[0]?.hp).toBe(enemies[0]?.maxHp);
    expect(types(events)).not.toContain('turretFired');
  });

  it('runs for 3 enemy turns, then shuts down and frees the terminal', () => {
    const { combat, grid, enemies } = setup({ enemies: [['guardian', at(3, 1)]], terminals: [at(3, 3)] });
    const [guardian] = enemies;
    if (!guardian) throw new Error('guardian missing');
    guardian.hp = guardian.maxHp = 500;
    combat.hack(at(3, 3), 'TURRET');

    for (let turn = 1; turn <= turret.turns; turn++) {
      expect(grid.getCell(at(3, 3))?.hacked).toBe('TURRET');
      const events = passTurn(combat);
      expect(types(events).includes('turretExpired')).toBe(turn === turret.turns);
    }

    expect(guardian.hp).toBeLessThanOrEqual(500 - turret.damage * turret.turns);
    expect(grid.getCell(at(3, 3))).toMatchObject({ hacked: null, hackTurns: 0 });
    expect(types(passTurn(combat))).not.toContain('turretFired');
    expect(combat.getHackOptions(at(3, 3)).map((option) => option.kind)).toEqual(['TURRET']);
  });

  it('wins the fight outright when it kills the last enemy', () => {
    const { combat, enemies } = setup({ enemies: [['guardian', at(3, 1)]], terminals: [at(3, 3)] });
    const [guardian] = enemies;
    if (!guardian) throw new Error('guardian missing');
    guardian.hp = turret.damage;
    combat.hack(at(3, 3), 'TURRET');

    const events = passTurn(combat);

    expect(combat.phase).toBe('VICTORY');
    expect(types(events)).toEqual(['turretFired', 'attacked', 'died', 'terrainChanged', 'phaseChanged']);
    expect(combat.turn).toBe(1);
  });
});

describe('trap', () => {
  /** A 1-wide corridor: the crawler at the top has to walk straight down to the player. */
  function corridor() {
    const { combat, grid, enemies } = setup({
      cols: 1,
      rows: 6,
      player: at(0, 5),
      enemies: [['crawler', at(0, 0)]],
    });
    const [crawler] = enemies;
    if (!crawler) throw new Error('crawler missing');
    return { combat, grid, crawler };
  }

  it('goes off under the first enemy to step on it: 10 damage, 1 firewall bar, slowed', () => {
    const { combat, grid, crawler } = corridor();
    expect(types(combat.hack(at(0, 2), 'TRAP'))).toEqual(['hacked', 'terrainChanged']);
    expect(combat.player.ram).toBe(combat.player.maxRam - trap.ramCost);

    // Turn 1: the crawler walks to (0, 1). Nothing happens yet.
    expect(types(passTurn(combat))).not.toContain('trapTriggered');
    expect(grid.getCell(at(0, 2))?.hacked).toBe('TRAP');

    // Turn 2: it steps onto the trap.
    const events = passTurn(combat);
    expect(crawler.position.equals(at(0, 2))).toBe(true);
    expect(events).toContainEqual({ type: 'trapTriggered', entityId: crawler.id, at: at(0, 2) });
    expect(events).toContainEqual(expect.objectContaining({ type: 'attacked', attackerId: TRAP_ID, damage: trap.damage }));
    expect(events).toContainEqual({ type: 'slowed', entityId: crawler.id, at: at(0, 2), turns: trap.slowTurns });
    expect(crawler.hp).toBe(crawler.maxHp - trap.damage);
    expect(crawler.firewallCurrent).toBe(crawler.firewallMax - BREAK_RULES.normalHitFirewallDamage);
    // A trap works once.
    expect(grid.getCell(at(0, 2))?.hacked).toBeNull();
  });

  it('slows the enemy for its next turn only', () => {
    const { combat, crawler } = corridor();
    combat.hack(at(0, 2), 'TRAP');
    passTurn(combat);
    passTurn(combat);
    expect(crawler.position.equals(at(0, 2))).toBe(true);

    // Slowed: a crawler moves 1 hex a turn, so this turn it goes nowhere.
    passTurn(combat);
    expect(crawler.position.equals(at(0, 2))).toBe(true);

    passTurn(combat);
    expect(crawler.position.equals(at(0, 3))).toBe(true);
  });

  it('interrupts movement: the enemy stops on the trap even with movement left', () => {
    const { combat, crawler } = corridor();
    crawler.moveRange = 3;
    combat.hack(at(0, 2), 'TRAP');

    // Three hexes of movement would carry it to (0, 3); the trap at (0, 2) stops it there.
    const events = passTurn(combat);
    expect(crawler.position.equals(at(0, 2))).toBe(true);
    expect(events.filter((event) => event.type === 'moved')).toHaveLength(2);
    expect(combat.isTurnOver(crawler.id)).toBe(true);
  });

  it('interrupts the attack: an enemy that steps onto a trap next to the player does not strike', () => {
    const { combat, grid, crawler } = corridor();
    combat.hack(at(0, 4), 'TRAP');
    grid.moveEntity(crawler, at(0, 3));

    // Its plan was "step to (0, 4), then attack". The trap cancels the attack.
    const events = passTurn(combat);
    expect(crawler.position.equals(at(0, 4))).toBe(true);
    expect(events.filter((event) => event.type === 'attacked')).toEqual([
      expect.objectContaining({ attackerId: TRAP_ID, targetId: crawler.id }),
    ]);
    expect(combat.player.hp).toBe(combat.player.maxHp);
  });

  it('offers no reaction prompt for the attack the trap cancelled', () => {
    /** The crawler steps next to the player; returns whether its attack then gets a prompt. */
    const promptAfterStep = (withTrap: boolean) => {
      const { combat, grid, crawler } = corridor();
      if (withTrap) combat.hack(at(0, 4), 'TRAP');
      grid.moveEntity(crawler, at(0, 3));
      combat.player.ap = 0;
      combat.endPlayerTurn();
      combat.startEnemyTurn(crawler.id);

      const [move, attack] = combat.planEnemyTurn(crawler.id);
      if (move?.type !== 'move' || attack?.type !== 'attack') throw new Error('expected move then attack');
      combat.applyEnemyAction(crawler.id, move);
      return { prompt: combat.getDefensePrompt(crawler.id, attack), attackEvents: combat.applyEnemyAction(crawler.id, attack) };
    };

    const normal = promptAfterStep(false);
    expect(normal.prompt?.kind).toBe('parry');
    expect(normal.attackEvents.length).toBeGreaterThan(0);

    const trapped = promptAfterStep(true);
    expect(trapped.prompt).toBeNull();
    expect(trapped.attackEvents).toEqual([]);
  });

  it('only costs the enemy that one turn: slowed but adjacent, it attacks on the next', () => {
    const { combat, grid, crawler } = corridor();
    combat.hack(at(0, 4), 'TRAP');
    grid.moveEntity(crawler, at(0, 3));

    passTurn(combat);
    expect(combat.player.hp).toBe(combat.player.maxHp);

    passTurn(combat);
    expect(combat.player.hp).toBe(combat.player.maxHp - crawler.attackDamage);
  });

  it('trap + breach: the enemy is stunned for the next turn, once, then acts again', () => {
    const { combat, grid, crawler } = corridor();
    crawler.hp = crawler.maxHp = 500;
    crawler.firewallCurrent = 1;
    combat.hack(at(0, 4), 'TRAP');
    grid.moveEntity(crawler, at(0, 3));

    // Turn 1: trap goes off, the last firewall bar goes, the turn is interrupted.
    const first = passTurn(combat);
    expect(types(first)).toContain('breached');
    expect(combat.player.hp).toBe(combat.player.maxHp);

    // Turn 2: the breach costs it this turn. Exactly one skip, not two.
    const second = passTurn(combat);
    expect(second.filter((event) => event.type === 'turnSkipped')).toHaveLength(1);
    expect(combat.player.hp).toBe(combat.player.maxHp);

    // Turn 3: it recovers and strikes.
    const third = passTurn(combat);
    expect(types(third)).toContain('recovered');
    expect(types(third)).not.toContain('turnSkipped');
    expect(combat.player.hp).toBe(combat.player.maxHp - crawler.attackDamage);
  });

  it('can breach, and can kill', () => {
    const breaching = corridor();
    breaching.crawler.firewallCurrent = 1;
    breaching.combat.hack(at(0, 2), 'TRAP');
    passTurn(breaching.combat);
    expect(types(passTurn(breaching.combat))).toContain('breached');

    const killing = corridor();
    killing.crawler.hp = trap.damage;
    killing.combat.hack(at(0, 2), 'TRAP');
    passTurn(killing.combat);
    const events = passTurn(killing.combat);
    expect(types(events)).toContain('died');
    expect(types(events)).not.toContain('slowed');
    expect(killing.combat.phase).toBe('VICTORY');
  });

  it('is not set off by the player, and does not block movement', () => {
    const { combat, grid } = setup({ enemies: [['guardian', at(0, 0)]] });
    combat.hack(at(3, 3), 'TRAP');

    expect(combat.getMoveRange().some((hex) => hex.equals(at(3, 3)))).toBe(true);
    expect(types(combat.stepPlayer(at(3, 3)))).toEqual(['moved']);
    expect(combat.player.hp).toBe(combat.player.maxHp);
    expect(grid.getCell(at(3, 3))?.hacked).toBe('TRAP');
  });

  it('is invisible to enemy pathfinding: the crawler does not route around it', () => {
    const { combat, enemies } = setup({ player: at(3, 6), enemies: [['crawler', at(3, 3)]] });
    const [crawler] = enemies;
    if (!crawler) throw new Error('crawler missing');
    combat.hack(at(3, 4), 'TRAP');

    passTurn(combat);
    expect(crawler.position.equals(at(3, 4))).toBe(true);
  });
});

describe('walls', () => {
  it('a hacked wall blocks the hex for 4 turns', () => {
    const { combat, grid } = setup({ enemies: [['guardian', at(0, 0)]] });

    expect(types(combat.hack(at(3, 3), 'WALL'))).toEqual(['hacked', 'terrainChanged']);
    expect(combat.player.ram).toBe(combat.player.maxRam - wall.ramCost);

    for (let turn = 1; turn <= wall.turns; turn++) {
      expect(grid.isBlocked(at(3, 3))).toBe(true);
      passTurn(combat);
    }
    expect(grid.isBlocked(at(3, 3))).toBe(false);
  });

  it('breaking a wall opens the hex for good', () => {
    const { combat, grid } = setup({ enemies: [['guardian', at(0, 0)]], walls: [at(3, 3)] });
    expect(combat.getMoveRange().some((hex) => hex.equals(at(3, 3)))).toBe(false);

    combat.hack(at(3, 3), 'BREAK_WALL');

    expect(combat.player.ram).toBe(combat.player.maxRam - breakWall.ramCost);
    expect(grid.getCell(at(3, 3))?.terrain).toBe('FLOOR');
    expect(combat.getMoveRange().some((hex) => hex.equals(at(3, 3)))).toBe(true);
    for (let turn = 0; turn < 6; turn++) passTurn(combat);
    expect(grid.isWalkable(at(3, 3))).toBe(true);
  });

  it('a temporary wall can be broken too, leaving plain floor', () => {
    const { combat, grid } = setup({ enemies: [['guardian', at(0, 0)]] });
    combat.hack(at(3, 3), 'WALL');
    expect(combat.getHackOptions(at(3, 3)).map((option) => option.kind)).toEqual(['BREAK_WALL']);

    combat.hack(at(3, 3), 'BREAK_WALL');

    expect(grid.getCell(at(3, 3))).toMatchObject({ terrain: 'FLOOR', barrierTurns: 0 });
    expect(grid.isBlocked(at(3, 3))).toBe(false);
  });
});
