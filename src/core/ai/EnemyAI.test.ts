import { describe, expect, it } from 'vitest';
import { at, makeRoom } from '../combat/testRoom';
import type { RoomState } from '../data/RoomLoader';
import type { Enemy } from '../entities/Enemy';
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
