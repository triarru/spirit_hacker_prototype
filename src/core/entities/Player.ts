import playerJson from '../data/player.json';
import type { HexCoord } from '../hex/HexCoord';
import type { Entity } from './Entity';

export const PLAYER_ID = 'player';

/** Player rules and stats, straight from player.json. */
export const PLAYER_DATA = playerJson;

export interface Player extends Entity {
  kind: 'player';
  ap: number;
  maxAp: number;
  /** AP earned outside the player's turn (e.g. a perfect parry), added at the start of the next one. */
  apBank: number;
  ram: number;
  maxRam: number;
  /** RAM that comes back on its own at the start of each turn. */
  ramRegen: number;
  qi: number;
  maxQi: number;
  /** Chance (0–1) that an incoming attack misses outright. */
  dodgeChance: number;
}

/** A player at the start of a run: stats and starting resources from player.json. */
export function createPlayer(position: HexCoord): Player {
  return {
    id: PLAYER_ID,
    kind: 'player',
    typeId: 'player',
    name: PLAYER_DATA.name,
    position,
    hp: PLAYER_DATA.hp,
    maxHp: PLAYER_DATA.maxHp,
    speed: PLAYER_DATA.speed,
    ap: PLAYER_DATA.maxAp,
    maxAp: PLAYER_DATA.maxAp,
    apBank: 0,
    ram: PLAYER_DATA.ram,
    maxRam: PLAYER_DATA.maxRam,
    ramRegen: PLAYER_DATA.ramRegen,
    qi: PLAYER_DATA.qi,
    maxQi: PLAYER_DATA.maxQi,
    dodgeChance: 0,
  };
}
