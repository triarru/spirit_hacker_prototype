import type { HandCard } from '../core/combat/CombatManager';
import { HACK_RULES } from '../core/combat/EnvironmentHack';
import { useCombatStore } from '../stores/useCombatStore';
import { useUIStore } from '../stores/useUIStore';
import { cssColor, TAG_COLOR } from '../theme';
import { useLabels } from './labels';
import { describeResources, describeSpec } from './programText';

const HACK_HINT =
  `Hack: terminal → turret (${HACK_RULES.turret.ramCost} RAM) · ` +
  `floor → trap (${HACK_RULES.trap.ramCost}) or wall (${HACK_RULES.wall.ramCost}) · ` +
  `wall → break (${HACK_RULES.breakWall.ramCost}) · Esc to cancel`;

interface SpellCardProps {
  card: HandCard;
  hotkey: number;
  selected: boolean;
  disabled: boolean;
  onPick: () => void;
}

function SpellCard({ card, hotkey, selected, disabled, onPick }: SpellCardProps) {
  const { program, modifier, spec } = card;
  const mode = useUIStore((state) => state.mode);
  const labels = useLabels();
  return (
    <button
      type="button"
      className={`spell-card${selected ? ' spell-card-selected' : ''}`}
      style={{ '--tag': cssColor(TAG_COLOR[spec.tag]) } as React.CSSProperties}
      disabled={disabled}
      onClick={(event) => {
        // Leave focus off the card, so Space (the parry key) cannot re-trigger it.
        event.currentTarget.blur();
        onPick();
      }}
    >
      <span className="spell-card-ap">
        {spec.apCost} {labels.ap}
      </span>
      <span className="spell-card-head">
        <kbd>{hotkey}</kbd>
        {/* The machine calls it by its function name; the spirit world by its given name. */}
        <strong>{mode === 'grid' ? program.name : program.displayName}</strong>
      </span>
      <span className="spell-card-effect">{describeSpec(spec, mode)}</span>
      <span className="spell-card-foot">
        <span className="spell-card-cost">{describeResources(spec, labels, mode)}</span>
        <em className="spell-card-tag">{labels.tags[spec.tag]}</em>
      </span>
      {modifier && (
        <span className="spell-card-modifier" title={modifier.modifier.description}>
          +{mode === 'grid' ? modifier.name : modifier.displayName}
        </span>
      )}
    </button>
  );
}

/** The hand: this turn's cards. Pick one, then click a highlighted hex to cast it. */
export function SpellBar() {
  const hand = useCombatStore((state) => state.hand);
  const canAct = useCombatStore((state) => state.phase === 'PLAYER_TURN' && !state.busy);
  const inFight = useCombatStore(
    (state) => state.phase === 'PLAYER_TURN' || state.phase === 'ENEMY_TURN',
  );
  const targetingSlot = useUIStore((state) => state.targetingSlot);
  // A wall can be turned before it is placed; say so only while one is being aimed.
  const aimingWall = hand.some(
    (card) => card.slot === targetingSlot && card.spec.effects.some((effect) => effect.type === 'createWall'),
  );
  const hackMode = useUIStore((state) => state.hackMode);
  const selectCard = useUIStore((state) => state.selectCard);

  if (!inFight) return null;

  return (
    <div className="spell-bar">
      <p className="spell-bar-hint">
        {hackMode
          ? HACK_HINT
          : targetingSlot !== null
            ? `Click a highlighted hex to cast${aimingWall ? ' · R to rotate the wall' : ''} · Esc or right-click to cancel`
            : hand.length > 0
              ? 'Pick a program'
              : 'No programs left this turn'}
      </p>
      <div className="spell-cards">
        {hand.map((card, index) => (
          <SpellCard
            key={card.slot}
            card={card}
            hotkey={index + 1}
            selected={card.slot === targetingSlot}
            disabled={!canAct || !card.affordable}
            onPick={() => selectCard(card.slot)}
          />
        ))}
      </div>
    </div>
  );
}
