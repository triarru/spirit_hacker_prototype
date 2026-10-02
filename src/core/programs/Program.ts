export const SPELL_TAGS = ['FIRE', 'ICE', 'SHOCK', 'CORRUPT', 'PURE'] as const;
export type SpellTag = (typeof SPELL_TAGS)[number];

export const RESOURCE_TYPES = ['RAM', 'QI', 'HYBRID'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * How a spell is aimed:
 * - ENEMY: at one enemy within range (plus enemies within `aoe` of it)
 * - LINE:  in a direction; hits every enemy on a straight line `range` hexes long
 * - FLOOR: at an empty floor hex within range
 * - SELF:  at the caster
 * - ANY:   at any hex within range
 */
export const TARGETINGS = ['ENEMY', 'LINE', 'FLOOR', 'SELF', 'ANY'] as const;
export type Targeting = (typeof TARGETINGS)[number];

export type Effect =
  /** Each enemy hit loses this many turns. */
  | { type: 'stun'; turns: number }
  /** Each enemy hit moves one hex less than usual for this many turns. */
  | { type: 'slow'; turns: number }
  /** The caster recovers HP. */
  | { type: 'heal'; amount: number }
  /** Raises `count` temporary wall hexes that stand for `turns` turns. */
  | { type: 'createWall'; count: number; turns: number }
  /** Lifts fog of war. The prototype has no fog, so this currently does nothing. */
  | { type: 'revealFog'; radius: number };

/** Everything needed to cast a spell: a program's Active, after its modifier (if any) is applied. */
export interface ActiveSpec {
  /** The tag its hits carry. The program's own, unless a modifier changed it. */
  tag: SpellTag;
  apCost: number;
  ramCost: number;
  qiCost: number;
  targeting: Targeting;
  /** In hexes; null means unlimited. */
  range: number | null;
  /** Radius around the target that is also hit; 0 = single target. */
  aoe: number;
  damage: number;
  /** Extra firewall bars stripped from each enemy hit, on top of the normal amount. */
  firewallBonus: number;
  effects: Effect[];
}

/**
 * A program is one item with three uses, depending on the slot it sits in:
 * cast as an Active, alter another Active as its Modifier, or stay on as a Passive.
 */
export interface Program {
  id: string;
  /** Code-style name, e.g. "brute_force()". */
  name: string;
  /** Vietnamese name. */
  displayName: string;
  category: string;
  tag: SpellTag;
  tier: 1 | 2 | 3;
  resourceType: ResourceType;
  active: ActiveSpec;
  modifier: {
    description: string;
    /** Key into the modifier function map. */
    modifyFn: string;
    value: number;
  };
  passive: {
    description: string;
    /** Key into the passive function map. */
    passiveFn: string;
    value: number;
  };
}
