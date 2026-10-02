import { parseOneOf } from '../data/parse';
import programsJson from '../data/programs.json';
import {
  RESOURCE_TYPES,
  SPELL_TAGS,
  TARGETINGS,
  type ActiveSpec,
  type Effect,
  type Program,
  type SpellTag,
} from './Program';

// --- Modifier function map ---------------------------------------------------

/**
 * Returns the host spell's spec with the modifier applied. Must not change
 * `spec` itself. `tag` is the tag of the program doing the modifying.
 */
export type ModifyFn = (spec: ActiveSpec, value: number, tag: SpellTag) => ActiveSpec;

export const MODIFIERS: Record<string, ModifyFn> = {
  addDamage: (spec, value) => ({ ...spec, damage: spec.damage + value }),
  addRange: (spec, value) => ({
    ...spec,
    range: spec.range === null ? null : spec.range + value,
  }),
  addAoe: (spec, value) => ({ ...spec, aoe: spec.aoe + value }),
  reduceCost: (spec, value) => ({
    ...spec,
    ramCost: Math.max(0, spec.ramCost - value),
    qiCost: Math.max(0, spec.qiCost - value),
  }),
  addHeal: (spec, value) => ({
    ...spec,
    effects: [...spec.effects, { type: 'heal', amount: value }],
  }),
  // Each enemy the host spell hits is also slowed. Does nothing for a spell that hits no one.
  addSlow: (spec, value) => ({
    ...spec,
    effects: [...spec.effects, { type: 'slow', turns: value }],
  }),
  // The host spell is paid for in Qi, at the same price, instead of RAM.
  payWithQi: (spec) => ({ ...spec, ramCost: 0, qiCost: spec.qiCost + spec.ramCost }),
  // The host spell hits with the modifying program's tag instead of its own.
  takeTag: (spec, _value, tag) => ({ ...spec, tag }),
  // The extra bars ride on the damage: a spell that does none gets nothing from this.
  addFirewallDamage: (spec, value) =>
    spec.damage > 0 ? { ...spec, firewallBonus: spec.firewallBonus + value } : spec,
};

// --- Passive function map ----------------------------------------------------

/** The combined effect of every slotted passive. Combat reads these at fixed points. */
export interface PassiveBonuses {
  basicAttackDamage: number;
  ramPerTurn: number;
  qiPerTurn: number;
  hpPerTurn: number;
  /** Subtracted from each hit the player takes. */
  damageReduction: number;
  /** Extra firewall bars stripped when a hit matches the enemy's weakness. */
  weaknessFirewallBonus: number;
  /** Extra firewall bars a perfect parry strips from the attacker. */
  parryFirewallBonus: number;
  /** Qi that comes back each time an enemy dies. */
  qiPerKill: number;
  /** RAM taken off the price of setting a trap. */
  trapRamDiscount: number;
}

export function noBonuses(): PassiveBonuses {
  return {
    basicAttackDamage: 0,
    ramPerTurn: 0,
    qiPerTurn: 0,
    hpPerTurn: 0,
    damageReduction: 0,
    weaknessFirewallBonus: 0,
    parryFirewallBonus: 0,
    qiPerKill: 0,
    trapRamDiscount: 0,
  };
}

/** Adds one passive's contribution to the running total. */
export type PassiveFn = (bonuses: PassiveBonuses, value: number) => void;

export const PASSIVES: Record<string, PassiveFn> = {
  basicAttackDamage: (bonuses, value) => {
    bonuses.basicAttackDamage += value;
  },
  ramPerTurn: (bonuses, value) => {
    bonuses.ramPerTurn += value;
  },
  qiPerTurn: (bonuses, value) => {
    bonuses.qiPerTurn += value;
  },
  hpPerTurn: (bonuses, value) => {
    bonuses.hpPerTurn += value;
  },
  damageReduction: (bonuses, value) => {
    bonuses.damageReduction += value;
  },
  weaknessFirewallBonus: (bonuses, value) => {
    bonuses.weaknessFirewallBonus += value;
  },
  parryFirewallBonus: (bonuses, value) => {
    bonuses.parryFirewallBonus += value;
  },
  qiPerKill: (bonuses, value) => {
    bonuses.qiPerKill += value;
  },
  trapRamDiscount: (bonuses, value) => {
    bonuses.trapRamDiscount += value;
  },
};

// --- Program data ------------------------------------------------------------

interface RawEffect {
  type: string;
  turns?: number;
  amount?: number;
  count?: number;
  radius?: number;
}

interface RawProgram {
  name: string;
  displayName: string;
  category: string;
  tag: string;
  tier: number;
  resourceType: string;
  active: {
    apCost: number;
    ramCost: number;
    qiCost: number;
    targeting: string;
    range: number | null;
    aoe: number;
    damage: number;
    effects: RawEffect[];
  };
  modifier: { description: string; modifyFn: string; value: number };
  passive: { description: string; passiveFn: string; value: number };
}

function parseEffect(raw: RawEffect, programId: string): Effect {
  const need = (value: number | undefined, field: string): number => {
    if (value === undefined) {
      throw new Error(`Program "${programId}": effect "${raw.type}" is missing "${field}"`);
    }
    return value;
  };

  switch (raw.type) {
    case 'stun':
      return { type: 'stun', turns: need(raw.turns, 'turns') };
    case 'slow':
      return { type: 'slow', turns: need(raw.turns, 'turns') };
    case 'heal':
      return { type: 'heal', amount: need(raw.amount, 'amount') };
    case 'createWall':
      return { type: 'createWall', count: need(raw.count, 'count'), turns: need(raw.turns, 'turns') };
    case 'revealFog':
      return { type: 'revealFog', radius: need(raw.radius, 'radius') };
    default:
      throw new Error(`Program "${programId}": unknown effect "${raw.type}"`);
  }
}

function parseProgram(id: string, raw: RawProgram): Program {
  if (!MODIFIERS[raw.modifier.modifyFn]) {
    throw new Error(`Program "${id}": unknown modifyFn "${raw.modifier.modifyFn}"`);
  }
  if (!PASSIVES[raw.passive.passiveFn]) {
    throw new Error(`Program "${id}": unknown passiveFn "${raw.passive.passiveFn}"`);
  }

  return {
    id,
    name: raw.name,
    displayName: raw.displayName,
    category: raw.category,
    tag: parseOneOf(SPELL_TAGS, raw.tag, `tag of ${id}`),
    tier: parseOneOf([1, 2, 3] as const, raw.tier, `tier of ${id}`),
    resourceType: parseOneOf(RESOURCE_TYPES, raw.resourceType, `resource type of ${id}`),
    active: {
      tag: parseOneOf(SPELL_TAGS, raw.tag, `tag of ${id}`),
      apCost: raw.active.apCost,
      ramCost: raw.active.ramCost,
      qiCost: raw.active.qiCost,
      targeting: parseOneOf(TARGETINGS, raw.active.targeting, `targeting of ${id}`),
      range: raw.active.range,
      aoe: raw.active.aoe,
      damage: raw.active.damage,
      firewallBonus: 0,
      effects: raw.active.effects.map((effect) => parseEffect(effect, id)),
    },
    modifier: raw.modifier,
    passive: raw.passive,
  };
}

const RAW_PROGRAMS: Record<string, RawProgram> = programsJson;

/** Every program in programs.json, validated once at load. */
export const PROGRAMS: Record<string, Program> = Object.fromEntries(
  Object.entries(RAW_PROGRAMS).map(([id, raw]) => [id, parseProgram(id, raw)]),
);

export function getProgram(id: string): Program {
  const program = PROGRAMS[id];
  if (!program) throw new Error(`Unknown program "${id}"`);
  return program;
}

/** The host's Active as it casts with `modifier` slotted under it. */
export function applyModifier(host: ActiveSpec, modifier: Program | null): ActiveSpec {
  if (!modifier) return host;
  const modify = MODIFIERS[modifier.modifier.modifyFn];
  if (!modify) throw new Error(`Unknown modifyFn "${modifier.modifier.modifyFn}"`);
  return modify(host, modifier.modifier.value, modifier.tag);
}

/** The combined bonuses of a set of programs slotted as passives. */
export function combinePassives(passives: readonly Program[]): PassiveBonuses {
  const bonuses = noBonuses();
  for (const program of passives) {
    const contribute = PASSIVES[program.passive.passiveFn];
    if (!contribute) throw new Error(`Unknown passiveFn "${program.passive.passiveFn}"`);
    contribute(bonuses, program.passive.value);
  }
  return bonuses;
}
