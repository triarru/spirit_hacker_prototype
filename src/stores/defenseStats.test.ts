import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '../core/combat/CombatManager';
import { HexCoord } from '../core/hex/HexCoord';
import { emptyTally, formatOffset, hasDefended, summarizeTiming, tallyDefense } from './defenseStats';

const hex = new HexCoord(0, 0);
const defended = (kind: 'parry' | 'dodge', grade: 'perfect' | 'good', offBySeconds?: number): CombatEvent => ({
  type: 'defended', kind, grade, attackerId: 'crawler_0', at: hex, apBanked: 0,
  ...(offBySeconds === undefined ? {} : { offBySeconds }),
});
const missed = (kind: 'parry' | 'dodge', reason: 'early' | 'late' | 'wrong_way', offBySeconds: number): CombatEvent => ({
  type: 'defenseMissed', kind, reason, attackerId: 'crawler_0', at: hex, offBySeconds,
});
const hit = (targetId = 'player', dodged = false): CombatEvent => ({
  type: 'attacked', attackerId: 'crawler_0', targetId, at: hex, damage: 10, dodged, amplified: false,
});
/** Feeds the batches in, one action at a time, the way the store does. */
const tallyOf = (...batches: CombatEvent[][]) =>
  batches.reduce((tally, batch) => tallyDefense(tally, batch, 'player'), emptyTally());

describe('tallyDefense', () => {
  it('counts each answered attack once, by kind and grade', () => {
    const tally = tallyOf(
      [defended('parry', 'perfect', 0.01)],
      [defended('parry', 'good', -0.06), hit()],
      [missed('parry', 'early', -0.2), hit()],
      [defended('dodge', 'perfect', 0.02)],
      [missed('dodge', 'wrong_way', 0.0), hit()],
    );

    expect(tally.parry).toEqual({ perfect: 1, good: 1, miss: 1 });
    expect(tally.dodge).toEqual({ perfect: 1, good: 0, miss: 1 });
    expect(tally.unanswered).toBe(0);
    expect(tally.offsetsSeconds).toEqual([0.01, -0.06, -0.2, 0.02, 0.0]);
  });

  it('counts a hit nobody tried to answer as unanswered', () => {
    const tally = tallyOf([hit()], [hit('player', true)]);

    expect(tally.unanswered).toBe(2);
    expect(tally.parry).toEqual({ perfect: 0, good: 0, miss: 0 });
    expect(tally.offsetsSeconds).toEqual([]);
  });

  it('ignores hits on enemies and everything that is not about defending', () => {
    const tally = tallyOf([hit('crawler_0')], [{ type: 'terrainChanged' }]);
    expect(hasDefended(tally)).toBe(false);
  });

  it('does not change the tally it was given', () => {
    const before = emptyTally();
    tallyDefense(before, [defended('parry', 'perfect', 0.01)], 'player');
    expect(before).toEqual(emptyTally());
  });
});

describe('summarizeTiming', () => {
  it('has nothing to say without a timed input', () => {
    expect(summarizeTiming([])).toBeNull();
  });

  it('reports the average offset and how widely the inputs scatter around it', () => {
    // Always 30ms late, give or take 20ms.
    const summary = summarizeTiming([0.01, 0.05, 0.01, 0.05]);

    expect(summary?.count).toBe(4);
    expect(summary?.meanSeconds).toBeCloseTo(0.03);
    expect(summary?.spreadSeconds).toBeCloseTo(0.02);
  });
});

describe('formatOffset', () => {
  it('says which side of the mark, in milliseconds', () => {
    expect(formatOffset(-0.04)).toBe('40ms early');
    expect(formatOffset(0.0123)).toBe('12ms late');
    expect(formatOffset(0.0002)).toBe('on the mark');
  });
});
