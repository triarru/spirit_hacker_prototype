import type { HexCoord } from '../hex/HexCoord';

export type EntityKind = 'player' | 'enemy';

export interface Entity {
  id: string;
  kind: EntityKind;
  /** Key of the data definition this entity was spawned from (an enemies.json id, or 'player'). */
  typeId: string;
  name: string;
  position: HexCoord;
  hp: number;
  maxHp: number;
  speed: number;
}
