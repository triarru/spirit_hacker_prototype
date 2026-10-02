import { Container, Graphics } from 'pixi.js';
import type { Entity } from '../core/entities/Entity';
import { hexToPixel } from '../core/hex/HexCoord';

const PLAYER_COLOR = 0x3b82f6;
const ENEMY_COLOR = 0xef4444;
const BORDER_COLOR = 0xffffff;
const ENEMY_BORDER = { width: 2, color: 0x7f1d1d } as const;

/** Half-extent of every placeholder shape, in px. */
const RADIUS = 24;

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

export class EntityRenderer {
  readonly container = new Container();
  private readonly views = new Map<string, Graphics>();

  /** Reconciles the drawn shapes with the entity list: adds new, moves existing, removes gone. */
  sync(entities: Entity[]): void {
    const alive = new Set<string>();

    for (const entity of entities) {
      alive.add(entity.id);
      let view = this.views.get(entity.id);
      if (!view) {
        view = this.createView(entity);
        this.views.set(entity.id, view);
        this.container.addChild(view);
      }
      const { x, y } = hexToPixel(entity.position);
      view.position.set(x, y);
    }

    for (const [id, view] of this.views) {
      if (alive.has(id)) continue;
      view.destroy();
      this.views.delete(id);
    }
  }

  private createView(entity: Entity): Graphics {
    const g = new Graphics();
    if (entity.kind === 'player') {
      drawPlayer(g);
    } else {
      (ENEMY_SHAPES[entity.typeId] ?? drawUnknownEnemy)(g);
    }
    return g;
  }
}
