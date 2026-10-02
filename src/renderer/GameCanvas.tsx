import { useEffect, useRef } from 'react';
import { Application, Container, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import { pixelToHex, type HexCoord } from '../core/hex/HexCoord';
import { useCombatStore } from '../stores/useCombatStore';
import { selectSpellRange, useUIStore } from '../stores/useUIStore';
import { EffectRenderer } from './EffectRenderer';
import { EntityRenderer } from './EntityRenderer';
import { HexGridRenderer } from './HexGridRenderer';
import { ReactivePromptRenderer } from './ReactivePrompt';

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
  const effectRenderer = new EffectRenderer();
  const promptRenderer = new ReactivePromptRenderer();
  world.addChild(
    gridRenderer.container,
    entityRenderer.container,
    promptRenderer.container,
    effectRenderer.container,
  );
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

  const drawTerrain = (): void => {
    gridRenderer.drawTerrain(useCombatStore.getState().grid);
    layout();
  };

  const drawRanges = (): void => {
    const combat = useCombatStore.getState();
    const ui = useUIStore.getState();
    // Mid-action these would be redrawn on every step; hide them until input is accepted again.
    const idle = !combat.busy;
    gridRenderer.drawRanges({
      move: idle ? combat.moveRange : [],
      spell: selectSpellRange(combat, ui.spellPreviewRange),
      attack: idle
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
    entityRenderer.sync([player, ...enemies]);
  };

  drawTerrain();
  syncEntities();
  drawRanges();
  drawCursor();
  gridRenderer.drawPath(useUIStore.getState().path);

  const unsubscribeCombat = useCombatStore.subscribe((state, previous) => {
    if (state.grid !== previous.grid) drawTerrain();
    syncEntities();
    drawRanges();
    drawCursor();
    // Events describe one change; replay them only when a new batch arrives.
    if (state.lastEvents !== previous.lastEvents) {
      effectRenderer.play(state.lastEvents, state.player.id);
    }
  });
  const unsubscribeUI = useUIStore.subscribe((state, previous) => {
    if (state.spellPreviewRange !== previous.spellPreviewRange) drawRanges();
    if (state.path !== previous.path) gridRenderer.drawPath(state.path);
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
  app.stage.on('pointerdown', (event) => useUIStore.getState().clickHex(hexUnderPointer(event)));
  app.stage.on('pointerleave', () => useUIStore.getState().setHoveredHex(null));

  const tick = (ticker: Ticker): void => {
    const deltaSeconds = ticker.deltaMS / 1000;
    entityRenderer.update(deltaSeconds);
    effectRenderer.update(deltaSeconds);
    // The prompt's clock runs outside the store, so it is read fresh every frame.
    const { reactive, player } = useCombatStore.getState();
    promptRenderer.draw(reactive, player.position);
  };
  app.ticker.add(tick);
  app.renderer.on('resize', layout);

  return () => {
    unsubscribeCombat();
    unsubscribeUI();
    app.ticker.remove(tick);
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
