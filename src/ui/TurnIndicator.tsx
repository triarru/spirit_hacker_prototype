import { useCombatStore } from '../stores/useCombatStore';
import { ApDots } from './HUD';
import { useLabels } from './labels';

/** Whose turn it is, and what the player has left to spend on theirs. */
export function TurnIndicator() {
  const phase = useCombatStore((state) => state.phase);
  const turn = useCombatStore((state) => state.turn);
  const ap = useCombatStore((state) => state.player.ap);
  const apBank = useCombatStore((state) => state.player.apBank);
  const labels = useLabels();

  if (phase !== 'PLAYER_TURN' && phase !== 'ENEMY_TURN') return null;
  const playerTurn = phase === 'PLAYER_TURN';

  return (
    <div className={`turn-indicator ${playerTurn ? 'turn-player' : 'turn-enemy'}`}>
      <span className="mode-title">{labels.modeTitle}</span>
      <strong>{playerTurn ? labels.playerTurn : labels.enemyTurn}</strong>
      <ApDots />
      <span className="turn-caption">
        {ap}
        {apBank > 0 ? ` + ${apBank} ${labels.bank}` : ''} · {labels.turn} {turn}
      </span>
    </div>
  );
}
