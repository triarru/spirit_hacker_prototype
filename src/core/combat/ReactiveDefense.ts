import reactiveJson from '../data/reactive.json';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { hexToPixel, type HexCoord } from '../hex/HexCoord';
import type { HexGrid } from '../hex/HexGrid';

export type Direction = 'up' | 'down' | 'left' | 'right';
export type DefenseGrade = 'perfect' | 'good' | 'miss';

/** Melee attack: act at the moment the shrinking ring meets the target ring. */
export interface ParryPrompt {
  kind: 'parry';
  attackerId: string;
  durationSeconds: number;
  /** The moment the two rings coincide. */
  perfectAtSeconds: number;
  /** Total width of the perfect window, centered on `perfectAtSeconds`. */
  perfectWindowSeconds: number;
  /** A parry this far either side of `perfectAtSeconds` still counts as good. */
  goodToleranceSeconds: number;
}

/** Ranged attack: press the direction opposite to the projectile's travel. */
export interface DodgePrompt {
  kind: 'dodge';
  attackerId: string;
  durationSeconds: number;
  /** The projectile flies from `from` to `to`. */
  from: HexCoord;
  to: HexCoord;
  /** The direction that dodges it. */
  answer: Direction;
}

export type DefensePrompt = ParryPrompt | DodgePrompt;

export type DefenseInput = { kind: 'parry' } | { kind: 'dodge'; direction: Direction };

export interface DefenseResult {
  kind: DefensePrompt['kind'];
  grade: DefenseGrade;
  /** The direction pressed, for a dodge that was answered. */
  direction?: Direction;
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
      return {
        kind: 'parry',
        attackerId: attacker.id,
        durationSeconds: reactiveJson.parry.durationSeconds,
        perfectAtSeconds: reactiveJson.parry.perfectAtSeconds,
        perfectWindowSeconds: reactiveJson.parry.perfectWindowSeconds,
        goodToleranceSeconds: reactiveJson.parry.goodToleranceSeconds,
      };
    case 'ranged':
      return {
        kind: 'dodge',
        attackerId: attacker.id,
        durationSeconds: reactiveJson.dodge.durationSeconds,
        from: attacker.position,
        to: player.position,
        answer: dodgeAnswer(attacker.position, player.position),
      };
    case 'aoe':
      return null;
  }
}

export function gradeParry(prompt: ParryPrompt, atSeconds: number): DefenseGrade {
  const offBy = Math.abs(atSeconds - prompt.perfectAtSeconds);
  if (offBy <= prompt.perfectWindowSeconds / 2) return 'perfect';
  if (offBy <= prompt.goodToleranceSeconds) return 'good';
  return 'miss';
}

/**
 * The direction that dodges a projectile flying from `from` to `to`: straight
 * back at it, snapped to whichever screen axis the shot mostly travels along.
 */
export function dodgeAnswer(from: HexCoord, to: HexCoord): Direction {
  const source = hexToPixel(from);
  const target = hexToPixel(to);
  const dx = source.x - target.x;
  const dy = source.y - target.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  // Screen y grows downward.
  return dy < 0 ? 'up' : 'down';
}

const DIRECTION_VECTORS: Record<Direction, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * Where a perfect dodge carries the player: the free neighbor that lies most
 * in `direction`. A flat-top hex has no neighbor straight left or right, so
 * the two diagonals on that side tie; the one nearer `toward` wins. Null when
 * every hex on that side is blocked.
 */
export function dodgeDestination(
  grid: HexGrid,
  from: HexCoord,
  direction: Direction,
  toward: HexCoord,
): HexCoord | null {
  const origin = hexToPixel(from);
  const [dirX, dirY] = DIRECTION_VECTORS[direction];

  let best: { hex: HexCoord; alignment: number } | null = null;
  for (const hex of from.neighbors()) {
    if (grid.isBlocked(hex)) continue;
    const center = hexToPixel(hex);
    const alignment = (center.x - origin.x) * dirX + (center.y - origin.y) * dirY;
    if (alignment <= 0) continue;

    const better =
      !best ||
      alignment > best.alignment + 1e-6 ||
      (Math.abs(alignment - best.alignment) <= 1e-6 &&
        hex.distance(toward) < best.hex.distance(toward));
    if (better) best = { hex, alignment };
  }
  return best?.hex ?? null;
}

/** `null` means the attack was not defended at all. */
export function defenseEffects(result: DefenseResult | null): DefenseEffects {
  if (!result || result.grade === 'miss') return NO_DEFENSE;

  if (result.kind === 'dodge') {
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
   * player gets one attempt: the first input that fits the prompt decides it,
   * and input of the wrong kind (an arrow key during a parry) is ignored.
   */
  handleInput(input: DefenseInput, atSeconds: number): void {
    if (this.result || input.kind !== this.prompt.kind) return;
    if (atSeconds >= this.prompt.durationSeconds) return;

    this.elapsedSeconds = Math.max(0, atSeconds);
    if (this.prompt.kind === 'parry') {
      this.result = { kind: 'parry', grade: gradeParry(this.prompt, atSeconds) };
    } else if (input.kind === 'dodge') {
      this.result = {
        kind: 'dodge',
        grade: input.direction === this.prompt.answer ? 'perfect' : 'miss',
        direction: input.direction,
      };
    }
  }
}
