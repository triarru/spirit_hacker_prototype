import { BREAK_RULES } from '../core/combat/BreakSystem';
import { stanceOf } from '../core/entities/Enemy';
import { useCombatStore } from '../stores/useCombatStore';
import { selectFocusedEnemyId, useUIStore } from '../stores/useUIStore';
import { cssColor, TAG_COLOR } from '../theme';
import { BreakIndicator } from './BreakIndicator';
import { useLabels } from './labels';

/** The enemy under the pointer, or the one selected: what it is, how hurt, and how to break it. */
export function EnemyInfo() {
  const grid = useCombatStore((state) => state.grid);
  const enemies = useCombatStore((state) => state.enemies);
  const player = useCombatStore((state) => state.player);
  const busy = useCombatStore((state) => state.busy);
  const injectableEnemyIds = useCombatStore((state) => state.injectableEnemyIds);
  const injectVirus = useCombatStore((state) => state.injectVirus);
  const hoveredHex = useUIStore((state) => state.hoveredHex);
  const selectedEntityId = useUIStore((state) => state.selectedEntityId);
  const labels = useLabels();

  const focusedId = selectFocusedEnemyId({ grid }, { hoveredHex, selectedEntityId });
  const enemy = enemies.find((candidate) => candidate.id === focusedId);
  if (!enemy) return null;

  const statuses = [enemy.stunTurns > 0 && 'stunned', enemy.slowTurns > 0 && 'slowed'].filter(Boolean);
  const { apCost, ramCost, damage } = BREAK_RULES.injectVirus;
  // What the player will be asked to do when this enemy attacks.
  const reaction = enemy.attackType === 'melee' ? labels.parry : enemy.attackType === 'ranged' ? labels.dodge : '—';

  return (
    <section className="panel enemy-info">
      <h2>{labels.target}</h2>
      <strong className="enemy-name">{enemy.name}</strong>
      <p className="enemy-hint">{enemy.hint}</p>

      <span className="field-label">
        {labels.hp} <em>{enemy.hp} / {enemy.maxHp}</em>
      </span>
      <div className="bar" role="img" aria-label={`HP ${enemy.hp} of ${enemy.maxHp}`}>
        <div className="bar-fill bar-hp" style={{ width: `${(enemy.hp / enemy.maxHp) * 100}%` }} />
      </div>

      <span className="field-label">{labels.firewall}</span>
      {enemy.breached ? (
        <strong className="breached-label">{labels.breached}</strong>
      ) : (
        <BreakIndicator current={enemy.firewallCurrent} max={enemy.firewallMax} />
      )}

      <span className="field-label">{labels.weak}</span>
      <strong className="weakness-tag" style={{ color: cssColor(TAG_COLOR[enemy.weakness]) }}>
        {labels.tags[enemy.weakness]}
      </strong>

      <span className="field-label">{labels.react}</span>
      <strong className="reaction">{reaction}</strong>

      <dl>
        <dt>Behavior</dt>
        <dd className={enemy.aggressive ? 'stance-aggressive' : undefined}>{stanceOf(enemy)}</dd>
        <dt>Attack</dt>
        <dd>
          {enemy.attackDamage} {enemy.attackType} · {enemy.attackRange} hex
        </dd>
        <dt>Distance</dt>
        <dd>{player.position.distance(enemy.position)} hex</dd>
        {statuses.length > 0 && (
          <>
            <dt>Status</dt>
            <dd>{statuses.join(', ')}</dd>
          </>
        )}
      </dl>
      {enemy.breached && enemy.virusInjected && <p className="virus-used">Virus injected</p>}
      {enemy.breached && !enemy.virusInjected && (
        <>
          <button
            type="button"
            className="action-button"
            disabled={busy || !injectableEnemyIds.includes(enemy.id)}
            onClick={() => injectVirus(enemy.id)}
          >
            Inject virus
            <span>
              {damage} dmg · {apCost} AP · {ramCost} RAM
            </span>
          </button>
          {enemy.id !== selectedEntityId && (
            <p className="hint">Right-click the enemy to keep this panel open.</p>
          )}
        </>
      )}
    </section>
  );
}
