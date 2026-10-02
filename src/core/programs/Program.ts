export const SPELL_TAGS = ['FIRE', 'ICE', 'SHOCK', 'CORRUPT', 'PURE'] as const;
export type SpellTag = (typeof SPELL_TAGS)[number];
