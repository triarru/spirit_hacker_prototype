import { pathCost } from '../core/combat/Movement';
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
  const path = useUIStore((state) => state.path);
  const spellRangeVisible = useUIStore((state) => state.spellPreviewRange !== null);
  const setSpellPreviewRange = useUIStore((state) => state.setSpellPreviewRange);

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
        <dt>Move cost</dt>
        <dd>{path.length > 1 ? `${pathCost(grid, path)} AP` : '—'}</dd>
      </dl>
      <label>
        <input
          type="checkbox"
          checked={spellRangeVisible}
          onChange={(event) =>
            setSpellPreviewRange(event.target.checked ? PREVIEW_SPELL_RANGE : null)
          }
        />
        <span className="swatch swatch-spell" /> Spell range ({PREVIEW_SPELL_RANGE})
      </label>
    </section>
  );
}
