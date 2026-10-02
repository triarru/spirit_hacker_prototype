import { Container, Graphics } from 'pixi.js';
import timing from '../core/data/timing.json';
import type { Enemy } from '../core/entities/Enemy';
import type { Entity } from '../core/entities/Entity';
import type { Player } from '../core/entities/Player';
import { TAG_COLOR } from '../theme';
import { BODY_LIFT, groundPoint, TILT } from './projection';

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
/** Status rings lie flat on the floor around a unit's feet, so the tilted camera sees them as ellipses. */
const BREACH_RING = { radius: RADIUS + 7, color: 0xffffff } as const;
const STUN_RING = { radius: RADIUS + 4, color: 0xfacc15 } as const;
/** An enemy about to strike swells and is ringed, in step with the pulse. */
const WIND_UP = { radius: RADIUS + 10, color: 0xf97316, swell: 0.18 } as const;
/** The shadow a unit casts on the floor under it. */
const SHADOW = { radius: RADIUS * 0.85, color: 0x000000, alpha: 0.45 } as const;

/** A ring of `radius` lying on the floor around (0, 0). */
function floorRing(radius: number, width: number, color: number): Graphics {
  return new Graphics().ellipse(0, 0, radius, radius * TILT).stroke({ width, color });
}

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
  shape: Graphics;
  breachRing: Graphics;
  stunRing: Graphics;
  windUpRing: Graphics;
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

/**
 * Draws the units upright on the board: each one a body floating a little above
 * a shadow at its feet. They live in a layer shared with the walls and sorted
 * by depth, so whatever stands nearer the camera hides what is behind it.
 */
export class EntityRenderer {
  private readonly layer: Container;
  private readonly views = new Map<string, EntityView>();
  /** The enemy winding up for an attack, and how long it has been at it. */
  private windingUp: { entityId: string; elapsed: number } | null = null;

  /** `layer` is depth-sorted by `zIndex`; the walls live in it too. */
  constructor(layer: Container) {
    this.layer = layer;
  }

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

  /** Marks the enemy that is about to strike, or none. Safe to call every frame. */
  setWindingUp(entityId: string | null): void {
    if (entityId === (this.windingUp?.entityId ?? null)) return;
    this.windingUp = entityId === null ? null : { entityId, elapsed: 0 };
  }

  /** Advances movement tweens, flashes and the wind-up pulse. Call once per frame. */
  update(deltaSeconds: number): void {
    if (this.windingUp) this.windingUp.elapsed += deltaSeconds;

    for (const [entityId, view] of this.views) {
      const tween = view.tween;
      if (tween) {
        tween.elapsed += deltaSeconds;
        const t = Math.min(tween.elapsed / timing.moveSecondsPerHex, 1);
        view.root.position.set(
          tween.fromX + (tween.toX - tween.fromX) * t,
          tween.fromY + (tween.toY - tween.fromY) * t,
        );
        // Its depth changes as it walks: nearer the camera is lower on screen.
        view.root.zIndex = view.root.y;
        if (t >= 1) view.tween = null;
      }

      const status = view.status;
      if (status && status.flashElapsed !== null) {
        status.flashElapsed += deltaSeconds;
        const t = Math.min(status.flashElapsed / timing.breachFlashSeconds, 1);
        status.flash.alpha = 0.9 * (1 - t);
        if (t >= 1) status.flashElapsed = null;
      }

      if (status) {
        // One swell per pulse: out and back, so it reads as a wind-up rather than a growth.
        const pulse =
          this.windingUp?.entityId === entityId
            ? Math.abs(Math.sin((this.windingUp.elapsed / timing.windUpPulseSeconds) * Math.PI))
            : 0;
        status.shape.scale.set(1 + WIND_UP.swell * pulse);
        status.windUpRing.visible = this.windingUp?.entityId === entityId;
        status.windUpRing.alpha = 0.35 + 0.65 * pulse;
      }
    }
  }

  /** Creates the entity's view if needed and starts it moving toward the entity's hex. */
  private place(entity: Player | Enemy, alive: Set<string>): EntityView {
    alive.add(entity.id);
    const target = groundPoint(entity.position);
    const hexKey = entity.position.key();

    let view = this.views.get(entity.id);
    if (!view) {
      view = this.createView(entity, hexKey);
      view.root.position.set(target.x, target.y);
      view.root.zIndex = target.y;
      this.layer.addChild(view.root);
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
    // The root sits at the unit's feet. The body and what belongs to it are lifted above that.
    const root = new Container();
    const shadow = new Graphics()
      .ellipse(0, 0, SHADOW.radius, SHADOW.radius * TILT)
      .fill({ color: SHADOW.color, alpha: SHADOW.alpha });
    const shape = new Graphics();
    shape.position.y = -BODY_LIFT;

    if (entity.kind === 'player') {
      drawPlayer(shape);
      root.addChild(shadow, shape);
      return { root, status: null, hexKey, tween: null };
    }

    (ENEMY_SHAPES[entity.typeId] ?? drawUnknownEnemy)(shape);

    const breachRing = floorRing(BREACH_RING.radius, 2, BREACH_RING.color);
    breachRing.visible = false;

    const stunRing = floorRing(STUN_RING.radius, 2, STUN_RING.color);
    stunRing.visible = false;

    const windUpRing = floorRing(WIND_UP.radius, 3, WIND_UP.color);
    windUpRing.visible = false;

    const flash = new Graphics();
    flash.circle(0, 0, RADIUS + 2).fill({ color: 0xffffff });
    flash.position.y = -BODY_LIFT;
    flash.alpha = 0;

    // Siblings of the shape, not children, so a translucent enemy keeps solid bars.
    const strip = new Graphics();
    strip.position.y = -BODY_LIFT;
    root.addChild(shadow, breachRing, stunRing, windUpRing, shape, flash, strip);
    return {
      root,
      status: { strip, shape, breachRing, stunRing, windUpRing, flash, shown: '', flashElapsed: null },
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
