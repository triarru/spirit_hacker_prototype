import { Container, Graphics, Text } from 'pixi.js';
import type { SpellHitPreview, SpellPreview } from '../core/combat/CombatManager';
import { HEX_SIZE, type HexCoord } from '../core/hex/HexCoord';
import { bodyPoint, groundCorners } from './projection';

const COLOR = {
  area: 0xf97316,
  wall: 0x38bdf8,
  damage: 0xfde68a,
  callout: 0xffffff,
  heal: 0x4ade80,
  outline: 0x0b0f17,
} as const;

const INSET = 4;
/** Where a hit's label sits relative to the middle of the unit's body, in px: just above its status strip. */
const LABEL_OFFSET_Y = -52;
const HEAL_OFFSET_Y = -40;

/** One line saying what the spell would do to this enemy. */
function hitLabel(hit: SpellHitPreview): string {
  const parts: string[] = [];
  if (hit.damage > 0) parts.push(`-${hit.damage}`);
  if (hit.firewallDamage > 0) parts.push(`FW-${hit.firewallDamage}`);

  if (hit.kills) parts.push('KILL');
  else if (hit.breaches) parts.push('BREACH');
  if (hit.stunTurns > 0) parts.push('STUN');
  if (hit.slowTurns > 0) parts.push('SLOW');
  return parts.join(' ');
}

/** Shows what the spell being aimed would do if cast at the hovered hex. */
export class PreviewRenderer {
  /** The hexes the spell would touch, marked on the floor. Goes under the units. */
  readonly ground = new Graphics();
  /** What it would do to each of them, in words. Goes over the units. */
  readonly container = new Container();
  private labels: Text[] = [];

  /** `preview` is null when no spell is being aimed, or the hovered hex is not a valid target. */
  draw(preview: SpellPreview | null, playerAt: HexCoord): void {
    this.ground.clear();
    for (const label of this.labels) label.destroy();
    this.labels = [];
    if (!preview) return;

    const isWall = preview.walls.length > 0;
    for (const hex of preview.affected) {
      this.ground
        .poly(groundCorners(hex, HEX_SIZE - INSET))
        .fill({ color: isWall ? COLOR.wall : COLOR.area, alpha: 0.32 })
        .stroke({ width: 2.5, color: isWall ? COLOR.wall : COLOR.area });
    }

    for (const hit of preview.hits) {
      const text = hitLabel(hit);
      if (text) this.addLabel(hit.at, LABEL_OFFSET_Y, text, hit.kills || hit.breaches ? COLOR.callout : COLOR.damage);
    }
    if (preview.heal > 0) this.addLabel(playerAt, HEAL_OFFSET_Y, `+${preview.heal}`, COLOR.heal);
  }

  private addLabel(hex: HexCoord, offsetY: number, content: string, color: number): void {
    const center = bodyPoint(hex);
    const label = new Text({
      text: content,
      style: {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: 15,
        fontWeight: '700',
        fill: color,
        stroke: { color: COLOR.outline, width: 4 },
      },
      resolution: 2,
    });
    label.anchor.set(0.5, 1);
    label.position.set(center.x, center.y + offsetY);
    this.container.addChild(label);
    this.labels.push(label);
  }
}
