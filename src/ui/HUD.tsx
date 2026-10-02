import { useCombatStore } from '../stores/useCombatStore';
import { useLabels } from './labels';

interface VitalProps {
  label: string;
  value: number;
  max: number;
  fill: string;
}

function Vital({ label, value, max, fill }: VitalProps) {
  return (
    <div className="vital">
      <span className="vital-label">{label}</span>
      <div className="vital-bar" role="img" aria-label={`${label} ${value} of ${max}`}>
        <div className={`vital-fill ${fill}`} style={{ width: `${(value / max) * 100}%` }} />
        <span className="vital-value">{value}</span>
      </div>
    </div>
  );
}

/** The player's three pools: health, RAM for programs, Qi for rites. */
export function HUD() {
  const player = useCombatStore((state) => state.player);

  return (
    <section className="hud">
      <Vital label="HP" value={player.hp} max={player.maxHp} fill="bar-hp" />
      <Vital label="RAM" value={player.ram} max={player.maxRam} fill="bar-ram" />
      <Vital label="Qi" value={player.qi} max={player.maxQi} fill="bar-qi" />
    </section>
  );
}

/**
 * Action points as dots: filled is available, hollow is spent. AP above the
 * usual maximum came from the bank and is gold. AP still sitting in the bank,
 * earned for next turn, shows as gold dots after the divider.
 */
export function ApDots() {
  const player = useCombatStore((state) => state.player);
  const usableCount = Math.max(player.maxAp, player.ap);
  const usable = Array.from({ length: usableCount }, (_, index) => (
    <span
      key={index}
      className={`ap-dot${index < player.ap ? ' ap-dot-filled' : ''}${index >= player.maxAp ? ' ap-dot-banked' : ''}`}
    />
  ));
  const banked = Array.from({ length: player.apBank }, (_, index) => (
    <span key={index} className="ap-dot ap-dot-filled ap-dot-banked" />
  ));
  const label =
    player.apBank > 0
      ? `${player.ap} action points, ${player.apBank} banked for next turn`
      : `${player.ap} action points`;

  return (
    <div className="ap-dots" role="img" aria-label={label}>
      {usable}
      {banked.length > 0 && <span className="ap-divider" />}
      {banked}
    </div>
  );
}

/** The programs slotted as passives: always on, so they sit off to the side. */
export function Passives() {
  const passives = useCombatStore((state) => state.passives);
  const inFight = useCombatStore((state) => state.phase === 'PLAYER_TURN' || state.phase === 'ENEMY_TURN');
  const labels = useLabels();
  if (!inFight || passives.length === 0) return null;

  return (
    <section className="panel passives-panel">
      <h2>{labels.passives}</h2>
      <ul className="passives">
        {passives.map((program) => (
          <li key={program.id}>
            <strong>{program.name}</strong> {program.passive.description}
          </li>
        ))}
      </ul>
    </section>
  );
}
