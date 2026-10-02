import type { Entity } from '../entities/Entity';

/** Returns a number in [0, 1). Injected so combat is deterministic under test. */
export type Rng = () => number;

export interface AttackOutcome {
  damage: number;
  dodged: boolean;
  killed: boolean;
}

/**
 * Applies one attack to `target`, reducing its HP.
 * `dodgeChance` is the target's chance (0–1) to avoid the attack entirely.
 */
export function resolveAttack(
  target: Entity,
  damage: number,
  dodgeChance: number,
  rng: Rng,
): AttackOutcome {
  if (dodgeChance > 0 && rng() < dodgeChance) {
    return { damage: 0, dodged: true, killed: false };
  }
  target.hp = Math.max(0, target.hp - damage);
  return { damage, dodged: false, killed: target.hp === 0 };
}
