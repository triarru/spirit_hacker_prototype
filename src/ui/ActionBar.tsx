import { useState } from 'react';
import { useCombatStore } from '../stores/useCombatStore';
import { useUIStore } from '../stores/useUIStore';
import { Controls } from './Controls';
import { useLabels } from './labels';

/**
 * What a click on the board means right now, as a row of modes: move (the
 * default), cast (a card is being aimed), hack. Plus ending the turn, and the
 * controls cheat sheet tucked behind a button.
 */
export function ActionBar() {
  const inFight = useCombatStore((state) => state.phase === 'PLAYER_TURN' || state.phase === 'ENEMY_TURN');
  const canAct = useCombatStore((state) => state.phase === 'PLAYER_TURN' && !state.busy);
  const canHack = useCombatStore((state) => state.hackTargets.length > 0);
  const hand = useCombatStore((state) => state.hand);
  const endTurn = useCombatStore((state) => state.endTurn);
  const targetingSlot = useUIStore((state) => state.targetingSlot);
  const hackMode = useUIStore((state) => state.hackMode);
  const selectCard = useUIStore((state) => state.selectCard);
  const toggleHackMode = useUIStore((state) => state.toggleHackMode);
  const cancelAction = useUIStore((state) => state.cancelAction);
  const labels = useLabels();
  const [helpOpen, setHelpOpen] = useState(false);

  if (!inFight) return null;

  const casting = targetingSlot !== null;
  const castable = hand.find((card) => card.affordable);
  /** Leaves focus off the button, so Space (the parry key) cannot press it again. */
  const press = (action: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur();
    action();
  };

  return (
    <div className="action-bar">
      {helpOpen && <Controls />}
      <div className="action-modes">
        <button
          type="button"
          className={`mode-button${!casting && !hackMode ? ' mode-button-active' : ''}`}
          disabled={!canAct}
          onClick={press(cancelAction)}
        >
          {labels.move}
        </button>
        <button
          type="button"
          className={`mode-button${casting ? ' mode-button-active' : ''}`}
          disabled={!canAct || (!casting && !castable)}
          // Aims the first card that can be paid for; pressing it again puts the card back.
          onClick={press(() => (casting ? cancelAction() : castable && selectCard(castable.slot)))}
        >
          {labels.cast}
        </button>
        <button
          type="button"
          className={`mode-button hack-button${hackMode ? ' mode-button-active' : ''}`}
          disabled={!canAct || !canHack}
          onClick={press(toggleHackMode)}
        >
          {labels.hack} <kbd>H</kbd>
        </button>
        <button type="button" className="mode-button end-turn" disabled={!canAct} onClick={press(() => void endTurn())}>
          {labels.end} <kbd>E</kbd>
        </button>
        <button
          type="button"
          className={`mode-button help-button${helpOpen ? ' mode-button-active' : ''}`}
          aria-expanded={helpOpen}
          title={labels.help}
          onClick={press(() => setHelpOpen(!helpOpen))}
        >
          ?
        </button>
      </div>
    </div>
  );
}
