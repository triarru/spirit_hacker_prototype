import { useCombatStore } from '../stores/useCombatStore';

export function HUD() {
  const player = useCombatStore((state) => state.player);

  // AP above maxAp came from the bank, so the row grows to show those dots too.
  const dotCount = Math.max(player.maxAp, player.ap);
  const dots = Array.from({ length: dotCount }, (_, index) => {
    const filled = index < player.ap;
    const banked = index >= player.maxAp;
    return (
      <span
        key={index}
        className={`ap-dot${filled ? ' ap-dot-filled' : ''}${banked ? ' ap-dot-banked' : ''}`}
      />
    );
  });

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
        <span className="hud-label">AP</span>
        <div className="ap-dots" role="img" aria-label={`${player.ap} action points`}>
          {dots}
        </div>
      </div>
    </section>
  );
}
