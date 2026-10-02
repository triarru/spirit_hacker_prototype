import { useEffect } from 'react';
import { useCombatStore } from '../stores/useCombatStore';
import { useUIStore } from '../stores/useUIStore';

/** Typing into a form control is not a game command. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
}

/**
 * The game's keyboard shortcuts, in one place:
 *   1-9  pick the card in that position of the hand
 *   H    hack mode on / off
 *   E    end turn
 *   R    try again, once the fight is over
 *   Esc  cancel targeting or hack mode
 *
 * Each store action already refuses to run at the wrong time (out of turn,
 * mid-animation, before the fight has ended), so this only maps keys to them.
 *
 * Space is deliberately not a shortcut for End Turn: it is the parry key, and a
 * parry pressed a moment too late would then end the player's next turn.
 * The reactive-defense keys (Space, arrows, WASD) are handled by the prompt itself.
 */
export function useHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Leave browser shortcuts (Cmd/Ctrl+R to reload, and so on) alone.
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;

      const combat = useCombatStore.getState();
      const ui = useUIStore.getState();

      switch (event.code) {
        case 'Escape':
          ui.cancelAction();
          return;
        case 'KeyH':
          ui.toggleHackMode();
          return;
        case 'KeyE':
          void combat.endTurn();
          return;
        case 'KeyR':
          combat.restart();
          return;
        default: {
          const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
          const card = digit ? combat.hand[Number(digit) - 1] : undefined;
          if (card) ui.selectCard(card.slot);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
