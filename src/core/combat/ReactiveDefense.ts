import reactiveJson from '../data/reactive.json';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { hexToPixel, type HexCoord } from '../hex/HexCoord';
import type { HexGrid } from '../hex/HexGrid';

export type Direction = 'up' | 'down' | 'left' | 'right';
export type DefenseGrade = 'perfect' | 'good' | 'miss';

/** When to act. Both prompts are timed the same way: a mark, and how far off it still counts. */
export interface TimingWindow {
  durationSeconds: number;
  /** The moment to act. */
  perfectAtSeconds: number;
  /** Acting within this much of the mark, either side, is perfect. */
  perfectToleranceSeconds: number;
  /** Acting within this much of the mark, either side, still counts as good. */
  goodToleranceSeconds: number;
  /**
   * How far ahead of the mark an input starts to count as an attempt. Anything
   * earlier is taken for a stray press and ignored, so it does not use up the
   * one attempt the player gets.
   */
  judgeToleranceSeconds: number;
}

/** Melee attack: act at the moment the shrinking ring meets the target ring. */
export interface ParryPrompt extends TimingWindow {
  kind: 'parry';
  attackerId: string;
}

/**
 * Ranged attack: press the direction that takes the defender away from the
 * shooter, at the moment the shot lands. The time before inputs start to
 * count is there for reading which direction that is.
 */
export interface DodgePrompt extends TimingWindow {
  kind: 'dodge';
  attackerId: string;
  /** The projectile flies from `from` to `to`. */
  from: HexCoord;
  to: HexCoord;
  /** The direction that dodges it: away from the shooter. */
  answer: Direction;
}

export type DefensePrompt = ParryPrompt | DodgePrompt;

export type DefenseInput = { kind: 'parry' } | { kind: 'dodge'; direction: Direction };

/** Why an attempt failed. An attack that was never answered has no reason. */
export type MissReason = 'early' | 'late' | 'wrong_way';

export interface DefenseResult {
  kind: DefensePrompt['kind'];
  grade: DefenseGrade;
  /** The direction pressed, for a dodge that was answered. */
  direction?: Direction;
  /** What went wrong, for an attempt that missed. */
  missedBy?: MissReason;
  /** How far from the mark the attempt landed: negative is early, positive is late. Absent when nothing was pressed. */
  offBySeconds?: number;
}

/** What a defense result does to the attack it answered. */
export interface DefenseEffects {
  damageMultiplier: number;
  apBank: number;
  firewallDamage: number;
  teleportHexes: number;
}

const NO_DEFENSE: DefenseEffects = {
  damageMultiplier: 1,
  apBank: 0,
  firewallDamage: 0,
  teleportHexes: 0,
};

/**
 * The prompt an attack gives the player, or null when the attack cannot be
 * reacted to (AoE attacks need the Expedition Counter, which is not built yet).
 */
export function createDefensePrompt(attacker: Enemy, player: Player): DefensePrompt | null {
  switch (attacker.attackType) {
    case 'melee':
      return { kind: 'parry', attackerId: attacker.id, ...timingOf(reactiveJson.parry) };
    case 'ranged':
      return {
        kind: 'dodge',
        attackerId: attacker.id,
        ...timingOf(reactiveJson.dodge),
        from: attacker.position,
        to: player.position,
        answer: dodgeAnswer(attacker.position, player.position),
      };
    case 'aoe':
      return null;
  }
}

/** Just the timing fields of a prompt's rules, so nothing else from the data file rides along. */
function timingOf(rules: TimingWindow): TimingWindow {
  return {
    durationSeconds: rules.durationSeconds,
    perfectAtSeconds: rules.perfectAtSeconds,
    perfectToleranceSeconds: rules.perfectToleranceSeconds,
    goodToleranceSeconds: rules.goodToleranceSeconds,
    judgeToleranceSeconds: rules.judgeToleranceSeconds,
  };
}

/** How well an input at `atSeconds` hits the mark. */
export function gradeTiming(window: TimingWindow, atSeconds: number): DefenseGrade {
  const offBy = Math.abs(atSeconds - window.perfectAtSeconds);
  if (offBy <= window.perfectToleranceSeconds) return 'perfect';
  if (offBy <= window.goodToleranceSeconds) return 'good';
  return 'miss';
}

/** Whether an input at `atSeconds` is close enough to the mark to count as an attempt at it. */
export function isAttempt(window: TimingWindow, atSeconds: number): boolean {
  return atSeconds >= window.perfectAtSeconds - window.judgeToleranceSeconds;
}

/**
 * The key that dodges a projectile flying from `from` to `to`: away from the
 * shooter, which is the way the shot is already travelling, snapped to
 * whichever screen axis that mostly is.
 */
export function dodgeAnswer(from: HexCoord, to: HexCoord): Direction {
  const source = hexToPixel(from);
  const target = hexToPixel(to);
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  // Screen y grows downward.
  return dy < 0 ? 'up' : 'down';
}

/** Each direction as a screen-space unit vector (y grows downward). */
export const DIRECTION_VECTORS: Record<Direction, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * Where a perfect dodge carries the defender: the neighboring hex directly
 * away from the shooter. Of the six neighbors that is the one most in line
 * with shooter → defender; when the shot runs exactly between two hex
 * directions those two tie, and the first free one is taken.
 *
 * Null when the hex behind is blocked (wall, enemy, edge of the grid). The
 * dodge still works in that case; the defender just stays where they are.
 */
export function dodgeDestination(grid: HexGrid, from: HexCoord, shooter: HexCoord): HexCoord | null {
  const origin = hexToPixel(from);
  const source = hexToPixel(shooter);
  const awayX = origin.x - source.x;
  const awayY = origin.y - source.y;
  const TOLERANCE = 1e-6;

  let bestAlignment = -Infinity;
  let behind: HexCoord[] = [];
  for (const hex of from.neighbors()) {
    const center = hexToPixel(hex);
    const alignment = (center.x - origin.x) * awayX + (center.y - origin.y) * awayY;
    if (alignment > bestAlignment + TOLERANCE) {
      bestAlignment = alignment;
      behind = [hex];
    } else if (Math.abs(alignment - bestAlignment) <= TOLERANCE) {
      behind.push(hex);
    }
  }
  return behind.find((hex) => !grid.isBlocked(hex)) ?? null;
}

/** `null` means the attack was not defended at all. */
export function defenseEffects(result: DefenseResult | null): DefenseEffects {
  if (!result || result.grade === 'miss') return NO_DEFENSE;

  if (result.kind === 'dodge') {
    // Right way, slightly off the beat: most of the shot is avoided, but there is no clean step away.
    if (result.grade === 'good') {
      return { ...NO_DEFENSE, damageMultiplier: reactiveJson.dodge.goodDamageMultiplier };
    }
    return {
      ...NO_DEFENSE,
      damageMultiplier: 0,
      teleportHexes: reactiveJson.dodge.perfectTeleportHexes,
    };
  }
  if (result.grade === 'good') {
    return { ...NO_DEFENSE, damageMultiplier: reactiveJson.parry.goodDamageMultiplier };
  }
  return {
    ...NO_DEFENSE,
    damageMultiplier: 0,
    apBank: reactiveJson.parry.perfectApBank,
    firewallDamage: reactiveJson.parry.perfectFirewallDamage,
  };
}

/**
 * One prompt in progress. It owns no clock: whoever drives it reports how much
 * time has passed and when each input arrived, so the same logic runs under a
 * browser frame loop, an engine's update tick, or a test.
 */
export class ReactiveDefense {
  readonly prompt: DefensePrompt;
  elapsedSeconds = 0;
  /** Set once, by the first input that fits the prompt or by running out of time. */
  result: DefenseResult | null = null;

  constructor(prompt: DefensePrompt) {
    this.prompt = prompt;
  }

  /** Moves the clock to `elapsedSeconds` after the prompt appeared. Running out of time is a miss. */
  advanceTo(elapsedSeconds: number): void {
    if (this.result) return;
    this.elapsedSeconds = Math.min(elapsedSeconds, this.prompt.durationSeconds);
    if (elapsedSeconds >= this.prompt.durationSeconds) {
      this.result = { kind: this.prompt.kind, grade: 'miss' };
    }
  }

  /**
   * Registers what the player did `atSeconds` after the prompt appeared. The
   * player gets one attempt: the first input that fits the prompt and comes
   * close enough to the mark decides it. Input of the wrong kind (an arrow key
   * during a parry) and input long before the mark are ignored.
   */
  handleInput(input: DefenseInput, atSeconds: number): void {
    if (this.result || input.kind !== this.prompt.kind) return;
    if (atSeconds >= this.prompt.durationSeconds) return;
    if (!isAttempt(this.prompt, atSeconds)) return;

    this.elapsedSeconds = Math.max(0, atSeconds);
    const timing = gradeTiming(this.prompt, atSeconds);
    const offBySeconds = atSeconds - this.prompt.perfectAtSeconds;
    const mistimed: MissReason = offBySeconds < 0 ? 'early' : 'late';

    if (this.prompt.kind === 'parry') {
      this.result =
        timing === 'miss'
          ? { kind: 'parry', grade: 'miss', missedBy: mistimed, offBySeconds }
          : { kind: 'parry', grade: timing, offBySeconds };
    } else if (input.kind === 'dodge') {
      const { direction } = input;
      if (direction !== this.prompt.answer) {
        this.result = { kind: 'dodge', grade: 'miss', direction, missedBy: 'wrong_way', offBySeconds };
      } else if (timing === 'miss') {
        this.result = { kind: 'dodge', grade: 'miss', direction, missedBy: mistimed, offBySeconds };
      } else {
        this.result = { kind: 'dodge', grade: timing, direction, offBySeconds };
      }
    }
  }
}
