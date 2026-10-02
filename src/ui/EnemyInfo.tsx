import { BREAK_RULES } from '../core/combat/BreakSystem';
import { stanceOf } from '../core/entities/Enemy';
import { useCombatStore } from '../stores/useCombatStore';
import { selectFocusedEnemyId, useUIStore } from '../stores/useUIStore';
import { BreakIndicator } from './BreakIndicator';

export function EnemyInfo() {
  const grid = useCombatStore((state) => state.grid);
  const enemies = useCombatStore((state) => state.enemies);
  const player = useCombatStore((state) => state.player);
  const busy = useCombatStore((state) => state.busy);
  const injectableEnemyIds = useCombatStore((state) => state.injectableEnemyIds);
  const injectVirus = useCombatStore((state) => state.injectVirus);
  const hoveredHex = useUIStore((state) => state.hoveredHex);
  const selectedEntityId = useUIStore((state) => state.selectedEntityId);

  const focusedId = selectFocusedEnemyId({ grid }, { hoveredHex, selectedEntityId });
  const enemy = enemies.find((candidate) => candidate.id === focusedId);
  if (!enemy) return null;

  const statuses = [enemy.stunTurns > 0 && 'stunned', enemy.slowTurns > 0 && 'slowed'].filter(Boolean);
  const { apCost, ramCost } = BREAK_RULES.injectVirus;

  return (
    <section className="panel enemy-info">
      <h2>{enemy.name}</h2>
      <p className="enemy-hint">{enemy.hint}</p>
      <div className="bar" role="img" aria-label={`HP ${enemy.hp} of ${enemy.maxHp}`}>
        <div className="bar-fill bar-hp" style={{ width: `${(enemy.hp / enemy.maxHp) * 100}%` }} />
      </div>
      <BreakIndicator
        current={enemy.firewallCurrent}
        max={enemy.firewallMax}
        weakness={enemy.weakness}
        breached={enemy.breached}
      />
      <dl>
        <dt>HP</dt>
        <dd>
          {enemy.hp} / {enemy.maxHp}
        </dd>
        <dt>Behavior</dt>
        <dd className={enemy.aggressive ? 'stance-aggressive' : undefined}>{stanceOf(enemy)}</dd>
        <dt>Attack</dt>
        <dd>
          {enemy.attackDamage} {enemy.attackType}
        </dd>
        <dt>Range</dt>
        <dd>{enemy.attackRange} hex</dd>
        <dt>Speed</dt>
        <dd>{enemy.speed}</dd>
        <dt>Distance</dt>
        <dd>{player.position.distance(enemy.position)} hex</dd>
        {statuses.length > 0 && (
          <>
            <dt>Status</dt>
            <dd>{statuses.join(', ')}</dd>
          </>
        )}
      </dl>
      {enemy.breached && (
        <>
          <button
            type="button"
            className="action-button"
            disabled={busy || !injectableEnemyIds.includes(enemy.id)}
            onClick={() => injectVirus(enemy.id)}
          >
            Inject virus
            <span>
              {apCost} AP · {ramCost} RAM
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
