import { describe, expect, it } from 'vitest';
import { CombatManager } from '../combat/CombatManager';
import { at, makeRoom, runEnemyPhase, seededRng } from '../combat/testRoom';
import type { RoomState } from '../data/RoomLoader';
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
  it('steps one hex closer when the player is far away', () => {
    const room = makeRoom({ player: at(3, 7), enemies: [['crawler', at(3, 2)]] });
    const { enemy, actions } = plan(room);

    expect(actions).toHaveLength(1);
    const [move] = actions;
    if (move?.type !== 'move') throw new Error('expected a move');
    expect(enemy.position.distance(move.to)).toBe(1);
    expect(move.to.distance(room.player.position)).toBe(enemy.position.distance(room.player.position) - 1);
  });

  it('moves and attacks in the same turn when one step brings it adjacent', () => {
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
  it('drifts to a free neighbor chosen by the rng', () => {
    const room = makeRoom({ player: at(3, 8), enemies: [['ghost_process', at(3, 2)]] });
    const first = plan(room, 0).actions;
    const last = plan(room, 0.999).actions;

    for (const actions of [first, last]) {
      expect(actions).toHaveLength(1);
      const [move] = actions;
      if (move?.type !== 'move') throw new Error('expected a move');
      expect(move.to.distance(at(3, 2))).toBe(1);
      expect(room.grid.isBlocked(move.to)).toBe(false);
    }
    expect(first).not.toEqual(last);
  });

  it('never drifts onto a wall or another entity', () => {
    // A 1-wide corridor: wall above, player below. Nowhere to go.
    const room = makeRoom({
      cols: 1,
      rows: 3,
      player: at(0, 2),
      enemies: [['ghost_process', at(0, 1)]],
      walls: [at(0, 0)],
    });
    expect(plan(room).actions).toEqual([attack]);
  });

  it('fires when the player is within range after the move', () => {
    const room = makeRoom({
      cols: 1,
      rows: 5,
      player: at(0, 4),
      enemies: [['ghost_process', at(0, 1)]],
    });
    // Two free neighbors, so the extreme rolls cover both without assuming their order.
    const plans = [plan(room, 0).actions, plan(room, 0.999).actions];

    // Drifting to (0, 2) leaves it two hexes from the player: in range.
    expect(plans).toContainEqual([{ type: 'move', to: at(0, 2) }, attack]);
    // Drifting to (0, 0) leaves it four hexes away: out of range.
    expect(plans).toContainEqual([{ type: 'move', to: at(0, 0) }]);
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
