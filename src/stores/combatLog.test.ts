import { describe, expect, it } from 'vitest';
import { CombatManager, type CombatEvent } from '../core/combat/CombatManager';
import { at, makeRoom } from '../core/combat/testRoom';
import { getProgram } from '../core/programs/ProgramRegistry';
import { SpellDeck } from '../core/programs/SpellDeck';
import { describeEvents, type LogContext } from './combatLog';

const NAMES: Record<string, string> = { player: 'Vân', crawler_0: 'Crawler', guardian_1: 'Guardian' };
const context: LogContext = { playerId: 'player', nameOf: (id) => NAMES[id] ?? id, turn: 4 };
const text = (events: CombatEvent[]): string[] => describeEvents(events, context).map((line) => line.text);
const hex = at(0, 0);

describe('describeEvents', () => {
  it('folds the damage of a cast into its line, as in the design doc', () => {
    expect(
      text([
        { type: 'spellCast', programId: 'ping_flood', programName: 'ping_flood()', at: hex },
        { type: 'attacked', attackerId: 'player', targetId: 'crawler_0', at: hex, damage: 12, dodged: false, amplified: false },
      ]),
    ).toEqual(['Vân cast ping_flood() → Crawler takes 12 damage']);
  });

  it('lists every enemy a cast hit on the same line, then what followed', () => {
    expect(
      text([
        { type: 'spellCast', programId: 'ping_flood', programName: 'ping_flood()', at: hex },
        { type: 'attacked', attackerId: 'player', targetId: 'crawler_0', at: hex, damage: 12, dodged: false, amplified: false },
        { type: 'breached', entityId: 'crawler_0', at: hex },
        { type: 'attacked', attackerId: 'player', targetId: 'guardian_1', at: hex, damage: 18, dodged: false, amplified: true },
        { type: 'died', entityId: 'guardian_1', at: hex },
      ]),
    ).toEqual([
      'Vân cast ping_flood() → Crawler takes 12 damage, Guardian takes 18 damage (breached x1.5)',
      'Crawler FIREWALL BREACHED!',
      'Guardian destroyed',
    ]);
  });

  it('gives a cast with no damage a line of its own', () => {
    expect(
      text([
        { type: 'spellCast', programId: 'tran_yem', programName: 'tran_yem()', at: hex },
        { type: 'stunned', entityId: 'guardian_1', at: hex, turns: 1 },
      ]),
    ).toEqual(['Vân cast tran_yem()', 'Guardian is stunned (1 turn)']);
  });

  it('words the reactive-defense outcomes as in the design doc', () => {
    const defended = (kind: 'parry' | 'dodge', grade: 'perfect' | 'good', apBanked: number): CombatEvent => ({
      type: 'defended', kind, grade, attackerId: 'crawler_0', at: hex, apBanked,
    });
    expect(text([defended('parry', 'perfect', 1)])).toEqual(['Perfect Parry! +1 AP']);
    expect(text([defended('parry', 'good', 0)])).toEqual(['Parry! Damage halved']);
    expect(text([defended('dodge', 'perfect', 0)])).toEqual(['Perfect Dodge!']);
  });

  it('tells apart who hit whom', () => {
    const hit = (attackerId: string, targetId: string, dodged = false): CombatEvent => ({
      type: 'attacked', attackerId, targetId, at: hex, damage: dodged ? 0 : 10, dodged, amplified: false,
    });
    expect(text([hit('player', 'crawler_0')])).toEqual(['Vân attacks → Crawler takes 10 damage']);
    expect(text([hit('crawler_0', 'player')])).toEqual(['Crawler hits → Vân takes 10 damage']);
    expect(text([hit('crawler_0', 'player', true)])).toEqual(["Vân dodges Crawler's attack"]);
    expect(text([hit('turret', 'crawler_0')])).toEqual(['Turret hits → Crawler takes 10 damage']);
    expect(text([hit('trap', 'crawler_0')])).toEqual(['Trap hits → Crawler takes 10 damage']);
    expect(text([hit('crawler_0', 'guardian_1')])).toEqual(['Crawler hits → Guardian takes 10 damage']);
  });

  it('describes each hack as in the design doc', () => {
    const hacked = (kind: 'TURRET' | 'TRAP' | 'WALL' | 'BREAK_WALL'): CombatEvent[] => [
      { type: 'hacked', kind, at: hex },
      { type: 'terrainChanged' },
    ];
    expect(text(hacked('TURRET'))).toEqual(['Terminal hacked → Turret deployed (3 turns)']);
    expect(text(hacked('TRAP'))).toEqual(['Floor hacked → Trap set']);
    expect(text(hacked('WALL'))).toEqual(['Floor hacked → Wall raised (4 turns)']);
    expect(text(hacked('BREAK_WALL'))).toEqual(['Wall hacked → Wall broken']);
  });

  it('marks turns and the end of the fight', () => {
    expect(text([{ type: 'phaseChanged', phase: 'ENEMY_TURN' }])).toEqual(['— Enemy turn —']);
    expect(text([{ type: 'phaseChanged', phase: 'PLAYER_TURN' }])).toEqual(['— Turn 4 —']);
    expect(text([{ type: 'phaseChanged', phase: 'VICTORY' }])).toEqual(['CLEARED']);
    expect(text([{ type: 'phaseChanged', phase: 'DEFEAT' }])).toEqual(['SYSTEM FORMATTED']);
  });

  it('says nothing about movement and other things the grid already shows', () => {
    expect(
      text([
        { type: 'moved', entityId: 'player', from: hex, to: hex },
        { type: 'turretFired', at: hex, targetId: 'crawler_0', targetAt: hex },
        { type: 'terrainChanged' },
      ]),
    ).toEqual([]);
  });

  it('colors lines by who they are good for', () => {
    const tones = describeEvents(
      [
        { type: 'attacked', attackerId: 'crawler_0', targetId: 'player', at: hex, damage: 10, dodged: false, amplified: false },
        { type: 'breached', entityId: 'crawler_0', at: hex },
        { type: 'phaseChanged', phase: 'PLAYER_TURN' },
      ],
      context,
    ).map((line) => line.tone);
    expect(tones).toEqual(['bad', 'good', 'system']);
  });

  it('describes a real cast from the combat manager end to end', () => {
    const combat = new CombatManager(
      makeRoom({ player: at(3, 4), enemies: [['crawler', at(3, 3)]] }),
      () => 0.999,
      new SpellDeck({ actives: [{ program: getProgram('brute_force'), modifier: null }], passives: [], handSize: 1 }),
    );
    const names: Record<string, string> = { player: 'Vân', crawler_0: 'Crawler' };
    const lines = describeEvents(combat.castSpell(0, at(3, 3)), {
      playerId: 'player',
      nameOf: (id) => names[id] ?? id,
      turn: combat.turn,
    });
    expect(lines.map((line) => line.text)).toEqual([
      'Vân cast brute_force() → Crawler takes 20 damage',
      'Crawler FIREWALL BREACHED!',
    ]);
  });
});
