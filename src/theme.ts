import type { SpellTag } from './core/programs/Program';

/** One color per spell tag, shared by the canvas (as numbers) and the DOM (via `cssColor`). */
export const TAG_COLOR: Record<SpellTag, number> = {
  FIRE: 0xf97316,
  ICE: 0x38bdf8,
  SHOCK: 0xfacc15,
  CORRUPT: 0xa855f7,
  PURE: 0xf1f5f9,
};

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
