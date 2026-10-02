import type {
  DefenseInput,
  DefenseResult,
  ReactiveDefense,
} from '../core/combat/ReactiveDefense';

const KEY_INPUTS: Record<string, DefenseInput> = {
  Space: { kind: 'parry' },
  ArrowUp: { kind: 'dodge', direction: 'up' },
  ArrowDown: { kind: 'dodge', direction: 'down' },
  ArrowLeft: { kind: 'dodge', direction: 'left' },
  ArrowRight: { kind: 'dodge', direction: 'right' },
  KeyW: { kind: 'dodge', direction: 'up' },
  KeyS: { kind: 'dodge', direction: 'down' },
  KeyA: { kind: 'dodge', direction: 'left' },
  KeyD: { kind: 'dodge', direction: 'right' },
};

/**
 * Plays one reactive-defense prompt to its result. This is the real-time part
 * of an otherwise turn-based game, so it runs its own requestAnimationFrame
 * loop and input listeners, which exist only while the prompt is on screen.
 *
 * The frame loop only moves the session's clock (for drawing and for the
 * timeout). Inputs are timed by their own event timestamps, so a parry is
 * judged on when the key went down, not on which frame noticed it.
 */
export function runReactivePrompt(session: ReactiveDefense): Promise<DefenseResult> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const secondsSince = (timestamp: number): number => (timestamp - startedAt) / 1000;
    let frame = 0;

    const finishIfDecided = (): void => {
      if (!session.result) return;
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      resolve(session.result);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const input = KEY_INPUTS[event.code];
      if (!input) return;
      // Keep Space from scrolling the page or pressing a focused button.
      event.preventDefault();
      // A key held since before the prompt appeared is not a reaction to it.
      if (event.repeat) return;
      session.handleInput(input, secondsSince(event.timeStamp));
      finishIfDecided();
    };

    const onPointerDown = (event: PointerEvent): void => {
      session.handleInput({ kind: 'parry' }, secondsSince(event.timeStamp));
      finishIfDecided();
    };

    const onFrame = (now: number): void => {
      session.advanceTo(secondsSince(now));
      if (session.result) finishIfDecided();
      else frame = requestAnimationFrame(onFrame);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    frame = requestAnimationFrame(onFrame);
  });
}
