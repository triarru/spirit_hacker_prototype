import type { Entity } from '../entities/Entity';
import { PLAYER_DATA, type Player } from '../entities/Player';

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

/** Unspent AP is forfeited; ending the turn early buys a dodge chance for the enemy turn instead. */
export function endPlayerTurn(player: Player): void {
  player.dodgeChance = player.ap > 0 ? PLAYER_DATA.endTurnDodgeBonus : 0;
  player.ap = 0;
}
