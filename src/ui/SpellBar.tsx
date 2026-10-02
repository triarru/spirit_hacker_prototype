import { useEffect } from 'react';
import type { HandCard } from '../core/combat/CombatManager';
import { HACK_RULES } from '../core/combat/EnvironmentHack';
import type { ActiveSpec } from '../core/programs/Program';
import { useCombatStore } from '../stores/useCombatStore';
import { useUIStore } from '../stores/useUIStore';
import { cssColor, TAG_COLOR } from '../theme';

/** What the spell does, in a few words, read off the spec it will actually cast with. */
function describeSpec(spec: ActiveSpec): string {
  const parts: string[] = [];
  if (spec.damage > 0) parts.push(`${spec.damage} dmg`);
  for (const effect of spec.effects) {
    if (effect.type === 'stun') parts.push(`stun ${effect.turns}t`);
    if (effect.type === 'heal') parts.push(`heal ${effect.amount}`);
    if (effect.type === 'createWall') parts.push(`${effect.count} walls, ${effect.turns}t`);
  }
  if (spec.aoe > 0) parts.push(`splash ${spec.aoe}`);
  if (spec.firewallBonus > 0) parts.push(`FW +${spec.firewallBonus}`);

  if (spec.targeting === 'SELF') parts.push('self');
  else if (spec.range === null) parts.push('any hex');
  else parts.push(`${spec.targeting === 'LINE' ? 'line' : 'range'} ${spec.range}`);
  return parts.join(' · ');
}

function describeCost(spec: ActiveSpec): string {
  const costs = [`${spec.apCost} AP`];
  if (spec.ramCost > 0) costs.push(`${spec.ramCost} RAM`);
  if (spec.qiCost > 0) costs.push(`${spec.qiCost} Qi`);
  return costs.join(' · ');
}

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
  return (
    <button
      type="button"
      className={`spell-card${selected ? ' spell-card-selected' : ''}`}
      style={{ '--tag': cssColor(TAG_COLOR[program.tag]) } as React.CSSProperties}
      disabled={disabled}
      onClick={(event) => {
        // Leave focus off the card, so Space (the parry key) cannot re-trigger it.
        event.currentTarget.blur();
        onPick();
      }}
    >
      <span className="spell-card-head">
        <strong>{program.displayName}</strong>
        <kbd>{hotkey}</kbd>
      </span>
      <span className="spell-card-name">
        {program.name} <em>{program.tag}</em>
      </span>
      <span className="spell-card-effect">{describeSpec(spec)}</span>
      <span className="spell-card-cost">{describeCost(spec)}</span>
      {modifier && (
        <span className="spell-card-modifier" title={modifier.modifier.description}>
          + {modifier.name} {modifier.modifier.description}
        </span>
      )}
    </button>
  );
}

/** The hand: this turn's cards. Pick one, then click a highlighted hex to cast it. */
export function SpellBar() {
  const hand = useCombatStore((state) => state.hand);
  const canAct = useCombatStore((state) => state.phase === 'PLAYER_TURN' && !state.busy);
  const combatOver = useCombatStore((state) => state.phase === 'VICTORY' || state.phase === 'DEFEAT');
  const targetingSlot = useUIStore((state) => state.targetingSlot);
  const hackMode = useUIStore((state) => state.hackMode);
  const selectCard = useUIStore((state) => state.selectCard);
  const toggleHackMode = useUIStore((state) => state.toggleHackMode);
  const cancelAction = useUIStore((state) => state.cancelAction);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Escape') {
        cancelAction();
        return;
      }
      if (event.code === 'KeyH' && !event.repeat) {
        toggleHackMode();
        return;
      }
      // Digit1..Digit9 pick the card in that position of the hand.
      const match = /^Digit([1-9])$/.exec(event.code);
      const card = match ? useCombatStore.getState().hand[Number(match[1]) - 1] : undefined;
      if (card && !event.repeat) selectCard(card.slot);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelAction, selectCard, toggleHackMode]);

  if (combatOver) return null;

  return (
    <div className="spell-bar">
      <p className="spell-bar-hint">
        {hackMode
          ? HACK_HINT
          : targetingSlot !== null
            ? 'Click a highlighted hex to cast · Esc or right-click to cancel'
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
