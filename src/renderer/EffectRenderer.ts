import { Container, Text } from 'pixi.js';
import type { CombatEvent } from '../core/combat/CombatManager';
import timing from '../core/data/timing.json';
import { hexToPixel, type HexCoord } from '../core/hex/HexCoord';

const COLOR = {
  damageToEnemy: 0xfde68a,
  damageToPlayer: 0xf87171,
  dodge: 0x7dd3fc,
  outline: 0x0b0f17,
} as const;

/** Where a popup starts relative to the hex center, and how far it floats up, in px. */
const START_OFFSET_Y = -30;
const RISE = 34;

interface Popup {
  text: Text;
  startY: number;
  elapsed: number;
}

/** Short-lived feedback drawn above the entities: floating damage numbers. */
export class EffectRenderer {
  readonly container = new Container();
  private popups: Popup[] = [];

  /** Turns combat events into their on-screen effects. */
  play(events: CombatEvent[], playerId: string): void {
    for (const event of events) {
      if (event.type !== 'attacked') continue;
      if (event.dodged) {
        this.spawnPopup(event.at, 'DODGE', COLOR.dodge);
      } else {
        const hitPlayer = event.targetId === playerId;
        this.spawnPopup(
          event.at,
          `-${event.damage}`,
          hitPlayer ? COLOR.damageToPlayer : COLOR.damageToEnemy,
        );
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
  }

  private spawnPopup(hex: HexCoord, label: string, color: number): void {
    const center = hexToPixel(hex);
    const text = new Text({
      text: label,
      style: {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: 22,
        fontWeight: '700',
        fill: color,
        stroke: { color: COLOR.outline, width: 4 },
      },
      // The world container is scaled up to fit the window; render sharp at that size.
      resolution: 2,
    });
    text.anchor.set(0.5);
    const startY = center.y + START_OFFSET_Y;
    text.position.set(center.x, startY);

    this.container.addChild(text);
    this.popups.push({ text, startY, elapsed: 0 });
  }
}
