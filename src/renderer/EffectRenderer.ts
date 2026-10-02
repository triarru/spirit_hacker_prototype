import { Container, Graphics, Text } from 'pixi.js';
import type { CombatEvent } from '../core/combat/CombatManager';
import type { HackKind } from '../core/combat/EnvironmentHack';
import timing from '../core/data/timing.json';
import { hexToPixel, type HexCoord } from '../core/hex/HexCoord';

const COLOR = {
  damageToEnemy: 0xfde68a,
  damageToPlayer: 0xf87171,
  dodge: 0x7dd3fc,
  perfect: 0x4ade80,
  good: 0xfacc15,
  amplified: 0xfb923c,
  breach: 0xffffff,
  virus: 0xc084fc,
  muted: 0x94a3b8,
  hack: 0x22d3ee,
  trap: 0xfacc15,
  outline: 0x0b0f17,
} as const;

const HACK_LABEL: Record<HackKind, string> = {
  TURRET: 'TURRET ONLINE',
  TRAP: 'TRAP SET',
  WALL: 'WALL UP',
  BREAK_WALL: 'WALL DOWN',
};

/** How long a turret's shot stays on screen, in seconds. */
const BEAM_SECONDS = 0.3;

/** Where a popup starts relative to the hex center, and how far it floats up, in px. */
const START_OFFSET_Y = -30;
const RISE = 34;
/** Vertical spacing between popups that appear on the same hex at the same moment, in px. */
const STACK_SPACING = 24;

const DAMAGE_FONT_SIZE = 22;
/** Damage multiplied by a breach reads bigger. */
const AMPLIFIED_FONT_SIZE = 28;
const CALLOUT_FONT_SIZE = 15;

interface Popup {
  text: Text;
  startY: number;
  elapsed: number;
}

interface Beam {
  line: Graphics;
  elapsed: number;
}

type DefendedEvent = Extract<CombatEvent, { type: 'defended' }>;

const MISS_LABEL = { early: 'TOO EARLY', late: 'TOO LATE', wrong_way: 'WRONG WAY' } as const;

function defendedLabel(event: DefendedEvent): string {
  if (event.kind === 'dodge') return event.grade === 'good' ? 'DODGE' : 'PERFECT DODGE';
  if (event.grade === 'good') return 'PARRY';
  return event.apBanked > 0 ? `PERFECT PARRY  +${event.apBanked} AP` : 'PERFECT PARRY';
}

/** Short-lived feedback drawn above the entities: floating damage numbers and callouts. */
export class EffectRenderer {
  readonly container = new Container();
  private popups: Popup[] = [];
  private beams: Beam[] = [];

  /** Turns combat events into their on-screen effects. */
  play(events: CombatEvent[], playerId: string): void {
    // Several events can land on one hex at once (a parry and the damage that
    // got through); stack their popups instead of drawing them on top of each other.
    const stacked = new Map<string, number>();
    const spawn = (hex: HexCoord, label: string, color: number, fontSize: number): void => {
      const level = stacked.get(hex.key()) ?? 0;
      stacked.set(hex.key(), level + 1);
      this.spawnPopup(hex, label, color, fontSize, level);
    };

    for (const event of events) {
      switch (event.type) {
        case 'defended': {
          const color = event.grade === 'perfect' ? COLOR.perfect : COLOR.good;
          spawn(event.at, defendedLabel(event), color, CALLOUT_FONT_SIZE);
          break;
        }
        case 'defenseMissed':
          spawn(event.at, MISS_LABEL[event.reason], COLOR.muted, CALLOUT_FONT_SIZE);
          break;
        case 'attacked':
          if (event.dodged) {
            spawn(event.at, 'DODGE', COLOR.dodge, DAMAGE_FONT_SIZE);
          } else if (event.amplified) {
            spawn(event.at, `-${event.damage}`, COLOR.amplified, AMPLIFIED_FONT_SIZE);
          } else {
            const color = event.targetId === playerId ? COLOR.damageToPlayer : COLOR.damageToEnemy;
            spawn(event.at, `-${event.damage}`, color, DAMAGE_FONT_SIZE);
          }
          break;
        case 'breached':
          spawn(event.at, 'BREACHED!', COLOR.breach, CALLOUT_FONT_SIZE);
          break;
        case 'turnSkipped':
          spawn(event.at, 'SKIPS TURN', COLOR.muted, CALLOUT_FONT_SIZE);
          break;
        case 'stunned':
          spawn(event.at, 'STUNNED', COLOR.good, CALLOUT_FONT_SIZE);
          break;
        case 'healed':
          spawn(event.at, `+${event.amount}`, COLOR.perfect, DAMAGE_FONT_SIZE);
          break;
        case 'hacked':
          spawn(event.at, HACK_LABEL[event.kind], COLOR.hack, CALLOUT_FONT_SIZE);
          break;
        case 'turretFired':
          this.spawnBeam(event.at, event.targetAt);
          break;
        case 'turretExpired':
          spawn(event.at, 'TURRET OFFLINE', COLOR.muted, CALLOUT_FONT_SIZE);
          break;
        case 'wallBroken':
          spawn(event.at, 'WALL DOWN', COLOR.damageToPlayer, CALLOUT_FONT_SIZE);
          break;
        case 'trapTriggered':
          spawn(event.at, 'TRAP!', COLOR.trap, CALLOUT_FONT_SIZE);
          break;
        case 'slowed':
          spawn(event.at, 'SLOWED', COLOR.trap, CALLOUT_FONT_SIZE);
          break;
        case 'stanceShifted':
          if (event.stance === 'wary') spawn(event.at, 'ALERT', COLOR.good, CALLOUT_FONT_SIZE);
          if (event.stance === 'aggressive') {
            spawn(event.at, 'BREAKS POSITION!', COLOR.damageToPlayer, CALLOUT_FONT_SIZE);
          }
          break;
        case 'recovered':
          spawn(event.at, 'FIREWALL RESTORED', COLOR.muted, CALLOUT_FONT_SIZE);
          break;
        case 'virusInjected':
          spawn(event.at, 'VIRUS INJECTED', COLOR.virus, CALLOUT_FONT_SIZE);
          break;
        default:
          break;
      }
    }
  }

  /** Advances every popup: float up, fade out, then remove. Call once per frame. */
  update(deltaSeconds: number): void {
    for (const popup of this.popups) {
      popup.elapsed += deltaSeconds;
      const t = Math.min(popup.elapsed / timing.damagePopupSeconds, 1);
      popup.text.y = popup.startY - RISE * t;
      // Hold full opacity for the first half so the number is readable, then fade.
      popup.text.alpha = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
    }

    const finished = this.popups.filter((popup) => popup.elapsed >= timing.damagePopupSeconds);
    for (const popup of finished) popup.text.destroy();
    if (finished.length > 0) {
      this.popups = this.popups.filter((popup) => popup.elapsed < timing.damagePopupSeconds);
    }

    for (const beam of this.beams) {
      beam.elapsed += deltaSeconds;
      beam.line.alpha = Math.max(0, 1 - beam.elapsed / BEAM_SECONDS);
    }
    const spent = this.beams.filter((beam) => beam.elapsed >= BEAM_SECONDS);
    for (const beam of spent) beam.line.destroy();
    if (spent.length > 0) this.beams = this.beams.filter((beam) => beam.elapsed < BEAM_SECONDS);
  }

  /** A turret's shot: a line from the turret to its target that fades out. */
  private spawnBeam(from: HexCoord, to: HexCoord): void {
    const start = hexToPixel(from);
    const end = hexToPixel(to);
    const line = new Graphics()
      .moveTo(start.x, start.y)
      .lineTo(end.x, end.y)
      .stroke({ width: 3, color: COLOR.hack, cap: 'round' });
    this.container.addChild(line);
    this.beams.push({ line, elapsed: 0 });
  }

  private spawnPopup(
    hex: HexCoord,
    label: string,
    color: number,
    fontSize: number,
    stackLevel: number,
  ): void {
    const center = hexToPixel(hex);
    const text = new Text({
      text: label,
      style: {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize,
        fontWeight: '700',
        fill: color,
        stroke: { color: COLOR.outline, width: 4 },
      },
      // The world container is scaled up to fit the window; render sharp at that size.
      resolution: 2,
    });
    text.anchor.set(0.5);
    const startY = center.y + START_OFFSET_Y - STACK_SPACING * stackLevel;
    text.position.set(center.x, startY);

    this.container.addChild(text);
    this.popups.push({ text, startY, elapsed: 0 });
  }
}
