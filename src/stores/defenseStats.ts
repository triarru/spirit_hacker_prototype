import type { CombatEvent } from '../core/combat/CombatManager';
import type { DefenseGrade, DefenseResult } from '../core/combat/ReactiveDefense';

type GradeCounts = Record<DefenseGrade, number>;

/** How the player has answered enemy attacks so far this fight. */
export interface DefenseTally {
  parry: GradeCounts;
  dodge: GradeCounts;
  /** Attacks that landed without the player pressing anything in time. */
  unanswered: number;
  /** Every timed input, as its distance from the mark: negative is early, positive is late. */
  offsetsSeconds: number[];
}

const noCounts = (): GradeCounts => ({ perfect: 0, good: 0, miss: 0 });

export function emptyTally(): DefenseTally {
  return { parry: noCounts(), dodge: noCounts(), unanswered: 0, offsetsSeconds: [] };
}

/**
 * Adds one batch of events to the tally. A batch is what one action produced,
 * which is what tells an unanswered attack (a hit with no parry or dodge
 * beside it) from one the player tried to answer.
 */
export function tallyDefense(tally: DefenseTally, events: readonly CombatEvent[], playerId: string): DefenseTally {
  const next: DefenseTally = {
    parry: { ...tally.parry },
    dodge: { ...tally.dodge },
    unanswered: tally.unanswered,
    offsetsSeconds: [...tally.offsetsSeconds],
  };
  const count = (kind: DefenseResult['kind'], grade: DefenseGrade, offBySeconds: number | undefined): void => {
    next[kind][grade] += 1;
    if (offBySeconds !== undefined) next.offsetsSeconds.push(offBySeconds);
  };

  let attempted = false;
  for (const event of events) {
    if (event.type === 'defended') {
      attempted = true;
      count(event.kind, event.grade, event.offBySeconds);
    } else if (event.type === 'defenseMissed') {
      attempted = true;
      count(event.kind, 'miss', event.offBySeconds);
    } else if (event.type === 'attacked' && event.targetId === playerId && !attempted) {
      next.unanswered += 1;
    }
  }
  return next;
}

/** Whether anything has been tallied yet. */
export function hasDefended(tally: DefenseTally): boolean {
  const answered = [tally.parry, tally.dodge].some((counts) => counts.perfect + counts.good + counts.miss > 0);
  return answered || tally.unanswered > 0;
}

/** Where the player's inputs land on average, and how widely they scatter around that. */
export interface TimingSummary {
  count: number;
  /** Negative: tends to press early. Positive: late. */
  meanSeconds: number;
  /** Standard deviation of the offsets. */
  spreadSeconds: number;
}

export function summarizeTiming(offsetsSeconds: readonly number[]): TimingSummary | null {
  const count = offsetsSeconds.length;
  if (count === 0) return null;
  const meanSeconds = offsetsSeconds.reduce((sum, offset) => sum + offset, 0) / count;
  const variance = offsetsSeconds.reduce((sum, offset) => sum + (offset - meanSeconds) ** 2, 0) / count;
  return { count, meanSeconds, spreadSeconds: Math.sqrt(variance) };
}

/** "12ms late", "40ms early", or "on the mark". */
export function formatOffset(offBySeconds: number): string {
  const ms = Math.round(offBySeconds * 1000);
  if (ms === 0) return 'on the mark';
  return `${Math.abs(ms)}ms ${ms < 0 ? 'early' : 'late'}`;
}
