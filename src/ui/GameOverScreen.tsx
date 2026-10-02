import { useCombatStore } from '../stores/useCombatStore';

export function GameOverScreen() {
  const phase = useCombatStore((state) => state.phase);
  const turn = useCombatStore((state) => state.turn);
  // The enemy turn that ended the fight is still winding down for a moment.
  const busy = useCombatStore((state) => state.busy);
  const restart = useCombatStore((state) => state.restart);

  if (phase !== 'VICTORY' && phase !== 'DEFEAT') return null;
  const won = phase === 'VICTORY';

  return (
    <div className={`game-over ${won ? 'game-over-victory' : 'game-over-defeat'}`} role="status">
      <strong>{won ? 'Cleared' : 'System formatted'}</strong>
      <span>
        {won ? 'All hostile processes terminated' : 'Connection lost'} · turn {turn}
      </span>
      <button type="button" className="try-again" disabled={busy} onClick={restart}>
        Try again
      </button>
    </div>
  );
}
