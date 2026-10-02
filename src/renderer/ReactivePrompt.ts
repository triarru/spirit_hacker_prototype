import { Container, Graphics, Text } from 'pixi.js';
import {
  gradeParry,
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
/** How far short of the player's center the shot's arrow stops, in px. */
const ARROW_GAP = 32;
const ARROW_HEAD = 12;
const LABEL_OFFSET_Y = 46;

const LABELS = {
  parry: 'PARRY · Space / Click',
  dodge: 'DODGE · Arrow / WASD against the shot',
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

    this.label.text = LABELS[prompt.kind];
    this.label.position.set(center.x, center.y + LABEL_OFFSET_Y);
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
      width: prompt.perfectWindowSeconds * speed,
      color: COLOR.perfect,
      alpha: 0.4,
    });

    const radius = Math.max(TARGET_RADIUS + (prompt.perfectAtSeconds - elapsed) * speed, 4);
    g.circle(center.x, center.y, radius).stroke({
      width: 3,
      // Shows what pressing right now would score.
      color: GRADE_COLOR[gradeParry(prompt, elapsed)],
    });
  }

  private drawDodge(prompt: DodgePrompt, elapsed: number, center: Point): void {
    const g = this.shapes;
    const from = hexToPixel(prompt.from);
    const length = Math.hypot(center.x - from.x, center.y - from.y);
    if (length === 0) return;

    const unitX = (center.x - from.x) / length;
    const unitY = (center.y - from.y) / length;
    const tip = { x: center.x - unitX * ARROW_GAP, y: center.y - unitY * ARROW_GAP };

    g.moveTo(from.x, from.y)
      .lineTo(tip.x, tip.y)
      .stroke({ width: 3, color: COLOR.shot, alpha: 0.55, cap: 'round' });

    // Arrowhead: the tip, and two corners set back along and to either side of the line.
    const backX = tip.x - unitX * ARROW_HEAD;
    const backY = tip.y - unitY * ARROW_HEAD;
    const half = ARROW_HEAD * 0.6;
    g.poly([
      tip.x,
      tip.y,
      backX - unitY * half,
      backY + unitX * half,
      backX + unitY * half,
      backY - unitX * half,
    ]).fill({ color: COLOR.shot });

    // The projectile reaches the arrow tip exactly when the time to react runs out.
    const progress = Math.min(elapsed / prompt.durationSeconds, 1);
    g.circle(from.x + (tip.x - from.x) * progress, from.y + (tip.y - from.y) * progress, 7)
      .fill({ color: COLOR.miss })
      .stroke({ width: 2, color: COLOR.shot });
  }
}
