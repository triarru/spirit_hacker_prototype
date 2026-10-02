import { describe, expect, it } from 'vitest';
import { createPlayer, PLAYER_DATA } from '../entities/Player';
import { combinePassives, getProgram, noBonuses } from '../programs/ProgramRegistry';
import { SpellDeck } from '../programs/SpellDeck';
import { CombatManager } from './CombatManager';
import { at, makeRoom, runEnemyPhase } from './testRoom';
import { regenerate } from './TurnManager';

const passives = (...ids: string[]) => combinePassives(ids.map(getProgram));

describe('regenerate', () => {
  it('gives back the base RAM regen each turn', () => {
    const player = createPlayer(at(0, 0));
    player.ram = 20;

    expect(regenerate(player, noBonuses())).toEqual({ ram: PLAYER_DATA.ramRegen, qi: 0, hp: 0 });
    expect(player.ram).toBe(20 + PLAYER_DATA.ramRegen);
    expect(PLAYER_DATA.ramRegen).toBe(15);
  });

  it('stacks the ping_flood passive on top of the base regen', () => {
    const player = createPlayer(at(0, 0));
    player.ram = 20;

    expect(regenerate(player, passives('ping_flood')).ram).toBe(PLAYER_DATA.ramRegen + 5);
    expect(player.ram).toBe(20 + PLAYER_DATA.ramRegen + 5);
  });

  it('does not regenerate Qi on its own', () => {
    const player = createPlayer(at(0, 0));
    player.qi = 5;

    expect(regenerate(player, noBonuses()).qi).toBe(0);
    expect(player.qi).toBe(5);
  });

  it('regenerates Qi only through the tran_yem passive', () => {
    const player = createPlayer(at(0, 0));
    player.qi = 5;

    expect(regenerate(player, passives('tran_yem')).qi).toBe(3);
    expect(player.qi).toBe(8);
  });

  it('never takes RAM past its maximum, and reports what was actually gained', () => {
    const player = createPlayer(at(0, 0));
    player.ram = player.maxRam - 4;

    expect(regenerate(player, passives('ping_flood')).ram).toBe(4);
    expect(player.ram).toBe(player.maxRam);
    expect(regenerate(player, noBonuses()).ram).toBe(0);
    expect(player.ram).toBe(player.maxRam);
  });
});

describe('regen in combat', () => {
  const fight = (passiveIds: string[] = []) =>
    new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['guardian', at(0, 0)]] }),
      () => 0.999,
      new SpellDeck({ actives: [], passives: passiveIds.map(getProgram), handSize: 0 }),
    );

  it('at the start of turn 2, RAM is what turn 1 ended with plus 15', () => {
    const combat = fight();
    combat.player.ram = 10;

    combat.endPlayerTurn();
    const events = runEnemyPhase(combat);

    expect(combat.turn).toBe(2);
    expect(combat.player.ram).toBe(25);
    expect(events).toContainEqual({ type: 'regenerated', ram: 15, qi: 0 });
  });

  it('adds 20 with the ping_flood passive slotted', () => {
    const combat = fight(['ping_flood']);
    combat.player.ram = 10;

    combat.endPlayerTurn();
    runEnemyPhase(combat);

    expect(combat.player.ram).toBe(30);
  });

  it('leaves Qi alone, and reports nothing when RAM is already full', () => {
    const combat = fight();
    combat.player.qi = 5;

    combat.endPlayerTurn();
    const events = runEnemyPhase(combat);

    expect(combat.player.qi).toBe(5);
    expect(events.some((event) => event.type === 'regenerated')).toBe(false);
  });

  it('does not regenerate during the turn itself, only when a new one starts', () => {
    const combat = fight();
    combat.player.ram = 10;
    combat.endPlayerTurn();
    expect(combat.player.ram).toBe(10);
  });
});
