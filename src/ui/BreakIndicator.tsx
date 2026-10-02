interface BreakIndicatorProps {
  current: number;
  max: number;
}

/** Firewall integrity as a row of pips: filled is intact. */
export function BreakIndicator({ current, max }: BreakIndicatorProps) {
  return (
    <div className="firewall-pips" role="img" aria-label={`Firewall ${current} of ${max}`}>
      {Array.from({ length: max }, (_, index) => (
        <span key={index} className={`firewall-pip${index < current ? ' firewall-pip-intact' : ''}`} />
      ))}
    </div>
  );
}
