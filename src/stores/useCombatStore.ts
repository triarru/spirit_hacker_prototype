import { create } from 'zustand';
import {
  CombatManager,
  type CombatEvent,
  type CombatPhase,
  type HackOption,
  type HandCard,
  type SpellPreview,
} from '../core/combat/CombatManager';
import type { HackKind } from '../core/combat/EnvironmentHack';
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
import type { Program } from '../core/programs/Program';
import { createStarterDeck } from '../core/programs/SpellDeck';
import { runReactivePrompt } from './reactiveLoop';

const ROOM_ID = 'prototype_room';

/**
 * The live game. Core logic mutates it in place; nothing outside this module
 * reads it directly — everyone else sees the snapshots published below.
 */
const combat = new CombatManager(loadRoom(ROOM_ID), Math.random, createStarterDeck());

interface CombatSnapshot {
  grid: HexGrid;
  player: Player;
  enemies: Enemy[];
  phase: CombatPhase;
  turn: number;
  moveRange: HexCoord[];
  /** Enemies a click would attack right now. */
  attackableEnemyIds: string[];
  /** Breached enemies the player can inject a virus into right now. */
  injectableEnemyIds: string[];
  /** Hexes the player could hack right now. */
  hackTargets: HexCoord[];
  /** This turn's cards that have not been cast yet. */
  hand: HandCard[];
  /** Programs slotted as passives; always in effect. */
  passives: readonly Program[];
  /** Changes whenever temporary walls go up or come down. */
  terrainVersion: number;
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
  /** Turns a breached enemy on its nearest ally. Does nothing if that is not possible right now. */
  injectVirus: (enemyId: string) => void;
  /** Casts the hand card from Active slot `slot` at `hex`. Does nothing if that cast is not legal. */
  castSpell: (slot: number, hex: HexCoord) => void;
  /** Hacks `hex`. Does nothing if that hack is not possible right now. */
  hack: (hex: HexCoord, kind: HackKind) => void;
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
    injectableEnemyIds: combat.getInjectableEnemies().map((enemy) => enemy.id),
    hackTargets: combat.getHackTargets(),
    hand: combat.getHand(),
    passives: combat.deck.passives,
    terrainVersion: combat.terrainVersion,
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

    injectVirus: (enemyId) => {
      if (get().busy) return;
      publish(combat.injectVirus(enemyId));
    },

    castSpell: (slot, hex) => {
      if (get().busy) return;
      publish(combat.castSpell(slot, hex));
    },

    hack: (hex, kind) => {
      if (get().busy) return;
      publish(combat.hack(hex, kind));
    },

    endTurn: async () => {
      if (get().busy) return;
      // Outside the player turn this yields no events, and there is nothing to play out.
      if (!publish(combat.endPlayerTurn())) return;
      set({ busy: true });

      // The player's turrets fire first, one at a time.
      for (const turret of combat.getTurrets()) {
        await sleep(timing.enemyActionDelaySeconds);
        publish(combat.fireTurret(turret));
      }

      for (const enemyId of combat.getEnemyTurnOrder()) {
        // A turret or a trap can end the fight before every enemy has acted.
        if (combat.phase !== 'ENEMY_TURN') break;
        // A breached enemy loses its turn here, or recovers; give that its own beat.
        const turnStart = combat.startEnemyTurn(enemyId);
        if (turnStart.length > 0) {
          await sleep(timing.enemyActionDelaySeconds);
          publish(turnStart);
        }

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

/** Hexes the hand card in `slot` can be aimed at right now. Empty while busy or if it cannot be cast. */
export function spellTargets(slot: number): HexCoord[] {
  if (useCombatStore.getState().busy) return [];
  return combat.getSpellTargets(slot);
}

/** What casting the hand card in `slot` at `hex` would do, or null if that cast is not legal. */
export function previewSpell(slot: number, hex: HexCoord): SpellPreview | null {
  if (useCombatStore.getState().busy) return null;
  return combat.previewSpell(slot, hex);
}

/** What the player could do to `hex` in hack mode. Empty while busy or if it is not hackable. */
export function hackOptions(hex: HexCoord): HackOption[] {
  if (useCombatStore.getState().busy) return [];
  return combat.getHackOptions(hex);
}
