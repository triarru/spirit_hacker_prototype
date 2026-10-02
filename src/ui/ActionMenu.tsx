import { HACK_RULES, type HackKind } from '../core/combat/EnvironmentHack';
import { useUIStore } from '../stores/useUIStore';

const { turret, trap, wall } = HACK_RULES;

const HACKS: Record<HackKind, { title: string; detail: string }> = {
  TURRET: { title: 'Deploy turret', detail: `${turret.damage} dmg a turn, ${turret.turns} turns` },
  TRAP: { title: 'Set trap', detail: `${trap.damage} dmg + slow, once` },
  WALL: { title: 'Raise wall', detail: `blocks for ${wall.turns} turns` },
  BREAK_WALL: { title: 'Break wall', detail: 'opens it for good' },
};

/** Offset from the click, in px, so the menu does not sit under the pointer. */
const OFFSET = 14;

/** The choice of hacks for a hex that can take more than one. Appears where the player clicked. */
export function ActionMenu() {
  const menu = useUIStore((state) => state.hackMenu);
  const chooseHack = useUIStore((state) => state.chooseHack);
  if (!menu) return null;

  return (
    <section className="panel action-menu" style={{ left: menu.at.x + OFFSET, top: menu.at.y + OFFSET }}>
      <h2>Hack this hex</h2>
      {menu.options.map((option) => (
        <button
          key={option.kind}
          type="button"
          className="menu-option"
          disabled={!option.affordable}
          onClick={() => chooseHack(option.kind)}
        >
          <strong>{HACKS[option.kind].title}</strong>
          <span>{HACKS[option.kind].detail}</span>
          <em>
            {option.apCost} AP · {option.ramCost} RAM
          </em>
        </button>
      ))}
    </section>
  );
}
