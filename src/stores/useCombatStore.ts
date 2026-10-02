import { create } from 'zustand';
import { CombatManager, type CombatEvent, type CombatPhase } from '../core/combat/CombatManager';
import {
  ReactiveDefense,
  type DefensePrompt,
  type DefenseResult,
} from '../core/combat/ReactiveDefense';
import { loadRoom } from '../core/data/RoomLoader';
import timing from '../core/data/timing.json';
import type { Enemy } from '../core/entities/Enemy';
import type { Player } from '../core/entities/Player';
import type { HexCoord } from '../core/hex/HexCoord';
import type { HexGrid } from '../core/hex/HexGrid';
import { runReactivePrompt } from './reactiveLoop';

const ROOM_ID = 'prototype_room';

/**
 * The live game. Core logic mutates it in place; nothing outside this module
 * reads it directly — everyone else sees the snapshots published below.
 */
const combat = new CombatManager(loadRoom(ROOM_ID));

interface CombatSnapshot {
  grid: HexGrid;
  player: Player;
  enemies: Enemy[];
  phase: CombatPhase;
  turn: number;
  moveRange: HexCoord[];
  /** Enemies a click would attack right now. */
  attackableEnemyIds: string[];
}

export interface CombatState extends CombatSnapshot {
  /** An action is still playing out; input is ignored until it finishes. */
  busy: boolean;
  /**
   * The reactive-defense prompt on screen, if any. This is the live session:
   * its `elapsedSeconds` advances every frame without a store update, so read
   * it per frame rather than subscribing to it.
   */
  reactive: ReactiveDefense | null;
  /** What the most recent change consisted of. Replaced, never appended to. */
  lastEvents: CombatEvent[];
  /** Walks the player to `hex` one step at a time. Does nothing if it is out of reach. */
  movePlayerTo: (hex: HexCoord) => Promise<void>;
  /** Basic attack. Does nothing if the enemy is out of range or the player cannot pay. */
  attackEnemy: (enemyId: string) => void;
  /** Ends the player turn and plays out the enemy turn. */
  endTurn: () => Promise<void>;
}

/** Copies of the live entities, so subscribers see a new reference whenever something changed. */
function snapshot(): CombatSnapshot {
  return {
    grid: combat.grid,
    player: { ...combat.player },
    enemies: combat.enemies.map((enemy) => ({ ...enemy })),
    phase: combat.phase,
    turn: combat.turn,
    moveRange: combat.getMoveRange(),
    attackableEnemyIds: combat.getAttackableEnemies().map((enemy) => enemy.id),
  };
}

const sleep = (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export const useCombatStore = create<CombatState>((set, get) => {
  /** Publishes the state after a change. Returns false when nothing happened. */
  const publish = (events: CombatEvent[]): boolean => {
    if (events.length === 0) return false;
    set({ ...snapshot(), lastEvents: events });
    return true;
  };

  /** Shows a prompt and waits for the player to answer it or run out of time. */
  const promptDefense = async (prompt: DefensePrompt): Promise<DefenseResult> => {
    const session = new ReactiveDefense(prompt);
    set({ reactive: session });
    const result = await runReactivePrompt(session);
    set({ reactive: null });
    return result;
  };

  return {
    ...snapshot(),
    busy: false,
    reactive: null,
    lastEvents: [],

    movePlayerTo: async (hex) => {
      if (get().busy) return;
      const path = combat.getPathTo(hex);
      if (path.length < 2) return;

      set({ busy: true });
      for (const step of path.slice(1)) {
        if (!publish(combat.stepPlayer(step))) break;
        await sleep(timing.moveSecondsPerHex);
      }
      set({ busy: false });
    },

    attackEnemy: (enemyId) => {
      if (get().busy) return;
      publish(combat.playerAttack(enemyId));
    },

    endTurn: async () => {
      if (get().busy) return;
      // Outside the player turn this yields no events, and there is nothing to play out.
      if (!publish(combat.endPlayerTurn())) return;
      set({ busy: true });

      for (const enemyId of combat.getEnemyTurnOrder()) {
        for (const action of combat.planEnemyTurn(enemyId)) {
          await sleep(timing.enemyActionDelaySeconds);
          // An attack the player can react to waits here for their parry or dodge.
          const prompt = combat.getDefensePrompt(enemyId, action);
          const defense = prompt ? await promptDefense(prompt) : null;
          publish(combat.applyEnemyAction(enemyId, action, defense));
        }
        // A killing blow ends the fight on the spot; nobody else gets to act.
        if (combat.phase !== 'ENEMY_TURN') break;
      }

      await sleep(timing.enemyActionDelaySeconds);
      publish(combat.endEnemyPhase());
      set({ busy: false });
    },
  };
});

/** The path a click on `hex` would walk right now. Empty while busy or when out of reach. */
export function previewPath(hex: HexCoord): HexCoord[] {
  if (useCombatStore.getState().busy) return [];
  return combat.getPathTo(hex);
}
