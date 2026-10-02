import type { HexCoord } from '../core/hex/HexCoord';
import { useCombatStore } from '../stores/useCombatStore';
import { useUIStore } from '../stores/useUIStore';

/** Stand-in until spells exist (Milestone 6), where the range comes from programs.json. */
const PREVIEW_SPELL_RANGE = 3;

function formatOffset(hex: HexCoord): string {
  const { col, row } = hex.toOffset();
  return `col ${col}, row ${row}`;
}

function formatCube(hex: HexCoord): string {
  return `q ${hex.q}, r ${hex.r}, s ${hex.s}`;
}

/** Dev-only readout for verifying the hex grid; replaced by the real HUD in Milestone 8. */
export function DebugPanel() {
  const grid = useCombatStore((state) => state.grid);
  const hoveredHex = useUIStore((state) => state.hoveredHex);
  const selectedHex = useUIStore((state) => state.selectedHex);
  const selectedEntityId = useUIStore((state) => state.selectedEntityId);
  const path = useUIStore((state) => state.path);
  const moveRangeVisible = useUIStore((state) => state.moveRange.length > 0);
  const spellRangeVisible = useUIStore((state) => state.spellRange.length > 0);
  const setMoveRangeVisible = useUIStore((state) => state.setMoveRangeVisible);
  const previewSpellRange = useUIStore((state) => state.previewSpellRange);

  let pathSummary = '—';
  if (selectedHex && !selectedEntityId) {
    pathSummary = path.length > 0 ? `${path.length - 1} steps` : 'unreachable';
  }

  return (
    <section className="panel debug-panel">
      <h2>Hex debug</h2>
      <dl>
        <dt>Offset</dt>
        <dd>{hoveredHex ? formatOffset(hoveredHex) : '—'}</dd>
        <dt>Cube</dt>
        <dd>{hoveredHex ? formatCube(hoveredHex) : '—'}</dd>
        <dt>Terrain</dt>
        <dd>{(hoveredHex && grid.getCell(hoveredHex)?.terrain) ?? '—'}</dd>
        <dt>Path</dt>
        <dd>{pathSummary}</dd>
      </dl>
      <label>
        <input
          type="checkbox"
          checked={moveRangeVisible}
          onChange={(event) => setMoveRangeVisible(event.target.checked)}
        />
        <span className="swatch swatch-move" /> Move range
      </label>
      <label>
        <input
          type="checkbox"
          checked={spellRangeVisible}
          onChange={(event) => previewSpellRange(event.target.checked ? PREVIEW_SPELL_RANGE : null)}
        />
        <span className="swatch swatch-spell" /> Spell range ({PREVIEW_SPELL_RANGE})
      </label>
    </section>
  );
}
