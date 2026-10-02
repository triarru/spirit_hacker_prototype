import { formatOffset, hasDefended, summarizeTiming } from '../stores/defenseStats';
import { useCombatStore } from '../stores/useCombatStore';

const counts = (grades: { perfect: number; good: number; miss: number }): string =>
  `${grades.perfect} perfect · ${grades.good} good · ${grades.miss} miss`;

export function GameOverScreen() {
  const phase = useCombatStore((state) => state.phase);
  const turn = useCombatStore((state) => state.turn);
  // The enemy turn that ended the fight is still winding down for a moment.
  const busy = useCombatStore((state) => state.busy);
  const restart = useCombatStore((state) => state.restart);
  const defense = useCombatStore((state) => state.defense);

  if (phase !== 'VICTORY' && phase !== 'DEFEAT') return null;
  const won = phase === 'VICTORY';
  const timing = summarizeTiming(defense.offsetsSeconds);

  return (
    <div className={`game-over ${won ? 'game-over-victory' : 'game-over-defeat'}`} role="status">
      <strong>{won ? 'Cleared' : 'System formatted'}</strong>
      <span>
        {won ? 'All hostile processes terminated' : 'Connection lost'} · turn {turn}
      </span>
      {hasDefended(defense) && (
        <dl className="defense-summary">
          <dt>Parry</dt>
          <dd>{counts(defense.parry)}</dd>
          <dt>Dodge</dt>
          <dd>{counts(defense.dodge)}</dd>
          <dt>Timing</dt>
          <dd>
            {timing
              ? `avg ${formatOffset(timing.meanSeconds)} · spread ±${Math.round(timing.spreadSeconds * 1000)}ms`
              : 'no timed input'}
          </dd>
          <dt>Unanswered</dt>
          <dd>{defense.unanswered}</dd>
        </dl>
      )}
      <button type="button" className="try-again" disabled={busy} onClick={restart}>
        Try again <kbd>R</kbd>
      </button>
    </div>
  );
}
