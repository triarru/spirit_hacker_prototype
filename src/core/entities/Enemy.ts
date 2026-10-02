import enemiesJson from '../data/enemies.json';
import type { HexCoord } from '../hex/HexCoord';
import { SPELL_TAGS, type SpellTag } from '../programs/Program';
import type { Entity } from './Entity';

export const BEHAVIOR_TYPES = ['patrol', 'guard', 'random'] as const;
export type BehaviorType = (typeof BEHAVIOR_TYPES)[number];

export const ATTACK_TYPES = ['melee', 'ranged', 'aoe'] as const;
export type AttackType = (typeof ATTACK_TYPES)[number];

export interface Enemy extends Entity {
  kind: 'enemy';
  firewallMax: number;
  firewallCurrent: number;
  /** Firewall is down: the enemy loses turns and takes extra damage until it recovers. */
  breached: boolean;
  /** Turns a breached enemy still has to sit out before it can recover. */
  breachSkipsLeft: number;
  weakness: SpellTag;
  behaviorType: BehaviorType;
  attackType: AttackType;
  attackDamage: number;
  attackRange: number;
  /** Hexes this enemy may move in one turn. */
  moveRange: number;
}

interface EnemyDefinition {
  name: string;
  maxHp: number;
  speed: number;
  firewall: number;
  weakness: string;
  behavior: string;
  moveRange: number;
  attack: { type: string; damage: number; range: number };
}

const DEFINITIONS: Record<string, EnemyDefinition> = enemiesJson;

/** Narrows a string read from JSON to one of the allowed literals, or fails loudly. */
function parseOneOf<T extends string>(allowed: readonly T[], value: string, what: string): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new Error(`Unknown ${what} "${value}"`);
  return match;
}

export function createEnemy(typeId: string, id: string, position: HexCoord): Enemy {
  const definition = DEFINITIONS[typeId];
  if (!definition) throw new Error(`Unknown enemy type "${typeId}"`);

  return {
    id,
    kind: 'enemy',
    typeId,
    name: definition.name,
    position,
    hp: definition.maxHp,
    maxHp: definition.maxHp,
    speed: definition.speed,
    firewallMax: definition.firewall,
    firewallCurrent: definition.firewall,
    breached: false,
    breachSkipsLeft: 0,
    weakness: parseOneOf(SPELL_TAGS, definition.weakness, `weakness of ${typeId}`),
    behaviorType: parseOneOf(BEHAVIOR_TYPES, definition.behavior, `behavior of ${typeId}`),
    attackType: parseOneOf(ATTACK_TYPES, definition.attack.type, `attack type of ${typeId}`),
    attackDamage: definition.attack.damage,
    attackRange: definition.attack.range,
    moveRange: definition.moveRange,
  };
}

/** Whether the enemy could hit `target` if it stood on `from`. */
export function inAttackRange(enemy: Enemy, from: HexCoord, target: HexCoord): boolean {
  return from.distance(target) <= enemy.attackRange;
}
