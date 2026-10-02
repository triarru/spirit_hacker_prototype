const CONTROLS: Array<[keys: string, action: string]> = [
  ['Click', 'move · attack an adjacent enemy'],
  ['Right-click', 'select an enemy · cancel'],
  ['1 2 3', 'pick a program, then click a hex'],
  ['H', 'hack a terminal, floor or wall'],
  ['E', 'end turn'],
  ['Space / Click', 'parry when the rings meet'],
  ['Arrows / WASD', 'press the arrow as the shot lands'],
  ['Scroll', 'zoom'],
  ['R', 'try again, once the fight is over'],
];

/** The input cheat sheet, for someone playing for the first time. */
export function Controls() {
  return (
    <section className="panel controls">
      <h2>Controls</h2>
      <dl>
        {CONTROLS.map(([keys, action]) => (
          <div key={keys}>
            <dt>{keys}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
