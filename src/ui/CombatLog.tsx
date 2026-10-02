import { useEffect, useRef } from 'react';
import { useCombatStore } from '../stores/useCombatStore';

/** A running record of the fight. Stays scrolled to the newest line. */
export function CombatLog() {
  const log = useCombatStore((state) => state.log);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [log]);

  return (
    <section className="combat-log" aria-label="Combat log">
      <ol ref={listRef}>
        {log.map((entry) => (
          <li key={entry.id} className={`log-${entry.tone}`}>
            {entry.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
