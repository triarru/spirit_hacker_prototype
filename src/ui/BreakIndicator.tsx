import type { SpellTag } from '../core/programs/Program';
import { cssColor, TAG_COLOR } from '../theme';

interface BreakIndicatorProps {
  current: number;
  max: number;
  weakness: SpellTag;
  breached: boolean;
}

/** Firewall integrity as a row of pips (filled = intact), with the tag that breaks it fastest. */
export function BreakIndicator({ current, max, weakness, breached }: BreakIndicatorProps) {
  return (
    <div className="break-indicator">
      <div className="firewall-pips" role="img" aria-label={`Firewall ${current} of ${max}`}>
        {Array.from({ length: max }, (_, index) => (
          <span
            key={index}
            className={`firewall-pip${index < current ? ' firewall-pip-intact' : ''}`}
          />
        ))}
      </div>
      {breached ? (
        <strong className="breached-label">Breached</strong>
      ) : (
        <span className="weakness-tag" style={{ color: cssColor(TAG_COLOR[weakness]) }}>
          weak: {weakness}
        </span>
      )}
    </div>
  );
}
