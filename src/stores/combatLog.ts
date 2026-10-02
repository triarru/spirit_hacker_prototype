import type { CombatEvent } from '../core/combat/CombatManager';
import { HACK_RULES, TRAP_ID, TURRET_ID, type HackKind } from '../core/combat/EnvironmentHack';

/** How a line should be colored: who it is good or bad for. */
export type LogTone = 'neutral' | 'player' | 'good' | 'bad' | 'system';

export interface LogLine {
  tone: LogTone;
  text: string;
}

export interface LogContext {
  playerId: string;
  /** Display name for an entity id. Must keep working for enemies that have since died. */
  nameOf: (id: string) => string;
  /** The turn number after these events were applied. */
  turn: number;
}

const HACK_TEXT: Record<HackKind, string> = {
  TURRET: `Terminal hacked → Turret deployed (${HACK_RULES.turret.turns} turns)`,
  TRAP: 'Floor hacked → Trap set',
  WALL: `Floor hacked → Wall raised (${HACK_RULES.wall.turns} turns)`,
  BREAK_WALL: 'Wall hacked → Wall broken',
};

type AttackedEvent = Extract<CombatEvent, { type: 'attacked' }>;

const turns = (count: number): string => `${count} turn${count === 1 ? '' : 's'}`;

/** "Crawler takes 12 damage", with a note when a breach multiplied it. */
function damageTaken(event: AttackedEvent, { nameOf }: LogContext): string {
  return `${nameOf(event.targetId)} takes ${event.damage} damage${event.amplified ? ' (breached x1.5)' : ''}`;
}

function describeAttack(event: AttackedEvent, context: LogContext): LogLine {
  const { playerId, nameOf } = context;
  const source =
    event.attackerId === TURRET_ID ? 'Turret' : event.attackerId === TRAP_ID ? 'Trap' : nameOf(event.attackerId);

  if (event.targetId === playerId) {
    return event.dodged
      ? { tone: 'good', text: `${nameOf(playerId)} dodges ${source}'s attack` }
      : { tone: 'bad', text: `${source} hits → ${damageTaken(event, context)}` };
  }
  const verb = event.attackerId === playerId ? 'attacks' : 'hits';
  return { tone: 'player', text: `${source} ${verb} → ${damageTaken(event, context)}` };
}

/**
 * Turns one batch of combat events into log lines. A batch is what one action
 * produced, which is what lets a cast and the damage it did share a line.
 */
export function describeEvents(events: readonly CombatEvent[], context: LogContext): LogLine[] {
  const { playerId, nameOf, turn } = context;
  const lines: LogLine[] = [];
  /** The line of the spell cast in this batch; the player's hits that follow are folded into it. */
  let castLine: LogLine | null = null;
  let castHits = 0;
  /** Enemies a trap went off under in this batch. */
  const trapped = new Set(
    events.flatMap((event) => (event.type === 'trapTriggered' ? [event.entityId] : [])),
  );

  for (const event of events) {
    switch (event.type) {
      case 'spellCast':
        castLine = { tone: 'player', text: `${nameOf(playerId)} cast ${event.programName}` };
        castHits = 0;
        lines.push(castLine);
        break;

      case 'attacked':
        // A trap's damage is reported on the line that announces the trap.
        if (event.attackerId === TRAP_ID && trapped.has(event.targetId)) break;
        if (castLine && event.attackerId === playerId) {
          castLine.text += `${castHits === 0 ? ' → ' : ', '}${damageTaken(event, context)}`;
          castHits += 1;
        } else {
          lines.push(describeAttack(event, context));
        }
        break;

      case 'defended':
        if (event.kind === 'dodge') lines.push({ tone: 'good', text: 'Perfect Dodge!' });
        else if (event.grade === 'good') lines.push({ tone: 'good', text: 'Parry! Damage halved' });
        else lines.push({ tone: 'good', text: `Perfect Parry! +${event.apBanked} AP` });
        break;

      case 'breached':
        lines.push({ tone: 'good', text: `${nameOf(event.entityId)} FIREWALL BREACHED!` });
        break;
      case 'recovered':
        lines.push({ tone: 'neutral', text: `${nameOf(event.entityId)} restores its firewall` });
        break;
      case 'turnSkipped':
        lines.push({ tone: 'neutral', text: `${nameOf(event.entityId)} loses its turn (${event.reason})` });
        break;
      case 'virusInjected':
        lines.push({
          tone: 'player',
          text: `Virus injected → ${nameOf(event.entityId)} turns on ${nameOf(event.targetId)}`,
        });
        break;
      case 'stunned':
        lines.push({ tone: 'good', text: `${nameOf(event.entityId)} is stunned (${turns(event.turns)})` });
        break;
      case 'slowed':
        lines.push({ tone: 'good', text: `${nameOf(event.entityId)} is slowed (${turns(event.turns)})` });
        break;
      case 'healed':
        lines.push({ tone: 'good', text: `${nameOf(event.entityId)} recovers ${event.amount} HP` });
        break;
      case 'regenerated':
        if (event.ram > 0) lines.push({ tone: 'neutral', text: `RAM +${event.ram} (regen)` });
        if (event.qi > 0) lines.push({ tone: 'neutral', text: `Qi +${event.qi} (regen)` });
        break;
      case 'hacked':
        lines.push({ tone: 'player', text: HACK_TEXT[event.kind] });
        break;
      case 'turretExpired':
        lines.push({ tone: 'neutral', text: 'Turret shut down' });
        break;
      case 'trapTriggered': {
        const hit = events.find(
          (other): other is AttackedEvent =>
            other.type === 'attacked' && other.attackerId === TRAP_ID && other.targetId === event.entityId,
        );
        const survived = !events.some((other) => other.type === 'died' && other.entityId === event.entityId);
        lines.push({
          tone: 'good',
          text:
            `${nameOf(event.entityId)} triggers trap!` +
            (hit ? ` ${hit.damage} damage.` : '') +
            (survived ? ' Movement interrupted.' : ''),
        });
        break;
      }
      case 'died':
        lines.push(
          event.entityId === playerId
            ? { tone: 'bad', text: `${nameOf(playerId)} is down` }
            : { tone: 'good', text: `${nameOf(event.entityId)} destroyed` },
        );
        break;

      case 'phaseChanged':
        if (event.phase === 'PLAYER_TURN') lines.push({ tone: 'system', text: `— Turn ${turn} —` });
        else if (event.phase === 'ENEMY_TURN') lines.push({ tone: 'system', text: '— Enemy turn —' });
        else if (event.phase === 'VICTORY') lines.push({ tone: 'system', text: 'CLEARED' });
        else if (event.phase === 'DEFEAT') lines.push({ tone: 'system', text: 'SYSTEM FORMATTED' });
        break;

      // Shown on the grid itself; a line each would only be noise.
      case 'moved':
      case 'turretFired':
      case 'terrainChanged':
        break;
    }
  }
  return lines;
}
