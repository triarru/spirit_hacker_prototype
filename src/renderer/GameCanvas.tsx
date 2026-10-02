import { useEffect, useRef } from 'react';
import { Application, Container, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import { pathCost } from '../core/combat/Movement';
import { hexToPixel, pixelToHex, type HexCoord } from '../core/hex/HexCoord';
import { useCombatStore } from '../stores/useCombatStore';
import { useUIStore } from '../stores/useUIStore';
import { Camera } from './Camera';
import type { Rect } from './cameraMath';
import { EffectRenderer } from './EffectRenderer';
import { EntityRenderer } from './EntityRenderer';
import { HexGridRenderer } from './HexGridRenderer';
import { PreviewRenderer } from './PreviewRenderer';
import { ReactivePromptRenderer } from './ReactivePrompt';

const BACKGROUND = 0x0b0f17;
/** Free space kept between the grid and the canvas edge, in px. */
const PADDING = 32;
/**
 * Height kept clear at the bottom of the canvas for the spell bar, in px: its hint line,
 * a row of cards at their tallest (one with a modifier), and the margins around them.
 */
const SPELL_BAR_RESERVE = 186;
/** How strongly one notch of the mouse wheel zooms. */
const WHEEL_ZOOM_RATE = 0.0015;

/**
 * Builds the scene, wires input → store and store → renderers.
 * Returns a function that undoes all of it.
 */
function mountGame(app: Application): () => void {
  const world = new Container();
  const gridRenderer = new HexGridRenderer();
  const entityRenderer = new EntityRenderer();
  const effectRenderer = new EffectRenderer();
  const promptRenderer = new ReactivePromptRenderer();
  const previewRenderer = new PreviewRenderer();
  world.addChild(
    gridRenderer.container,
    entityRenderer.container,
    previewRenderer.container,
    promptRenderer.container,
    effectRenderer.container,
  );
  app.stage.addChild(world);

  const camera = new Camera(world);
  let gridBounds = gridRenderer.getBounds(useCombatStore.getState().grid);

  /** The part of the canvas the grid may use: inside the padding, above the spell bar. */
  const viewRect = (): Rect => ({
    x: PADDING,
    y: PADDING,
    width: app.screen.width - PADDING * 2,
    height: app.screen.height - PADDING - SPELL_BAR_RESERVE,
  });

  const updateCamera = (deltaSeconds: number): void => {
    const focus = hexToPixel(useCombatStore.getState().player.position);
    camera.update(viewRect(), gridBounds, focus, deltaSeconds);
  };

  const drawTerrain = (): void => {
    gridRenderer.drawTerrain(useCombatStore.getState().grid);
  };

  const drawPath = (): void => {
    const { path } = useUIStore.getState();
    gridRenderer.drawPath(path, pathCost(useCombatStore.getState().grid, path));
  };

  const drawRanges = (): void => {
    const combat = useCombatStore.getState();
    const ui = useUIStore.getState();
    // Mid-action these would be redrawn on every step; hide them until input is accepted again.
    // While a spell is being aimed or hack mode is on, only those targets are shown:
    // a click then means "cast" or "hack", not "move" or "attack".
    const showActions = !combat.busy && ui.targetingSlot === null && !ui.hackMode;
    gridRenderer.drawRanges({
      move: showActions ? combat.moveRange : [],
      spell: ui.spellTargets,
      hack: ui.hackMode ? combat.hackTargets : [],
      attack: showActions
        ? combat.enemies
            .filter((enemy) => combat.attackableEnemyIds.includes(enemy.id))
            .map((enemy) => enemy.position)
        : [],
    });
  };

  const drawCursor = (): void => {
    const combat = useCombatStore.getState();
    const ui = useUIStore.getState();
    const selected = combat.enemies.find((enemy) => enemy.id === ui.selectedEntityId);
    gridRenderer.drawCursor(ui.hoveredHex, selected?.position ?? null);
  };

  const syncEntities = (): void => {
    const { player, enemies } = useCombatStore.getState();
    entityRenderer.sync(player, enemies);
  };

  drawTerrain();
  syncEntities();
  drawRanges();
  drawCursor();
  drawPath();
  updateCamera(0);

  const drawPreview = (): void => {
    previewRenderer.draw(useUIStore.getState().spellPreview, useCombatStore.getState().player.position);
  };

  const unsubscribeCombat = useCombatStore.subscribe((state, previous) => {
    if (state.grid !== previous.grid) {
      // A new fight: nothing on screen should glide over from the old one.
      gridBounds = gridRenderer.getBounds(state.grid);
      entityRenderer.reset();
      camera.snap();
      drawTerrain();
    } else if (state.terrainVersion !== previous.terrainVersion) {
      drawTerrain();
    }
    syncEntities();
    drawRanges();
    drawCursor();
    // Events describe one change; replay them only when a new batch arrives.
    if (state.lastEvents !== previous.lastEvents) {
      effectRenderer.play(state.lastEvents, state.player.id);
      for (const event of state.lastEvents) {
        if (event.type === 'breached') entityRenderer.flash(event.entityId);
      }
    }
  });
  const unsubscribeUI = useUIStore.subscribe((state, previous) => {
    if (
      state.spellTargets !== previous.spellTargets ||
      state.targetingSlot !== previous.targetingSlot ||
      state.hackMode !== previous.hackMode
    ) {
      drawRanges();
    }
    if (state.spellPreview !== previous.spellPreview) drawPreview();
    if (state.path !== previous.path) drawPath();
    if (
      state.hoveredHex !== previous.hoveredHex ||
      state.selectedEntityId !== previous.selectedEntityId
    ) {
      drawCursor();
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
  app.stage.on('pointerdown', (event) => {
    const ui = useUIStore.getState();
    // Right-click cancels a spell being aimed or hack mode; otherwise it selects without acting,
    // so an adjacent enemy can be inspected without attacking it.
    if (event.button === 2) ui.selectHex(hexUnderPointer(event));
    // The canvas fills the window, so its global coordinates are also the page's.
    else ui.clickHex(hexUnderPointer(event), { x: event.global.x, y: event.global.y });
  });
  app.stage.on('pointerleave', () => useUIStore.getState().setHoveredHex(null));

  const suppressContextMenu = (event: Event): void => event.preventDefault();
  app.canvas.addEventListener('contextmenu', suppressContextMenu);

  const tick = (ticker: Ticker): void => {
    const deltaSeconds = ticker.deltaMS / 1000;
    gridRenderer.update(deltaSeconds);
    entityRenderer.update(deltaSeconds);
    effectRenderer.update(deltaSeconds);
    // The prompt's clock runs outside the store, so it is read fresh every frame.
    const { reactive, player, windingUp } = useCombatStore.getState();
    entityRenderer.setWindingUp(windingUp);
    promptRenderer.draw(reactive, player.position);
    updateCamera(deltaSeconds);
  };
  app.ticker.add(tick);

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    camera.zoomBy(Math.exp(-event.deltaY * WHEEL_ZOOM_RATE));
  };
  app.canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    unsubscribeCombat();
    unsubscribeUI();
    app.ticker.remove(tick);
    app.canvas.removeEventListener('wheel', onWheel);
    app.canvas.removeEventListener('contextmenu', suppressContextMenu);
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
