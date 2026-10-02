import { create } from 'zustand';
import {
  CombatManager,
  type CombatEvent,
  type CombatPhase,
  type HackOption,
  type HandCard,
  type SpellPreview,
} from '../core/combat/CombatManager';
import { TRAP_ID, TURRET_ID, type HackKind } from '../core/combat/EnvironmentHack';
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
import {
  assignSlot,
  buildDeck,
  createEmptyDeck,
  loadoutProblems,
  starterSelection,
  type LoadoutSelection,
  type LoadoutSlot,
} from '../core/programs/SpellDeck';
import { describeEvents, type LogLine } from './combatLog';
import { runReactivePrompt } from './reactiveLoop';

const ROOM_ID = 'prototype_room';
/** The log keeps this many lines; older ones are dropped. */
const LOG_LIMIT = 200;

/** A fresh fight, waiting on the loadout screen for the player to choose a deck. */
const newCombat = (): CombatManager =>
  new CombatManager(loadRoom(ROOM_ID), Math.random, createEmptyDeck(), 'LOADOUT');

/** Display names by entity id, taken at the start so they outlive enemies that die. */
const namesOf = (fight: CombatManager): Map<string, string> =>
  new Map([
    [TURRET_ID, 'Turret'],
    [TRAP_ID, 'Trap'],
    ...[fight.player, ...fight.enemies].map((entity): [string, string] => [entity.id, entity.name]),
  ]);

/**
 * The live game. Core logic mutates it in place; nothing outside this module
 * reads it directly — everyone else sees the snapshots published below.
 * Replaced wholesale on restart.
 */
let combat = newCombat();
let names = namesOf(combat);

/** A line of the combat log. `id` is stable, for use as a list key. */
export interface LogEntry extends LogLine {
  id: number;
}

let nextLogId = 0;
const toEntries = (lines: LogLine[]): LogEntry[] =>
  lines.map((line) => ({ ...line, id: nextLogId++ }));

/** Log lines for a batch of events from the live game. */
const logFor = (events: CombatEvent[]): LogEntry[] =>
  toEntries(
    describeEvents(events, {
      playerId: combat.player.id,
      nameOf: (id) => names.get(id) ?? id,
      turn: combat.turn,
    }),
  );

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
  /** The enemy announcing an attack the player will get to react to, from just before its prompt until it lands. */
  windingUp: string | null;
  /** What the most recent change consisted of. Replaced, never appended to. */
  lastEvents: CombatEvent[];
  /** Everything that has happened this fight, oldest first. */
  log: LogEntry[];
  /** The programs chosen on the loadout screen. Kept across restarts. */
  loadout: LoadoutSelection;
  /** Puts a program in a loadout slot (null empties it). Only on the loadout screen. */
  setLoadoutSlot: (slot: LoadoutSlot, programId: string | null) => void;
  /** Leaves the loadout screen and starts the fight with the chosen programs. */
  startCombat: () => void;
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
  /** Goes back to the loadout screen for a new fight. Only once this one has ended. */
  restart: () => void;
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
    set({
      ...snapshot(),
      lastEvents: events,
      log: [...get().log, ...logFor(events)].slice(-LOG_LIMIT),
    });
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
    windingUp: null,
    lastEvents: [],
    log: [],
    loadout: starterSelection(),

    setLoadoutSlot: (slot, programId) => {
      if (get().phase !== 'LOADOUT') return;
      set({ loadout: assignSlot(get().loadout, slot, programId) });
    },

    startCombat: () => {
      const { loadout } = get();
      if (loadoutProblems(loadout).length > 0) return;
      publish(combat.startCombat(buildDeck(loadout)));
    },

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
          // A trap stops its movement, and an attack needs the player in reach: skip what is off.
          if (combat.isCancelled(enemyId, action)) continue;
          // An attack the player can react to is announced: the attacker winds up through the pause.
          if (combat.getDefensePrompt(enemyId, action)) set({ windingUp: enemyId });
          await sleep(timing.enemyActionDelaySeconds);
          // Then it waits here for their parry or dodge.
          const prompt = combat.getDefensePrompt(enemyId, action);
          const defense = prompt ? await promptDefense(prompt) : null;
          set({ windingUp: null });
          publish(combat.applyEnemyAction(enemyId, action, defense));
        }
        // A killing blow ends the fight on the spot; nobody else gets to act.
        if (combat.phase !== 'ENEMY_TURN') break;
      }

      await sleep(timing.enemyActionDelaySeconds);
      publish(combat.endEnemyPhase());
      set({ busy: false });
    },

    restart: () => {
      // Mid-fight an enemy turn may still be playing out against the current game.
      const { busy, phase } = get();
      if (busy || (phase !== 'VICTORY' && phase !== 'DEFEAT')) return;

      combat = newCombat();
      names = namesOf(combat);
      set({ ...snapshot(), reactive: null, windingUp: null, lastEvents: [], log: [] });
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
