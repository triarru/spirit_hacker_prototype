import type { Entity } from '../entities/Entity';
import { PLAYER_DATA, type Player } from '../entities/Player';
import type { PassiveBonuses } from '../programs/ProgramRegistry';

const tieBreak = (entity: Entity): number => (entity.kind === 'player' ? 0 : 1);

/** Fastest first; the player wins ties, and otherwise the given order is kept. */
export function turnOrder<T extends Entity>(entities: readonly T[]): T[] {
  return [...entities].sort((a, b) => b.speed - a.speed || tieBreak(a) - tieBreak(b));
}

/** Refills AP, cashing in whatever was banked since the last turn (up to the cap). */
export function startPlayerTurn(player: Player): void {
  player.ap = Math.min(player.maxAp + player.apBank, PLAYER_DATA.apCap);
  player.apBank = 0;
  player.dodgeChance = 0;
}

/** What the player actually got back at the start of a turn, after capping at their maximums. */
export interface TurnRegen {
  ram: number;
  qi: number;
  hp: number;
}

/**
 * Start-of-turn recovery. RAM comes back on its own (`player.ramRegen`), and
 * passives add to that rather than replacing it. Qi and HP have no base
 * regeneration: they only come back through passives.
 */
export function regenerate(player: Player, bonuses: PassiveBonuses): TurnRegen {
  const regen: TurnRegen = {
    ram: Math.min(player.ramRegen + bonuses.ramPerTurn, player.maxRam - player.ram),
    qi: Math.min(bonuses.qiPerTurn, player.maxQi - player.qi),
    hp: Math.min(bonuses.hpPerTurn, player.maxHp - player.hp),
  };
  player.ram += regen.ram;
  player.qi += regen.qi;
  player.hp += regen.hp;
  return regen;
}

/** Unspent AP is forfeited; ending the turn early buys a dodge chance for the enemy turn instead. */
export function endPlayerTurn(player: Player): void {
  player.dodgeChance = player.ap > 0 ? PLAYER_DATA.endTurnDodgeBonus : 0;
  player.ap = 0;
}
