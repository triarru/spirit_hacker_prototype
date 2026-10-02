import playerJson from '../data/player.json';
import type { HexCoord } from '../hex/HexCoord';
import type { Entity } from './Entity';

export const PLAYER_ID = 'player';

export interface Player extends Entity {
  kind: 'player';
  ap: number;
  maxAp: number;
  /** AP earned outside the player's turn (e.g. a perfect parry), added at the start of the next one. */
  apBank: number;
  ram: number;
  maxRam: number;
  qi: number;
  maxQi: number;
}

export function createPlayer(position: HexCoord): Player {
  return {
    id: PLAYER_ID,
    kind: 'player',
    typeId: 'player',
    name: playerJson.name,
    position,
    hp: playerJson.maxHp,
    maxHp: playerJson.maxHp,
    speed: playerJson.speed,
    ap: playerJson.maxAp,
    maxAp: playerJson.maxAp,
    apBank: 0,
    ram: playerJson.maxRam,
    maxRam: playerJson.maxRam,
    qi: playerJson.maxQi,
    maxQi: playerJson.maxQi,
  };
}
