import type { Program } from '../core/programs/Program';
import { applyModifier, PROGRAMS } from '../core/programs/ProgramRegistry';
import {
  loadoutProblems,
  type LoadoutSelection,
  type LoadoutSlot,
} from '../core/programs/SpellDeck';
import { useCombatStore } from '../stores/useCombatStore';
import { cssColor, TAG_COLOR } from '../theme';
import { describeCost, describeSpec } from './programText';

const POOL: Program[] = Object.values(PROGRAMS);
const NONE = '';

/** Where each slotted program sits, as a short label: "Active 2", "Modifier 1", "Passive 1". */
function slotLabels(loadout: LoadoutSelection): Map<string, string> {
  const labels = new Map<string, string>();
  loadout.actives.forEach(({ program, modifier }, index) => {
    if (program) labels.set(program, `Active ${index + 1}`);
    if (modifier) labels.set(modifier, `Modifier ${index + 1}`);
  });
  loadout.passives.forEach((program, index) => {
    if (program) labels.set(program, `Passive ${index + 1}`);
  });
  return labels;
}

interface ProgramSelectProps {
  label: string;
  value: string | null;
  slot: LoadoutSlot;
  /** Where every slotted program currently sits, to show in the option text. */
  usedIn: Map<string, string>;
  /** A program that may not go in this slot (a modifier cannot be its own host). */
  exclude?: string | null;
  disabled?: boolean;
}

function ProgramSelect({ label, value, slot, usedIn, exclude = null, disabled = false }: ProgramSelectProps) {
  const setLoadoutSlot = useCombatStore((state) => state.setLoadoutSlot);

  return (
    <select
      aria-label={label}
      data-slot={`${slot.kind}-${slot.index}`}
      value={value ?? NONE}
      disabled={disabled}
      onChange={(event) => setLoadoutSlot(slot, event.target.value === NONE ? null : event.target.value)}
    >
      <option value={NONE}>— none —</option>
      {POOL.filter((program) => program.id !== exclude).map((program) => {
        const elsewhere = program.id === value ? undefined : usedIn.get(program.id);
        return (
          <option key={program.id} value={program.id}>
            {program.name}
            {elsewhere ? ` (moves from ${elsewhere})` : ''}
          </option>
        );
      })}
    </select>
  );
}

/** Shown before a fight: choose which program goes in each Active, Modifier and Passive slot. */
export function LoadoutScreen() {
  const phase = useCombatStore((state) => state.phase);
  const loadout = useCombatStore((state) => state.loadout);
  const startCombat = useCombatStore((state) => state.startCombat);
  if (phase !== 'LOADOUT') return null;

  const usedIn = slotLabels(loadout);
  const problems = loadoutProblems(loadout);

  return (
    <section className="panel loadout">
      <header>
        <h2>Loadout</h2>
        <p>
          Each program has three uses. Slot it as an <strong>Active</strong> to cast it, under an
          Active as its <strong>Modifier</strong>, or as a <strong>Passive</strong>. A program can
          only be in one slot: picking one that is in use moves it.
        </p>
      </header>

      <div className="loadout-actives">
        {loadout.actives.map(({ program: activeId, modifier: modifierId }, index) => {
          const active = activeId ? PROGRAMS[activeId] : undefined;
          const modifier = modifierId ? PROGRAMS[modifierId] : undefined;
          // The Active as it will actually cast, with the modifier applied.
          const spec = active ? applyModifier(active.active, modifier ?? null) : null;

          return (
            <div
              key={index}
              className="loadout-slot"
              style={spec ? ({ '--tag': cssColor(TAG_COLOR[spec.tag]) } as React.CSSProperties) : undefined}
            >
              <h3>Active {index + 1}</h3>
              <ProgramSelect
                label={`Active ${index + 1}`}
                value={activeId}
                slot={{ kind: 'active', index }}
                usedIn={usedIn}
              />
              <p className="loadout-effect">
                {active && spec ? (
                  <>
                    <strong>{active.displayName}</strong> <em>{spec.tag}</em>
                    <br />
                    {describeSpec(spec)}
                    <br />
                    <span>{describeCost(spec)}</span>
                  </>
                ) : (
                  'Empty slot'
                )}
              </p>

              <h3>Modifier</h3>
              <ProgramSelect
                label={`Modifier ${index + 1}`}
                value={modifierId}
                slot={{ kind: 'modifier', index }}
                usedIn={usedIn}
                exclude={activeId}
                disabled={!active}
              />
              <p className="loadout-effect">
                {modifier ? modifier.modifier.description : active ? 'No modifier' : 'Needs an Active above'}
              </p>
            </div>
          );
        })}
      </div>

      <div className="loadout-passives">
        {loadout.passives.map((passiveId, index) => {
          const passive = passiveId ? PROGRAMS[passiveId] : undefined;
          return (
            <div key={index} className="loadout-slot">
              <h3>Passive {index + 1}</h3>
              <ProgramSelect
                label={`Passive ${index + 1}`}
                value={passiveId}
                slot={{ kind: 'passive', index }}
                usedIn={usedIn}
              />
              <p className="loadout-effect">{passive ? passive.passive.description : 'Empty slot'}</p>
            </div>
          );
        })}
      </div>

      <table className="loadout-pool">
        <thead>
          <tr>
            <th>Program</th>
            <th>As Active</th>
            <th>As Modifier</th>
            <th>As Passive</th>
            <th>Slotted</th>
          </tr>
        </thead>
        <tbody>
          {POOL.map((program) => (
            <tr key={program.id}>
              <td>
                <strong style={{ color: cssColor(TAG_COLOR[program.tag]) }}>{program.name}</strong>
                <br />
                {program.displayName}
              </td>
              <td>
                {describeSpec(program.active)}
                <br />
                <span>{describeCost(program.active)}</span>
              </td>
              <td>{program.modifier.description}</td>
              <td>{program.passive.description}</td>
              <td>{usedIn.get(program.id) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer>
        <p className="loadout-problem">{problems[0] ?? ''}</p>
        <button type="button" className="start-combat" disabled={problems.length > 0} onClick={startCombat}>
          Start combat
        </button>
      </footer>
    </section>
  );
}
