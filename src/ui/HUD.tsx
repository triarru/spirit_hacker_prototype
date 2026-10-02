import { useCombatStore } from '../stores/useCombatStore';
import { useUIStore } from '../stores/useUIStore';

export function HUD() {
  const player = useCombatStore((state) => state.player);
  const canEndTurn = useCombatStore((state) => state.phase === 'PLAYER_TURN' && !state.busy);
  const endTurn = useCombatStore((state) => state.endTurn);
  const passives = useCombatStore((state) => state.passives);
  const canHack = useCombatStore(
    (state) => state.phase === 'PLAYER_TURN' && !state.busy && state.hackTargets.length > 0,
  );
  const hackMode = useUIStore((state) => state.hackMode);
  const toggleHackMode = useUIStore((state) => state.toggleHackMode);

  // AP above maxAp came from the bank, so the row grows to show those dots too.
  // AP still sitting in the bank shows as extra gold dots: earned, usable next turn.
  const usableCount = Math.max(player.maxAp, player.ap);
  const dots = Array.from({ length: usableCount + player.apBank }, (_, index) => {
    const pending = index >= usableCount;
    const filled = pending || index < player.ap;
    const banked = pending || index >= player.maxAp;
    return (
      <span
        key={index}
        className={`ap-dot${filled ? ' ap-dot-filled' : ''}${banked ? ' ap-dot-banked' : ''}`}
      />
    );
  });
  const apLabel =
    player.apBank > 0
      ? `${player.ap} action points, ${player.apBank} banked for next turn`
      : `${player.ap} action points`;

  return (
    <section className="panel hud">
      <div className="hud-row">
        <span className="hud-label">HP</span>
        <div className="bar" role="img" aria-label={`HP ${player.hp} of ${player.maxHp}`}>
          <div className="bar-fill bar-hp" style={{ width: `${(player.hp / player.maxHp) * 100}%` }} />
        </div>
        <span className="hud-value">
          {player.hp}/{player.maxHp}
        </span>
      </div>
      <div className="hud-row">
        <span className="hud-label">RAM</span>
        <div className="bar" role="img" aria-label={`RAM ${player.ram} of ${player.maxRam}`}>
          <div className="bar-fill bar-ram" style={{ width: `${(player.ram / player.maxRam) * 100}%` }} />
        </div>
        <span className="hud-value">
          {player.ram}/{player.maxRam}
        </span>
      </div>
      <div className="hud-row">
        <span className="hud-label">Qi</span>
        <div className="bar" role="img" aria-label={`Qi ${player.qi} of ${player.maxQi}`}>
          <div className="bar-fill bar-qi" style={{ width: `${(player.qi / player.maxQi) * 100}%` }} />
        </div>
        <span className="hud-value">
          {player.qi}/{player.maxQi}
        </span>
      </div>
      <div className="hud-row">
        <span className="hud-label">AP</span>
        <div className="ap-dots" role="img" aria-label={apLabel}>
          {dots}
        </div>
      </div>
      <button
        type="button"
        className={`hack-button${hackMode ? ' hack-button-active' : ''}`}
        disabled={!canHack}
        onClick={(event) => {
          event.currentTarget.blur();
          toggleHackMode();
        }}
      >
        Hack <kbd>H</kbd>
      </button>
      <button
        type="button"
        className="end-turn"
        disabled={!canEndTurn}
        onClick={(event) => {
          // Space is the parry key. Left focused, this button would also react to it,
          // and a parry pressed a moment too late would end the player's next turn.
          event.currentTarget.blur();
          void endTurn();
        }}
      >
        End turn
      </button>
      {passives.length > 0 && (
        <ul className="passives">
          {passives.map((program) => (
            <li key={program.id}>
              <strong>{program.name}</strong> {program.passive.description}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
