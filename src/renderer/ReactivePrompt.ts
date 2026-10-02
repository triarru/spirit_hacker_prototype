import { Container, Graphics, Text } from 'pixi.js';
import {
  DIRECTION_VECTORS,
  gradeTiming,
  isAttempt,
  type DefenseGrade,
  type DodgePrompt,
  type ParryPrompt,
  type ReactiveDefense,
} from '../core/combat/ReactiveDefense';
import { hexToPixel, type HexCoord, type Point } from '../core/hex/HexCoord';

const COLOR = {
  perfect: 0x4ade80,
  good: 0xfacc15,
  miss: 0xf8fafc,
  shot: 0xf97316,
  outline: 0x0b0f17,
} as const;

const GRADE_COLOR: Record<DefenseGrade, number> = {
  perfect: COLOR.perfect,
  good: COLOR.good,
  miss: COLOR.miss,
};

/** Parry rings, in px: the fixed target ring, and where the shrinking ring starts. */
const TARGET_RADIUS = 30;
const START_RADIUS = 92;
/** How far short of the player's center the incoming shot stops, in px. */
const SHOT_GAP = 32;
/** The dodge arrow: where it starts and ends, measured from the player's center, in px. */
const DODGE_ARROW = { from: 34, to: 88, head: 18 } as const;
const LABEL_OFFSET_Y = 46;

/** The dodge beat: a disc on the player that swells and brightens toward the moment to press, in px. */
const BEAT_RADIUS = { from: 12, to: 34 } as const;
/** How faint the prompt is drawn while an input would still be too early to count. */
const NOT_YET_ALPHA = 0.45;

const LABELS = {
  parry: 'PARRY · Space / Click',
  dodge: 'DODGE · press the arrow as the shot lands',
} as const;

/** Draws the reactive-defense prompt. Redrawn every frame from the live session. */
export class ReactivePromptRenderer {
  readonly container = new Container();
  private readonly shapes = new Graphics();
  private readonly label: Text;

  constructor() {
    this.label = new Text({
      text: '',
      style: {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: 13,
        fontWeight: '700',
        fill: COLOR.miss,
        stroke: { color: COLOR.outline, width: 4 },
      },
      resolution: 2,
    });
    this.label.anchor.set(0.5, 0);
    this.container.addChild(this.shapes, this.label);
    this.container.visible = false;
  }

  /** `session` is the prompt in progress, or null when there is none. */
  draw(session: ReactiveDefense | null, playerAt: HexCoord): void {
    // Once decided, the prompt is gone; the result is shown as a popup instead.
    if (!session || session.result) {
      this.container.visible = false;
      return;
    }

    this.container.visible = true;
    this.shapes.clear();
    const center = hexToPixel(playerAt);
    const { prompt } = session;

    if (prompt.kind === 'parry') {
      this.drawParry(prompt, session.elapsedSeconds, center);
    } else {
      this.drawDodge(prompt, session.elapsedSeconds, center);
    }

    // The label normally sits below the player; a dodge arrow pointing down needs that space.
    const above = prompt.kind === 'dodge' && prompt.answer === 'down';
    this.label.text = LABELS[prompt.kind];
    this.label.anchor.set(0.5, above ? 1 : 0);
    this.label.position.set(center.x, center.y + (above ? -LABEL_OFFSET_Y : LABEL_OFFSET_Y));
  }

  private drawParry(prompt: ParryPrompt, elapsed: number, center: Point): void {
    const g = this.shapes;
    // The ring closes at a constant speed and meets the target exactly at perfectAtSeconds,
    // so a time window maps to a band of that width around the target ring.
    const speed = (START_RADIUS - TARGET_RADIUS) / prompt.perfectAtSeconds;

    g.circle(center.x, center.y, TARGET_RADIUS).stroke({
      width: prompt.goodToleranceSeconds * 2 * speed,
      color: COLOR.good,
      alpha: 0.16,
    });
    g.circle(center.x, center.y, TARGET_RADIUS).stroke({
      width: prompt.perfectToleranceSeconds * 2 * speed,
      color: COLOR.perfect,
      alpha: 0.4,
    });

    const radius = Math.max(TARGET_RADIUS + (prompt.perfectAtSeconds - elapsed) * speed, 4);
    g.circle(center.x, center.y, radius).stroke({
      width: 3,
      // Shows what pressing right now would score; faint while a press would not count yet.
      color: GRADE_COLOR[gradeTiming(prompt, elapsed)],
      alpha: isAttempt(prompt, elapsed) ? 1 : NOT_YET_ALPHA,
    });
  }

  private drawDodge(prompt: DodgePrompt, elapsed: number, center: Point): void {
    const g = this.shapes;

    // The incoming shot, kept faint: it is the timer, not the instruction.
    const from = hexToPixel(prompt.from);
    const length = Math.hypot(center.x - from.x, center.y - from.y);
    if (length > 0) {
      const unitX = (center.x - from.x) / length;
      const unitY = (center.y - from.y) / length;
      const impact = { x: center.x - unitX * SHOT_GAP, y: center.y - unitY * SHOT_GAP };
      g.moveTo(from.x, from.y)
        .lineTo(impact.x, impact.y)
        .stroke({ width: 2, color: COLOR.shot, alpha: 0.35, cap: 'round' });

      // The projectile lands exactly on the beat: the moment to press.
      const progress = Math.min(elapsed / prompt.perfectAtSeconds, 1);
      g.circle(from.x + (impact.x - from.x) * progress, from.y + (impact.y - from.y) * progress, 6)
        .fill({ color: COLOR.miss })
        .stroke({ width: 2, color: COLOR.shot });
    }

    // The beat: dim and small while the arrow is being read, brightest at the moment to press.
    const closeness = Math.max(0, 1 - Math.abs(elapsed - prompt.perfectAtSeconds) / prompt.judgeToleranceSeconds);
    g.circle(center.x, center.y, BEAT_RADIUS.from + (BEAT_RADIUS.to - BEAT_RADIUS.from) * closeness).fill({
      color: GRADE_COLOR[gradeTiming(prompt, elapsed)],
      alpha: 0.12 + 0.5 * closeness,
    });

    // The instruction: an arrow from the player pointing the way to dodge, which is the key to press.
    const [dirX, dirY] = DIRECTION_VECTORS[prompt.answer];
    const tail = { x: center.x + dirX * DODGE_ARROW.from, y: center.y + dirY * DODGE_ARROW.from };
    const tip = { x: center.x + dirX * DODGE_ARROW.to, y: center.y + dirY * DODGE_ARROW.to };
    const neck = { x: tip.x - dirX * DODGE_ARROW.head, y: tip.y - dirY * DODGE_ARROW.head };
    const half = DODGE_ARROW.head * 0.7;

    g.moveTo(tail.x, tail.y)
      .lineTo(neck.x, neck.y)
      .stroke({ width: 7, color: COLOR.perfect, cap: 'round' });
    g.poly([
      tip.x,
      tip.y,
      neck.x - dirY * half,
      neck.y + dirX * half,
      neck.x + dirY * half,
      neck.y - dirX * half,
    ]).fill({ color: COLOR.perfect });
  }
}
