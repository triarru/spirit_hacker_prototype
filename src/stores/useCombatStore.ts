import { create } from 'zustand';
import { loadRoom, type RoomState } from '../core/data/RoomLoader';
import type { Entity } from '../core/entities/Entity';

const ROOM_ID = 'prototype_room';

export type CombatState = RoomState;

export const useCombatStore = create<CombatState>(() => loadRoom(ROOM_ID));

export function selectPlayer(state: CombatState): Entity {
  const player = state.entities.find((entity) => entity.id === state.playerId);
  if (!player) throw new Error('Player entity is missing from the combat state');
  return player;
}
