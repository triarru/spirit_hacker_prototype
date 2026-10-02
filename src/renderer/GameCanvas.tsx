import { useEffect, useRef } from 'react';
import { Application, ColorMatrixFilter, Container, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import { pathCost } from '../core/combat/Movement';
import type { HexCoord } from '../core/hex/HexCoord';
import { useCombatStore } from '../stores/useCombatStore';
import { useUIStore } from '../stores/useUIStore';
import { Camera } from './Camera';
import type { Rect } from './cameraMath';
import { EffectRenderer } from './EffectRenderer';
import { EntityRenderer } from './EntityRenderer';
import { HexGridRenderer } from './HexGridRenderer';
import { pickHex } from './picking';
import { PreviewRenderer } from './PreviewRenderer';
import { groundPoint } from './projection';
import { ReactivePromptRenderer } from './ReactivePrompt';

/** Free space kept between the board and the sides of the canvas, in px. */
const PADDING = 32;
/** Height kept clear at the top of the canvas for the vitals and the turn indicator, in px. */
const TOP_RESERVE = 104;
/**
 * Height kept clear at the bottom of the canvas, in px: the row of action modes, and above it
 * the spell bar with its hint line and a row of cards at their tallest (one with a modifier).
 */
const SPELL_BAR_RESERVE = 232;
/** How strongly one notch of the mouse wheel zooms. */
const WHEEL_ZOOM_RATE = 0.0015;

/**
 * Builds the scene, wires input → store and store → renderers.
 * Returns a function that undoes all of it.
 */
function mountGame(app: Application): () => void {
  const world = new Container();
  // Everything that stands up, walls and units alike, in one layer sorted by depth:
  // what is nearer the camera is drawn later and hides what is behind it.
  const standing = new Container();
  standing.sortableChildren = true;
  const gridRenderer = new HexGridRenderer(standing);
  const entityRenderer = new EntityRenderer(standing);
  const effectRenderer = new EffectRenderer();
  const promptRenderer = new ReactivePromptRenderer();
  const previewRenderer = new PreviewRenderer();
  world.addChild(
    gridRenderer.ground,
    previewRenderer.ground,
    standing,
    gridRenderer.overlay,
    previewRenderer.container,
    promptRenderer.container,
    effectRenderer.container,
  );
  app.stage.addChild(world);

  // Veil mode shows the same board through a warm, aged tint, to match its HUD.
  const veilTint = new ColorMatrixFilter();
  veilTint.sepia(false);
  // Only part of the way: enemies still have to read as red, and the player as blue.
  veilTint.alpha = 0.55;
  const applyMode = (): void => {
    world.filters = useUIStore.getState().mode === 'veil' ? [veilTint] : [];
  };
  applyMode();

  const camera = new Camera(world);
  let gridBounds = gridRenderer.getBounds(useCombatStore.getState().grid);

  /** The part of the canvas the board may use: inside the padding, between the top bar and the spell bar. */
  const viewRect = (): Rect => ({
    x: PADDING,
    y: TOP_RESERVE,
    width: app.screen.width - PADDING * 2,
    height: app.screen.height - TOP_RESERVE - SPELL_BAR_RESERVE,
  });

  const updateCamera = (deltaSeconds: number): void => {
    const focus = groundPoint(useCombatStore.getState().player.position);
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
    if (state.mode !== previous.mode) applyMode();
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

  /** The hex the pointer is on, or null when it is off the board. */
  const hexUnderPointer = (event: FederatedPointerEvent): HexCoord | null => {
    const { grid, player, enemies } = useCombatStore.getState();
    // getLocalPosition undoes the world's pan/zoom, so picking sees unscaled board pixels.
    return pickHex(event.getLocalPosition(world), grid, [player, ...enemies].map((unit) => unit.position));
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
        // The backdrop is the page's own, behind the canvas, so the theme can change it.
        backgroundAlpha: 0,
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
