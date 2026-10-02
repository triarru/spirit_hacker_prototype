import { describe, expect, it } from 'vitest';
import { loadRoom } from '../data/RoomLoader';
import { PLAYER_DATA } from '../entities/Player';
import { CombatManager, type CombatEvent } from './CombatManager';
import { at, makeRoom, seededRng } from './testRoom';
import { turnOrder } from './TurnManager';

const { basicAttack, apCap, endTurnDodgeBonus } = PLAYER_DATA;
const NEVER_DODGE = (): number => 0.999;
const ALWAYS_DODGE = (): number => 0;

/** Plays out the whole enemy turn the way the store does, minus the delays. */
function runEnemyPhase(combat: CombatManager): CombatEvent[] {
  const events: CombatEvent[] = [];
  for (const enemyId of combat.getEnemyTurnOrder()) {
    for (const action of combat.planEnemyTurn(enemyId)) {
      events.push(...combat.applyEnemyAction(enemyId, action));
    }
  }
  events.push(...combat.endEnemyPhase());
  return events;
}

describe('player turn', () => {
  it('starts on the player turn with full AP', () => {
    const combat = new CombatManager(makeRoom({ player: at(3, 4) }));
    expect(combat.phase).toBe('PLAYER_TURN');
    expect(combat.turn).toBe(1);
    expect(combat.player.ap).toBe(combat.player.maxAp);
  });

  it('hits an adjacent enemy for the basic attack damage and AP cost', () => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['guardian', at(3, 3)]] }),
    );
    const [guardian] = combat.enemies;
    if (!guardian) throw new Error('guardian missing');

    const events = combat.playerAttack(guardian.id);

    expect(guardian.hp).toBe(guardian.maxHp - basicAttack.damage);
    expect(combat.player.ap).toBe(combat.player.maxAp - basicAttack.apCost);
    expect(events).toEqual([
      {
        type: 'attacked',
        attackerId: combat.player.id,
        targetId: guardian.id,
        at: at(3, 3),
        damage: basicAttack.damage,
        dodged: false,
      },
    ]);
  });

  it('cannot attack an enemy out of range, or without AP', () => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['guardian', at(3, 2)], ['crawler', at(3, 5)]] }),
    );
    const [guardian, crawler] = combat.enemies;
    if (!guardian || !crawler) throw new Error('enemies missing');

    expect(combat.playerAttack(guardian.id)).toEqual([]);
    expect(guardian.hp).toBe(guardian.maxHp);
    expect(combat.getAttackableEnemies()).toEqual([crawler]);

    combat.player.ap = 0;
    expect(combat.getAttackableEnemies()).toEqual([]);
    expect(combat.playerAttack(crawler.id)).toEqual([]);
    expect(crawler.hp).toBe(crawler.maxHp);
  });

  it('removes a killed enemy and wins when it was the last one', () => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['crawler', at(3, 3)]] }),
    );
    const [crawler] = combat.enemies;
    if (!crawler) throw new Error('crawler missing');
    crawler.hp = basicAttack.damage;

    const events = combat.playerAttack(crawler.id);

    expect(events.map((event) => event.type)).toEqual(['attacked', 'died', 'phaseChanged']);
    expect(combat.enemies).toEqual([]);
    expect(combat.grid.getEntityAt(at(3, 3))).toBeNull();
    expect(combat.phase).toBe('VICTORY');
  });

  it('keeps fighting while other enemies remain', () => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['crawler', at(3, 3)], ['guardian', at(3, 0)]] }),
    );
    const [crawler] = combat.enemies;
    if (!crawler) throw new Error('crawler missing');
    crawler.hp = 1;

    combat.playerAttack(crawler.id);

    expect(combat.enemies).toHaveLength(1);
    expect(combat.phase).toBe('PLAYER_TURN');
  });
});

describe('turn cycle', () => {
  it('locks out player actions during the enemy turn', () => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['guardian', at(3, 3)]] }),
    );
    const [guardian] = combat.enemies;
    if (!guardian) throw new Error('guardian missing');

    expect(combat.endPlayerTurn()).toEqual([{ type: 'phaseChanged', phase: 'ENEMY_TURN' }]);
    expect(combat.getMoveRange()).toEqual([]);
    expect(combat.getPathTo(at(3, 5))).toEqual([]);
    expect(combat.stepPlayer(at(3, 5))).toEqual([]);
    expect(combat.playerAttack(guardian.id)).toEqual([]);
    expect(combat.endPlayerTurn()).toEqual([]);
  });

  it('lets enemies act, then returns to the player with AP refilled', () => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['guardian', at(3, 3)]] }),
      NEVER_DODGE,
    );
    const [guardian] = combat.enemies;
    if (!guardian) throw new Error('guardian missing');
    combat.player.ap = 0;

    combat.endPlayerTurn();
    const events = runEnemyPhase(combat);

    expect(combat.player.hp).toBe(combat.player.maxHp - guardian.attackDamage);
    expect(events.at(-1)).toEqual({ type: 'phaseChanged', phase: 'PLAYER_TURN' });
    expect(combat.turn).toBe(2);
    expect(combat.player.ap).toBe(combat.player.maxAp);
  });

  it('does not carry unspent AP into the next turn', () => {
    const combat = new CombatManager(makeRoom({ player: at(3, 4), enemies: [['guardian', at(0, 0)]] }));
    combat.endPlayerTurn();
    runEnemyPhase(combat);
    expect(combat.player.ap).toBe(combat.player.maxAp);
  });

  it('adds banked AP at the start of the turn, up to the cap, then clears the bank', () => {
    const combat = new CombatManager(makeRoom({ player: at(3, 4), enemies: [['guardian', at(0, 0)]] }));

    combat.endPlayerTurn();
    combat.player.apBank = 1;
    runEnemyPhase(combat);
    expect(combat.player.ap).toBe(combat.player.maxAp + 1);
    expect(combat.player.apBank).toBe(0);

    combat.endPlayerTurn();
    combat.player.apBank = 10;
    runEnemyPhase(combat);
    expect(combat.player.ap).toBe(apCap);
  });

  it('ends in defeat the moment the player falls, and stops the enemy turn', () => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['guardian', at(3, 3)], ['crawler', at(3, 5)]] }),
      NEVER_DODGE,
    );
    combat.player.hp = 1;
    combat.player.ap = 0;

    combat.endPlayerTurn();
    const events = runEnemyPhase(combat);

    expect(combat.player.hp).toBe(0);
    expect(combat.phase).toBe('DEFEAT');
    // The crawler acts first (faster) and lands the killing blow; the guardian never swings.
    expect(events.filter((event) => event.type === 'attacked')).toHaveLength(1);
    expect(combat.turn).toBe(1);
  });
});

describe('end-turn dodge bonus', () => {
  const setup = (rng: () => number) =>
    new CombatManager(makeRoom({ player: at(3, 4), enemies: [['guardian', at(3, 3)]] }), rng);

  it('is granted only when the turn ends with AP to spare', () => {
    const early = setup(NEVER_DODGE);
    early.endPlayerTurn();
    expect(early.player.dodgeChance).toBe(endTurnDodgeBonus);

    const spent = setup(NEVER_DODGE);
    spent.player.ap = 0;
    spent.endPlayerTurn();
    expect(spent.player.dodgeChance).toBe(0);
  });

  it('makes an attack miss when the roll comes in under the chance', () => {
    const combat = setup(ALWAYS_DODGE);
    combat.endPlayerTurn();
    const events = runEnemyPhase(combat);

    expect(combat.player.hp).toBe(combat.player.maxHp);
    expect(events[0]).toMatchObject({ type: 'attacked', damage: 0, dodged: true });
  });

  it('never triggers when the player spent everything', () => {
    const combat = setup(ALWAYS_DODGE);
    combat.player.ap = 0;
    combat.endPlayerTurn();
    runEnemyPhase(combat);

    expect(combat.player.hp).toBeLessThan(combat.player.maxHp);
  });

  it('expires when the next player turn starts', () => {
    const combat = setup(NEVER_DODGE);
    combat.endPlayerTurn();
    runEnemyPhase(combat);
    expect(combat.player.dodgeChance).toBe(0);
  });
});

describe('turn order', () => {
  it('sorts by speed, fastest first, with the player ahead on ties', () => {
    const { player, enemies } = makeRoom({
      player: at(3, 4),
      enemies: [['guardian', at(0, 0)], ['ghost_process', at(1, 0)], ['crawler', at(2, 0)]],
    });
    const [guardian, ghost, crawler] = enemies;
    if (!guardian || !ghost || !crawler) throw new Error('enemies missing');
    crawler.speed = player.speed;

    expect(turnOrder([guardian, crawler, player, ghost])).toEqual([ghost, player, crawler, guardian]);
  });

  it('runs the enemy turn in that order', () => {
    const combat = new CombatManager(loadRoom('prototype_room'));
    expect(combat.getEnemyTurnOrder()).toEqual(['ghost_process_2', 'crawler_0', 'guardian_1']);
  });
});

describe('prototype_room simulation', () => {
  it('keeps the grid consistent over 30 rounds of enemy turns', () => {
    const combat = new CombatManager(loadRoom('prototype_room'), seededRng(7));
    combat.player.hp = combat.player.maxHp = 100_000;

    for (let round = 0; round < 30; round++) {
      combat.endPlayerTurn();
      runEnemyPhase(combat);
      expect(combat.phase).toBe('PLAYER_TURN');

      const everyone = [combat.player, ...combat.enemies];
      expect(new Set(everyone.map((entity) => entity.position.key())).size).toBe(everyone.length);
      for (const entity of everyone) {
        expect(combat.grid.isWalkable(entity.position)).toBe(true);
        expect(combat.grid.getEntityAt(entity.position)).toBe(entity);
      }
      const occupied = combat.grid.allCells().filter((cell) => cell.entity !== null);
      expect(occupied).toHaveLength(everyone.length);
    }

    // The crawler hunts the player down; the guardian never leaves its post.
    const crawler = combat.enemies.find((enemy) => enemy.typeId === 'crawler');
    const guardian = combat.enemies.find((enemy) => enemy.typeId === 'guardian');
    expect(crawler?.position.distance(combat.player.position)).toBe(1);
    expect(guardian?.position.equals(at(3, 1))).toBe(true);
    expect(combat.player.hp).toBeLessThan(combat.player.maxHp);
  });
});
