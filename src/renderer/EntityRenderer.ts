import { Container, Graphics } from 'pixi.js';
import timing from '../core/data/timing.json';
import type { Enemy } from '../core/entities/Enemy';
import type { Entity } from '../core/entities/Entity';
import type { Player } from '../core/entities/Player';
import { hexToPixel } from '../core/hex/HexCoord';
import { TAG_COLOR } from '../theme';

const PLAYER_COLOR = 0x3b82f6;
const ENEMY_COLOR = 0xef4444;
const BORDER_COLOR = 0xffffff;
const ENEMY_BORDER = { width: 2, color: 0x7f1d1d } as const;

/** Half-extent of every placeholder shape, in px. */
const RADIUS = 24;

/** The status strip above an enemy: HP bar, then a row of firewall pips with the weakness dot. */
const HP_BAR = { width: 40, height: 5, top: -RADIUS - 15, back: 0x1e293b, fill: 0xef4444 } as const;
const PIP = { width: 7, height: 4, gap: 2, top: -RADIUS - 8, intact: 0x22d3ee, broken: 0x1e293b } as const;
const WEAKNESS_DOT_RADIUS = 2.5;
const BREACH_RING = { radius: RADIUS + 7, color: 0xffffff } as const;
const STUN_RING = { radius: RADIUS + 4, color: 0xfacc15 } as const;

type ShapeDrawer = (g: Graphics) => void;

/** Placeholder art per enemies.json id. Shapes are drawn around (0, 0). */
const ENEMY_SHAPES: Record<string, ShapeDrawer> = {
  crawler: (g) => {
    g.poly([0, -RADIUS, RADIUS * 0.9, RADIUS * 0.75, -RADIUS * 0.9, RADIUS * 0.75])
      .fill({ color: ENEMY_COLOR })
      .stroke(ENEMY_BORDER);
  },
  guardian: (g) => {
    const side = RADIUS * 1.5;
    g.rect(-side / 2, -side / 2, side, side).fill({ color: ENEMY_COLOR }).stroke(ENEMY_BORDER);
  },
  ghost_process: (g) => {
    g.poly([0, -RADIUS, RADIUS * 0.8, 0, 0, RADIUS, -RADIUS * 0.8, 0])
      .fill({ color: ENEMY_COLOR })
      .stroke(ENEMY_BORDER);
    g.alpha = 0.55;
  },
};

const drawUnknownEnemy: ShapeDrawer = (g) => {
  g.circle(0, 0, RADIUS * 0.7).fill({ color: ENEMY_COLOR }).stroke(ENEMY_BORDER);
};

const drawPlayer: ShapeDrawer = (g) => {
  g.circle(0, 0, RADIUS).fill({ color: PLAYER_COLOR }).stroke({ width: 3, color: BORDER_COLOR });
};

interface Tween {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  elapsed: number;
}

/** The parts of an enemy view that redraw when its numbers change. Absent for the player. */
interface EnemyStatus {
  strip: Graphics;
  breachRing: Graphics;
  stunRing: Graphics;
  flash: Graphics;
  /** What the strip currently shows, to skip redraws when nothing changed. */
  shown: string;
  /** Seconds into the breach flash, or null when not flashing. */
  flashElapsed: number | null;
}

interface EntityView {
  root: Container;
  status: EnemyStatus | null;
  /** Key of the hex this view is at, or travelling to. */
  hexKey: string;
  tween: Tween | null;
}

export class EntityRenderer {
  readonly container = new Container();
  private readonly views = new Map<string, EntityView>();

  /** Reconciles the drawn shapes with the entities: adds new, moves existing, removes gone. */
  sync(player: Player, enemies: Enemy[]): void {
    const alive = new Set<string>();

    this.place(player, alive);
    for (const enemy of enemies) {
      const view = this.place(enemy, alive);
      if (view.status) updateStatus(view.status, enemy);
    }

    for (const [id, view] of this.views) {
      if (alive.has(id)) continue;
      view.root.destroy({ children: true });
      this.views.delete(id);
    }
  }

  /** Drops every view, so the next sync places entities afresh instead of sliding them over. */
  reset(): void {
    for (const view of this.views.values()) view.root.destroy({ children: true });
    this.views.clear();
  }

  /** Flashes an enemy white, for the moment its firewall breaks. */
  flash(entityId: string): void {
    const status = this.views.get(entityId)?.status;
    if (status) status.flashElapsed = 0;
  }

  /** Advances movement tweens and flashes. Call once per frame. */
  update(deltaSeconds: number): void {
    for (const view of this.views.values()) {
      const tween = view.tween;
      if (tween) {
        tween.elapsed += deltaSeconds;
        const t = Math.min(tween.elapsed / timing.moveSecondsPerHex, 1);
        view.root.position.set(
          tween.fromX + (tween.toX - tween.fromX) * t,
          tween.fromY + (tween.toY - tween.fromY) * t,
        );
        if (t >= 1) view.tween = null;
      }

      const status = view.status;
      if (status && status.flashElapsed !== null) {
        status.flashElapsed += deltaSeconds;
        const t = Math.min(status.flashElapsed / timing.breachFlashSeconds, 1);
        status.flash.alpha = 0.9 * (1 - t);
        if (t >= 1) status.flashElapsed = null;
      }
    }
  }

  /** Creates the entity's view if needed and starts it moving toward the entity's hex. */
  private place(entity: Player | Enemy, alive: Set<string>): EntityView {
    alive.add(entity.id);
    const target = hexToPixel(entity.position);
    const hexKey = entity.position.key();

    let view = this.views.get(entity.id);
    if (!view) {
      view = this.createView(entity, hexKey);
      view.root.position.set(target.x, target.y);
      this.container.addChild(view.root);
      this.views.set(entity.id, view);
    } else if (view.hexKey !== hexKey) {
      // Start from wherever the shape is right now, so a step that arrives
      // a frame early never makes it jump.
      view.tween = {
        fromX: view.root.x,
        fromY: view.root.y,
        toX: target.x,
        toY: target.y,
        elapsed: 0,
      };
      view.hexKey = hexKey;
    }
    return view;
  }

  private createView(entity: Entity, hexKey: string): EntityView {
    const root = new Container();
    const shape = new Graphics();

    if (entity.kind === 'player') {
      drawPlayer(shape);
      root.addChild(shape);
      return { root, status: null, hexKey, tween: null };
    }

    (ENEMY_SHAPES[entity.typeId] ?? drawUnknownEnemy)(shape);

    const breachRing = new Graphics();
    breachRing.circle(0, 0, BREACH_RING.radius).stroke({ width: 2, color: BREACH_RING.color });
    breachRing.visible = false;

    const stunRing = new Graphics();
    stunRing.circle(0, 0, STUN_RING.radius).stroke({ width: 2, color: STUN_RING.color });
    stunRing.visible = false;

    const flash = new Graphics();
    flash.circle(0, 0, RADIUS + 2).fill({ color: 0xffffff });
    flash.alpha = 0;

    // Siblings of the shape, not children, so a translucent enemy keeps solid bars.
    const strip = new Graphics();
    root.addChild(breachRing, stunRing, shape, flash, strip);
    return {
      root,
      status: { strip, breachRing, stunRing, flash, shown: '', flashElapsed: null },
      hexKey,
      tween: null,
    };
  }
}

function updateStatus(status: EnemyStatus, enemy: Enemy): void {
  const showing = `${enemy.hp}/${enemy.firewallCurrent}/${enemy.breached}/${enemy.stunTurns}`;
  if (status.shown === showing) return;
  status.shown = showing;
  status.breachRing.visible = enemy.breached;
  status.stunRing.visible = enemy.stunTurns > 0;

  const g = status.strip.clear();

  g.rect(-HP_BAR.width / 2, HP_BAR.top, HP_BAR.width, HP_BAR.height).fill({ color: HP_BAR.back });
  const hpWidth = HP_BAR.width * (enemy.hp / enemy.maxHp);
  if (hpWidth > 0) {
    g.rect(-HP_BAR.width / 2, HP_BAR.top, hpWidth, HP_BAR.height).fill({ color: HP_BAR.fill });
  }

  const rowWidth = enemy.firewallMax * PIP.width + (enemy.firewallMax - 1) * PIP.gap;
  for (let index = 0; index < enemy.firewallMax; index++) {
    const x = -rowWidth / 2 + index * (PIP.width + PIP.gap);
    const intact = index < enemy.firewallCurrent;
    g.rect(x, PIP.top, PIP.width, PIP.height).fill({ color: intact ? PIP.intact : PIP.broken });
  }

  // The weakness: hit with this tag and the firewall loses two pips instead of one.
  g.circle(rowWidth / 2 + PIP.gap + WEAKNESS_DOT_RADIUS + 1, PIP.top + PIP.height / 2, WEAKNESS_DOT_RADIUS).fill({
    color: TAG_COLOR[enemy.weakness],
  });
}
