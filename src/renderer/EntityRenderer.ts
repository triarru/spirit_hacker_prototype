import { Container, Graphics } from 'pixi.js';
import timing from '../core/data/timing.json';
import type { Entity } from '../core/entities/Entity';
import { hexToPixel } from '../core/hex/HexCoord';

const PLAYER_COLOR = 0x3b82f6;
const ENEMY_COLOR = 0xef4444;
const BORDER_COLOR = 0xffffff;
const ENEMY_BORDER = { width: 2, color: 0x7f1d1d } as const;

/** Half-extent of every placeholder shape, in px. */
const RADIUS = 24;

const HP_BAR = { width: 40, height: 5, offsetY: -RADIUS - 11, back: 0x1e293b, fill: 0xef4444 } as const;

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

interface EntityView {
  root: Container;
  /** Enemies only; the player's HP lives in the HUD. */
  hpBar: Graphics | null;
  /** HP the bar currently shows, to skip redraws when nothing changed. */
  shownHp: number;
  /** Key of the hex this view is at, or travelling to. */
  hexKey: string;
  tween: Tween | null;
}

export class EntityRenderer {
  readonly container = new Container();
  private readonly views = new Map<string, EntityView>();

  /** Reconciles the drawn shapes with the entity list: adds new, moves existing, removes gone. */
  sync(entities: Entity[]): void {
    const alive = new Set<string>();

    for (const entity of entities) {
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

      if (view.hpBar && view.shownHp !== entity.hp) {
        drawHpBar(view.hpBar, entity.hp / entity.maxHp);
        view.shownHp = entity.hp;
      }
    }

    for (const [id, view] of this.views) {
      if (alive.has(id)) continue;
      view.root.destroy({ children: true });
      this.views.delete(id);
    }
  }

  /** Advances movement tweens. Call once per frame. */
  update(deltaSeconds: number): void {
    for (const view of this.views.values()) {
      const tween = view.tween;
      if (!tween) continue;

      tween.elapsed += deltaSeconds;
      const t = Math.min(tween.elapsed / timing.moveSecondsPerHex, 1);
      view.root.position.set(
        tween.fromX + (tween.toX - tween.fromX) * t,
        tween.fromY + (tween.toY - tween.fromY) * t,
      );
      if (t >= 1) view.tween = null;
    }
  }

  private createView(entity: Entity, hexKey: string): EntityView {
    const root = new Container();
    const shape = new Graphics();
    root.addChild(shape);

    if (entity.kind === 'player') {
      drawPlayer(shape);
      return { root, hpBar: null, shownHp: entity.hp, hexKey, tween: null };
    }

    (ENEMY_SHAPES[entity.typeId] ?? drawUnknownEnemy)(shape);
    // A sibling of the shape, not a child, so a translucent enemy keeps a solid bar.
    const hpBar = new Graphics();
    drawHpBar(hpBar, entity.hp / entity.maxHp);
    root.addChild(hpBar);
    return { root, hpBar, shownHp: entity.hp, hexKey, tween: null };
  }
}

function drawHpBar(g: Graphics, fraction: number): void {
  const { width, height, offsetY, back, fill } = HP_BAR;
  g.clear();
  g.rect(-width / 2, offsetY, width, height).fill({ color: back });
  if (fraction > 0) g.rect(-width / 2, offsetY, width * fraction, height).fill({ color: fill });
}
