import { useCombatStore } from '../stores/useCombatStore';

export function GameOverScreen() {
  const phase = useCombatStore((state) => state.phase);

  if (phase !== 'VICTORY' && phase !== 'DEFEAT') return null;
  const won = phase === 'VICTORY';

  return (
    <div className={`game-over ${won ? 'game-over-victory' : 'game-over-defeat'}`} role="status">
      <strong>{won ? 'Cleared' : 'System formatted'}</strong>
      <span>Reload the page to play again</span>
    </div>
  );
}
