import { describe, expect, it } from 'vitest';
import { CombatManager } from '../combat/CombatManager';
import { at, makeRoom, runEnemyPhase, seededRng } from '../combat/testRoom';
import { loadRoom, type RoomState } from '../data/RoomLoader';
import { canHitFrom, type Enemy } from '../entities/Enemy';
import { hasLineOfSight } from '../hex/hasLineOfSight';
import type { HexCoord } from '../hex/HexCoord';
import { getProgram } from '../programs/ProgramRegistry';
import { SpellDeck } from '../programs/SpellDeck';
import { planEnemyTurn, type EnemyAction } from './EnemyAI';

/** Plans the turn of the room's only enemy. `roll` is what every rng() call returns. */
function plan(room: RoomState, roll = 0): { enemy: Enemy; actions: EnemyAction[] } {
  const [enemy] = room.enemies;
  if (!enemy) throw new Error('enemy missing');
  const actions = planEnemyTurn(enemy, { grid: room.grid, player: room.player, rng: () => roll });
  return { enemy, actions };
}

const attack = { type: 'attack', targetId: 'player' } as const;

describe('guard behavior (Guardian)', () => {
  it('does nothing while the player is out of reach', () => {
    const { actions } = plan(makeRoom({ player: at(3, 6), enemies: [['guardian', at(3, 3)]] }));
    expect(actions).toEqual([]);
  });

  it('attacks an adjacent player without moving', () => {
    const { actions } = plan(makeRoom({ player: at(3, 4), enemies: [['guardian', at(3, 3)]] }));
    expect(actions).toEqual([attack]);
  });
});

describe('patrol behavior (Crawler)', () => {
  it('closes in by its whole move range when the player is far away', () => {
    const room = makeRoom({ player: at(3, 7), enemies: [['crawler', at(3, 2)]] });
    const { enemy, actions } = plan(room);

    expect(enemy.moveRange).toBe(2);
    expect(actions).toHaveLength(enemy.moveRange);
    let position = enemy.position;
    for (const action of actions) {
      if (action.type !== 'move') throw new Error('expected a move');
      // One hex at a time, each one closer than the last.
      expect(position.distance(action.to)).toBe(1);
      expect(action.to.distance(room.player.position)).toBe(position.distance(room.player.position) - 1);
      position = action.to;
    }
  });

  it('reaches and strikes a player three hexes away in a single turn', () => {
    const { actions } = plan(makeRoom({ player: at(3, 6), enemies: [['crawler', at(3, 3)]] }));
    expect(actions).toEqual([{ type: 'move', to: at(3, 4) }, { type: 'move', to: at(3, 5) }, attack]);
  });

  it('stops moving as soon as it is adjacent, and attacks', () => {
    const { actions } = plan(makeRoom({ player: at(3, 5), enemies: [['crawler', at(3, 3)]] }));
    expect(actions).toEqual([{ type: 'move', to: at(3, 4) }, attack]);
  });

  it('attacks without moving when already adjacent', () => {
    const { actions } = plan(makeRoom({ player: at(3, 4), enemies: [['crawler', at(3, 3)]] }));
    expect(actions).toEqual([attack]);
  });

  it('walks around a wall instead of into it', () => {
    const room = makeRoom({
      cols: 3,
      rows: 5,
      player: at(1, 4),
      enemies: [['crawler', at(1, 0)]],
      walls: [at(1, 1), at(0, 2), at(1, 2)],
    });
    const { actions } = plan(room);

    const [move] = actions;
    if (move?.type !== 'move') throw new Error('expected a move');
    expect(room.grid.isBlocked(move.to)).toBe(false);
    // The only open route runs down the right-hand column.
    expect(move.to.toOffset().col).toBe(2);
  });

  it('stays put when every route to the player is sealed', () => {
    const room = makeRoom({
      cols: 1,
      rows: 5,
      player: at(0, 4),
      enemies: [['crawler', at(0, 0)]],
      walls: [at(0, 2)],
    });
    expect(plan(room).actions).toEqual([]);
  });
});

describe('random behavior (Ghost Process)', () => {
  const ROLLS = [0, 0.2, 0.4, 0.6, 0.8, 0.999];

  it('closes in on a player it has no shot at, whatever the roll', () => {
    const room = makeRoom({ player: at(3, 8), enemies: [['ghost_process', at(3, 2)]] });

    for (const roll of ROLLS) {
      const { enemy, actions } = plan(room, roll);
      expect(actions).toHaveLength(1);
      const [move] = actions;
      if (move?.type !== 'move') throw new Error('expected a move');
      expect(enemy.position.distance(move.to)).toBe(1);
      expect(move.to.distance(room.player.position)).toBe(enemy.position.distance(room.player.position) - 1);
    }
  });

  it('steps into range and fires in the same turn', () => {
    const room = makeRoom({ cols: 1, rows: 5, player: at(0, 4), enemies: [['ghost_process', at(0, 1)]] });
    for (const roll of ROLLS) {
      expect(plan(room, roll).actions).toEqual([{ type: 'move', to: at(0, 2) }, attack]);
    }
  });

  it('with a shot already, shifts to another hex it can fire from, chosen by the rng', () => {
    const room = makeRoom({ player: at(3, 6), enemies: [['ghost_process', at(3, 4)]] });
    const destinations = new Set<string>();

    for (const roll of ROLLS) {
      const { enemy, actions } = plan(room, roll);
      expect(actions).toHaveLength(2);
      const [move, shot] = actions;
      if (move?.type !== 'move') throw new Error('expected a move');
      expect(shot).toEqual(attack);
      expect(canHitFrom(room.grid, enemy, move.to, room.player.position)).toBe(true);
      destinations.add(move.to.key());
    }
    // The side the shot comes from is not predictable.
    expect(destinations.size).toBeGreaterThan(1);
  });

  it('holds still and fires when it has nowhere to go', () => {
    // A 1-wide corridor: wall above, player below.
    const room = makeRoom({
      cols: 1,
      rows: 3,
      player: at(0, 2),
      enemies: [['ghost_process', at(0, 1)]],
      walls: [at(0, 0)],
    });
    expect(plan(room).actions).toEqual([attack]);
  });

  it('drifts at random when there is no way through to the player', () => {
    // The corridor is sealed between them, so there is nothing to close in along.
    const room = makeRoom({
      cols: 1,
      rows: 6,
      player: at(0, 5),
      enemies: [['ghost_process', at(0, 1)]],
      walls: [at(0, 3)],
    });
    const plans = [plan(room, 0).actions, plan(room, 0.999).actions];

    expect(plans).toContainEqual([{ type: 'move', to: at(0, 0) }]);
    expect(plans).toContainEqual([{ type: 'move', to: at(0, 2) }]);
  });

  it('gets its first shot at a player who never leaves the spawn within five turns', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const combat = new CombatManager(loadRoom('prototype_room'), seededRng(seed));
      combat.player.hp = combat.player.maxHp = 100_000;
      let firstShot = 0;

      for (let turn = 1; turn <= 5 && firstShot === 0; turn++) {
        combat.player.ap = 0;
        combat.endPlayerTurn();
        const fired = runEnemyPhase(combat).some(
          (event) => event.type === 'attacked' && event.attackerId.startsWith('ghost_process'),
        );
        if (fired) firstShot = turn;
      }
      expect(firstShot).toBeGreaterThan(0);
    }
  });
});

describe('Ghost Process and line of sight', () => {
  /** Where the enemy ends up after carrying out a plan. */
  const endOf = (enemy: Enemy, actions: EnemyAction[]): HexCoord =>
    actions.reduce((position, action) => (action.type === 'move' ? action.to : position), enemy.position);
  const moves = (actions: EnemyAction[]): number => actions.filter((action) => action.type === 'move').length;
  const fires = (actions: EnemyAction[]): boolean => actions.some((action) => action.type === 'attack');
  const ROLLS = [0, 0.2, 0.4, 0.6, 0.8, 0.999];

  it('fires as before when nothing is in the way', () => {
    const room = makeRoom({ cols: 1, rows: 5, player: at(0, 4), enemies: [['ghost_process', at(0, 1)]] });
    const plans = ROLLS.map((roll) => plan(room, roll).actions);
    expect(plans).toContainEqual([{ type: 'move', to: at(0, 2) }, attack]);
  });

  it('does not fire through a wall', () => {
    // The player is walled in on all six sides: no hex within range has a clear line.
    const player = at(3, 4);
    const room = makeRoom({ player, enemies: [['ghost_process', at(3, 2)]], walls: player.neighbors() });

    for (const roll of ROLLS) {
      const { enemy, actions } = plan(room, roll);
      expect(fires(actions)).toBe(false);
      expect(hasLineOfSight(room.grid, endOf(enemy, actions), player)).toBe(false);
    }
  });

  it('takes one more step to look for a clear shot when its sight is blocked', () => {
    // One wall, directly between the ghost's column and the player.
    const player = at(3, 6);
    const room = makeRoom({ player, enemies: [['ghost_process', at(3, 3)]], walls: [at(3, 5)] });
    let repositioned = 0;

    for (const roll of ROLLS) {
      const { enemy, actions } = plan(room, roll);
      const end = endOf(enemy, actions);
      // It only attacks from a hex it can really hit from.
      expect(fires(actions)).toBe(canHitFrom(room.grid, enemy, end, player));
      // A second move only ever happens to get out from behind the wall.
      if (moves(actions) === 2) {
        repositioned += 1;
        const first = actions[0];
        if (first?.type !== 'move') throw new Error('expected a move');
        expect(first.to.distance(player)).toBeLessThanOrEqual(enemy.attackRange);
        expect(hasLineOfSight(room.grid, first.to, player)).toBe(false);
        // A clear hex was next to it, so that is where it went, and it fires.
        expect(fires(actions)).toBe(true);
      }
    }
    expect(repositioned).toBeGreaterThan(0);
  });

  it('does not reposition when it is simply out of range', () => {
    const room = makeRoom({ player: at(3, 8), enemies: [['ghost_process', at(3, 1)]], walls: [at(3, 5)] });
    for (const roll of ROLLS) expect(moves(plan(room, roll).actions)).toBe(1);
  });

  it('cannot reposition on a turn it cannot move at all', () => {
    const player = at(3, 6);
    const room = makeRoom({ player, enemies: [['ghost_process', at(3, 4)]], walls: [at(3, 5)] });
    const [ghost] = room.enemies;
    if (!ghost) throw new Error('ghost missing');
    ghost.moveRange = 0;

    expect(plan(room, 0).actions).toEqual([]);
  });

  it('is shut out by a wall the player raises between them', () => {
    const combat = new CombatManager(
      makeRoom({ cols: 1, rows: 5, player: at(0, 4), enemies: [['ghost_process', at(0, 1)]] }),
      seededRng(2),
      new SpellDeck({ actives: [{ program: getProgram('firewall_up'), modifier: null }], passives: [], handSize: 1 }),
    );
    // In a 1-wide corridor the wall is a single hex, and it seals the ghost off.
    combat.castSpell(0, at(0, 3));
    combat.player.ap = 0;

    for (let turn = 0; turn < 3; turn++) {
      combat.endPlayerTurn();
      const events = runEnemyPhase(combat);
      expect(events.some((event) => event.type === 'attacked')).toBe(false);
    }
    expect(combat.player.hp).toBe(combat.player.maxHp);
  });

  it('does not stop the player casting at an enemy through a wall', () => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 6), enemies: [['ghost_process', at(3, 4)]], walls: [at(3, 5)] }),
      seededRng(2),
      new SpellDeck({ actives: [{ program: getProgram('tran_yem'), modifier: null }], passives: [], handSize: 1 }),
    );
    expect(combat.getSpellTargets(0)).toEqual([at(3, 4)]);
    expect(combat.castSpell(0, at(3, 4)).map((event) => event.type)).toContain('stunned');
  });
});

describe('Guardian: guard and aggressive modes', () => {
  /** Player at the bottom of a clear column, a guardian `gap` hexes straight above. */
  function standoff(gap: number, programs: string[] = ['nmap_scan', 'ping_flood']) {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 7), enemies: [['guardian', at(3, 7 - gap)]] }),
      () => 0.999,
      new SpellDeck({
        actives: programs.map((id) => ({ program: getProgram(id), modifier: null })),
        passives: [],
        handSize: programs.length,
      }),
    );
    const [guardian] = combat.enemies;
    if (!guardian) throw new Error('guardian missing');
    guardian.hp = guardian.maxHp = 500;
    return { combat, guardian };
  }
  const passTurn = (combat: CombatManager) => {
    combat.player.ap = 0;
    combat.endPlayerTurn();
    return runEnemyPhase(combat);
  };
  const stances = (events: Array<{ type: string; stance?: string }>) =>
    events.filter((event) => event.type === 'stanceShifted').map((event) => event.stance);

  it('guard mode: it does not move, however long the player keeps away', () => {
    const { combat, guardian } = standoff(4);
    for (let turn = 0; turn < 5; turn++) passTurn(combat);

    expect(guardian.position.equals(at(3, 3))).toBe(true);
    expect([guardian.aggressive, guardian.timesHitFromRange]).toEqual([false, 0]);
  });

  it('one hit from range: a warning, but it stays in guard mode and stays put', () => {
    const { combat, guardian } = standoff(4);

    const events = combat.castSpell(0, guardian.position);

    expect(stances(events)).toEqual(['wary']);
    expect([guardian.aggressive, guardian.timesHitFromRange]).toEqual([false, 1]);
    passTurn(combat);
    expect(guardian.position.equals(at(3, 3))).toBe(true);
  });

  it('two hits from range: it turns aggressive', () => {
    const { combat, guardian } = standoff(3);

    combat.castSpell(0, guardian.position);
    const events = combat.castSpell(1, guardian.position);

    expect(stances(events)).toEqual(['aggressive']);
    expect([guardian.aggressive, guardian.timesHitFromRange]).toEqual([true, 2]);
  });

  it('aggressive: it advances one hex a turn toward the player', () => {
    const { combat, guardian } = standoff(3);
    combat.castSpell(0, guardian.position);
    combat.castSpell(1, guardian.position);

    passTurn(combat);
    expect(guardian.position.equals(at(3, 5))).toBe(true);
    expect(guardian.position.distance(combat.player.position)).toBe(2);
    expect(guardian.aggressive).toBe(true);
  });

  it('reaching melee: it strikes, then goes back to guard mode where it stands', () => {
    const { combat, guardian } = standoff(3);
    combat.castSpell(0, guardian.position);
    combat.castSpell(1, guardian.position);
    passTurn(combat);

    // Second turn of the advance: one more step brings it adjacent, and it attacks.
    const events = passTurn(combat);
    expect(guardian.position.equals(at(3, 6))).toBe(true);
    expect(combat.player.hp).toBe(combat.player.maxHp - guardian.attackDamage);
    expect(stances(events)).toEqual(['guard']);
    expect([guardian.aggressive, guardian.timesHitFromRange]).toEqual([false, 0]);

    // Back on guard: when the player walks away, it does not follow.
    combat.grid.moveEntity(combat.player, at(3, 8));
    combat.grid.moveEntity(combat.player, at(0, 8));
    passTurn(combat);
    expect(guardian.position.equals(at(3, 6))).toBe(true);
  });

  it('can be provoked again after it has settled', () => {
    const { combat, guardian } = standoff(3);
    combat.castSpell(0, guardian.position);
    combat.castSpell(1, guardian.position);
    passTurn(combat);
    passTurn(combat);
    expect(guardian.aggressive).toBe(false);

    combat.grid.moveEntity(combat.player, at(3, 8));
    expect(stances(combat.castSpell(0, guardian.position))).toEqual(['wary']);
  });

  it('a melee hit does not count as a hit from range', () => {
    const { combat, guardian } = standoff(1);

    expect(stances(combat.playerAttack(guardian.id))).toEqual([]);
    expect(stances(combat.playerAttack(guardian.id))).toEqual([]);
    expect([guardian.aggressive, guardian.timesHitFromRange]).toEqual([false, 0]);
  });

  it('a hit that does no damage does not count', () => {
    const { combat, guardian } = standoff(2, ['tran_yem']);

    expect(combat.castSpell(0, guardian.position).map((event) => event.type)).toEqual(['spellCast', 'stunned']);
    expect(guardian.timesHitFromRange).toBe(0);
  });

  it('turret shots do not count: a turret is not an entity', () => {
    const { combat, guardian } = standoff(4);
    combat.grid.setTerrain(at(2, 4), 'TERMINAL');
    combat.grid.moveEntity(combat.player, at(2, 6));
    combat.hack(at(2, 4), 'TURRET');

    for (let turn = 0; turn < 3; turn++) passTurn(combat);

    expect(guardian.hp).toBeLessThan(guardian.maxHp);
    expect([guardian.aggressive, guardian.timesHitFromRange]).toEqual([false, 0]);
    expect(guardian.position.equals(at(3, 3))).toBe(true);
  });

  it('an infected ally does not count: only the player\'s own hits provoke it', () => {
    const combat = new CombatManager(
      // The crawler stands 3 hexes from the guardian, well outside melee range of it.
      makeRoom({ player: at(3, 7), enemies: [['guardian', at(3, 2)], ['crawler', at(3, 5)]] }),
      () => 0.999,
    );
    const [guardian, crawler] = combat.enemies;
    if (!guardian || !crawler) throw new Error('enemies missing');
    guardian.hp = guardian.maxHp = 500;

    for (let breach = 0; breach < 3; breach++) {
      crawler.breached = true;
      crawler.virusInjected = false;
      combat.player.ap = combat.player.maxAp;
      expect(stances(combat.injectVirus(crawler.id))).toEqual([]);
    }

    expect(guardian.hp).toBe(500 - 3 * crawler.attackDamage);
    expect([guardian.aggressive, guardian.timesHitFromRange]).toEqual([false, 0]);
  });

  it('other enemy types are never provoked', () => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 7), enemies: [['crawler', at(3, 4)]] }),
      () => 0.999,
      new SpellDeck({
        actives: ['nmap_scan', 'ping_flood'].map((id) => ({ program: getProgram(id), modifier: null })),
        passives: [],
        handSize: 2,
      }),
    );
    const [crawler] = combat.enemies;
    if (!crawler) throw new Error('crawler missing');
    crawler.hp = crawler.maxHp = 500;

    expect(stances([...combat.castSpell(0, crawler.position), ...combat.castSpell(1, crawler.position)])).toEqual([]);
    expect(crawler.aggro).toBeNull();
  });
});
