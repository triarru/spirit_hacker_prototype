import { useEffect, useRef } from 'react';
import { Application, Container, type FederatedPointerEvent } from 'pixi.js';
import { pixelToHex, type HexCoord } from '../core/hex/HexCoord';
import { useCombatStore } from '../stores/useCombatStore';
import { useUIStore } from '../stores/useUIStore';
import { EntityRenderer } from './EntityRenderer';
import { HexGridRenderer } from './HexGridRenderer';

const BACKGROUND = 0x0b0f17;
/** Free space kept between the grid and the canvas edge, in px. */
const PADDING = 32;
const MAX_ZOOM = 1.5;

/**
 * Builds the scene, wires input → store and store → renderers.
 * Returns a function that undoes all of it.
 */
function mountGame(app: Application): () => void {
  const world = new Container();
  const gridRenderer = new HexGridRenderer();
  const entityRenderer = new EntityRenderer();
  world.addChild(gridRenderer.container, entityRenderer.container);
  app.stage.addChild(world);

  const layout = (): void => {
    const bounds = gridRenderer.getBounds(useCombatStore.getState().grid);
    const { width, height } = app.screen;
    const scale = Math.min(
      (width - PADDING * 2) / bounds.width,
      (height - PADDING * 2) / bounds.height,
      MAX_ZOOM,
    );
    world.scale.set(scale);
    world.position.set(
      (width - bounds.width * scale) / 2 - bounds.x * scale,
      (height - bounds.height * scale) / 2 - bounds.y * scale,
    );
  };

  const drawCombat = (): void => {
    const { grid, entities } = useCombatStore.getState();
    gridRenderer.drawTerrain(grid);
    entityRenderer.sync(entities);
    layout();
  };

  const drawUI = (): void => {
    const ui = useUIStore.getState();
    gridRenderer.drawRanges(ui.moveRange, ui.spellRange);
    gridRenderer.drawPath(ui.path);
    gridRenderer.drawCursor(ui.hoveredHex, ui.selectedHex);
  };

  drawCombat();
  drawUI();

  const unsubscribeCombat = useCombatStore.subscribe(drawCombat);
  const unsubscribeUI = useUIStore.subscribe((state, previous) => {
    if (state.moveRange !== previous.moveRange || state.spellRange !== previous.spellRange) {
      gridRenderer.drawRanges(state.moveRange, state.spellRange);
    }
    if (state.path !== previous.path) gridRenderer.drawPath(state.path);
    if (state.hoveredHex !== previous.hoveredHex || state.selectedHex !== previous.selectedHex) {
      gridRenderer.drawCursor(state.hoveredHex, state.selectedHex);
    }
  });

  /** The grid hex under the pointer, or null when the pointer is outside the grid. */
  const hexUnderPointer = (event: FederatedPointerEvent): HexCoord | null => {
    // getLocalPosition undoes the world's pan/zoom, so pixelToHex sees unscaled grid pixels.
    const hex = pixelToHex(event.getLocalPosition(world));
    return useCombatStore.getState().grid.has(hex) ? hex : null;
  };

  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointermove', (event) => useUIStore.getState().setHoveredHex(hexUnderPointer(event)));
  app.stage.on('pointerdown', (event) => useUIStore.getState().selectHex(hexUnderPointer(event)));
  app.stage.on('pointerleave', () => useUIStore.getState().setHoveredHex(null));

  app.renderer.on('resize', layout);

  return () => {
    unsubscribeCombat();
    unsubscribeUI();
    app.renderer.off('resize', layout);
  };
}

export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const app = new Application();
    let disposed = false;
    let unmountGame: (() => void) | null = null;

    void app
      .init({
        resizeTo: host,
        background: BACKGROUND,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      })
      .then(() => {
        // init() is async: under StrictMode the effect's cleanup can run before it
        // resolves, in which case this app is already unwanted.
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }
        host.appendChild(app.canvas);
        unmountGame = mountGame(app);
      });

    return () => {
      disposed = true;
      if (unmountGame) {
        unmountGame();
        app.destroy(true, { children: true });
      }
    };
  }, []);

  return <div ref={hostRef} className="game-canvas" />;
}
