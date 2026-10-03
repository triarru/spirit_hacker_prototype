/** RAM shown as a memory map: each block holds this much. */
export const RAM_BLOCK = 5;

export interface MemoryCell {
  /** How full the block is, 0 to 1. */
  fill: number;
  /** The spell being aimed would use some of this block. */
  pending: boolean;
  /** Some of this block comes back at the start of next turn. */
  loading: boolean;
}

/**
 * The blocks of the memory map. `cost` is what the spell being aimed would
 * take (0 when nothing is aimed), `regen` what comes back next turn.
 */
export function memoryCells(ram: number, maxRam: number, cost: number, regen: number): MemoryCell[] {
  const count = Math.ceil(maxRam / RAM_BLOCK);
  const spentFrom = Math.max(0, ram - cost);
  const refilledTo = Math.min(maxRam, ram + regen);
  return Array.from({ length: count }, (_, index) => {
    const start = index * RAM_BLOCK;
    const end = Math.min(start + RAM_BLOCK, maxRam);
    // Whether the block overlaps the range [from, to).
    const overlaps = (from: number, to: number): boolean => from < end && to > start;
    return {
      fill: Math.min(1, Math.max(0, (ram - start) / (end - start))),
      pending: cost > 0 && overlaps(spentFrom, ram),
      loading: overlaps(ram, refilledTo),
    };
  });
}

/** Seconds per sweep of the heart trace: calm at full health, racing near death. */
export function heartbeatSeconds(hp: number, maxHp: number): number {
  const health = maxHp > 0 ? Math.min(1, Math.max(0, hp / maxHp)) : 0;
  return 0.8 + 1.6 * health;
}

/** Below this share of health the monitor shows the player is in danger. */
export const LOW_HEALTH = 0.3;
