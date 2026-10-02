import { useCombatStore } from '../stores/useCombatStore';

export function TurnIndicator() {
  const phase = useCombatStore((state) => state.phase);
  const turn = useCombatStore((state) => state.turn);

  if (phase !== 'PLAYER_TURN' && phase !== 'ENEMY_TURN') return null;
  const playerTurn = phase === 'PLAYER_TURN';

  return (
    <div className={`turn-indicator ${playerTurn ? 'turn-player' : 'turn-enemy'}`}>
      <strong>{playerTurn ? 'Your turn' : 'Enemy turn'}</strong>
      <span>Turn {turn}</span>
    </div>
  );
}
