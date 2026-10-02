import enemiesJson from '../data/enemies.json';
import { parseOneOf } from '../data/parse';
import { hasLineOfSight } from '../hex/hasLineOfSight';
import type { HexCoord } from '../hex/HexCoord';
import type { HexGrid } from '../hex/HexGrid';
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
  /** A virus has already been injected during the current breach; one per breach. */
  virusInjected: boolean;
  /** Turns this enemy will lose to a stun. */
  stunTurns: number;
  /** Turns this enemy will move one hex less than usual. */
  slowTurns: number;
  weakness: SpellTag;
  behaviorType: BehaviorType;
  attackType: AttackType;
  attackDamage: number;
  attackRange: number;
  /** Hexes this enemy may move in one turn. */
  moveRange: number;
  /** One line telling the player how this enemy behaves. */
  hint: string;
  /**
   * For an enemy that holds its ground until provoked: what it takes to make
   * it advance, and how it moves once it does. Null for enemies without this.
   */
  aggro: AggroRule | null;
  /** Damaging hits taken from beyond melee range since it last settled back into its guard. */
  timesHitFromRange: number;
  /** It has been provoked and is advancing on the player. */
  aggressive: boolean;
}

export interface AggroRule {
  /** Ranged hits it takes before it advances. */
  afterRangedHits: number;
  /** Its turn-order speed while advancing. */
  speed: number;
  /** Hexes it moves per turn while advancing. */
  moveRange: number;
  /** Its turn-order speed while holding position, to go back to. */
  guardSpeed: number;
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
  hint: string;
  aggroAfterRangedHits?: number;
  aggressiveSpeed?: number;
  aggressiveMoveRange?: number;
}

const DEFINITIONS: Record<string, EnemyDefinition> = enemiesJson;

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
    virusInjected: false,
    stunTurns: 0,
    slowTurns: 0,
    weakness: parseOneOf(SPELL_TAGS, definition.weakness, `weakness of ${typeId}`),
    behaviorType: parseOneOf(BEHAVIOR_TYPES, definition.behavior, `behavior of ${typeId}`),
    attackType: parseOneOf(ATTACK_TYPES, definition.attack.type, `attack type of ${typeId}`),
    attackDamage: definition.attack.damage,
    attackRange: definition.attack.range,
    moveRange: definition.moveRange,
    hint: definition.hint,
    aggro:
      definition.aggroAfterRangedHits === undefined
        ? null
        : {
            afterRangedHits: definition.aggroAfterRangedHits,
            speed: definition.aggressiveSpeed ?? definition.speed,
            moveRange: definition.aggressiveMoveRange ?? 1,
            guardSpeed: definition.speed,
          },
    timesHitFromRange: 0,
    aggressive: false,
  };
}

/** Hexes the enemy may move this turn: more than usual for one that has been provoked into advancing. */
export function moveRangeOf(enemy: Enemy): number {
  return enemy.aggressive && enemy.aggro ? enemy.aggro.moveRange : enemy.moveRange;
}

/** What to call the enemy's current behavior, for display. */
export function stanceOf(enemy: Enemy): string {
  if (enemy.behaviorType === 'guard') return enemy.aggressive ? 'Aggressive' : 'Guard';
  return enemy.behaviorType === 'patrol' ? 'Hunter' : 'Erratic';
}

/** Whether `target` is within the enemy's reach from `from`. Says nothing about what is in between. */
export function inAttackRange(enemy: Enemy, from: HexCoord, target: HexCoord): boolean {
  return from.distance(target) <= enemy.attackRange;
}

/**
 * Whether the enemy could actually hit `target` if it stood on `from`: in
 * range, and for a ranged attack, with nothing solid in the way. A projectile
 * is a physical thing, so walls stop it.
 */
export function canHitFrom(grid: HexGrid, enemy: Enemy, from: HexCoord, target: HexCoord): boolean {
  if (!inAttackRange(enemy, from, target)) return false;
  return enemy.attackType !== 'ranged' || hasLineOfSight(grid, from, target);
}
