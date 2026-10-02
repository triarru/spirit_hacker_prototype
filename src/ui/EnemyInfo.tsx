import { useCombatStore } from '../stores/useCombatStore';
import { selectFocusedEnemyId, useUIStore } from '../stores/useUIStore';

export function EnemyInfo() {
  const grid = useCombatStore((state) => state.grid);
  const enemies = useCombatStore((state) => state.enemies);
  const player = useCombatStore((state) => state.player);
  const hoveredHex = useUIStore((state) => state.hoveredHex);
  const selectedEntityId = useUIStore((state) => state.selectedEntityId);

  const focusedId = selectFocusedEnemyId({ grid }, { hoveredHex, selectedEntityId });
  const enemy = enemies.find((candidate) => candidate.id === focusedId);
  if (!enemy) return null;

  const { col, row } = enemy.position.toOffset();

  return (
    <section className="panel enemy-info">
      <h2>{enemy.name}</h2>
      <div className="bar" role="img" aria-label={`HP ${enemy.hp} of ${enemy.maxHp}`}>
        <div className="bar-fill bar-hp" style={{ width: `${(enemy.hp / enemy.maxHp) * 100}%` }} />
      </div>
      <dl>
        <dt>HP</dt>
        <dd>
          {enemy.hp} / {enemy.maxHp}
        </dd>
        <dt>Speed</dt>
        <dd>{enemy.speed}</dd>
        <dt>Position</dt>
        <dd>
          col {col}, row {row}
        </dd>
        <dt>Distance</dt>
        <dd>{player.position.distance(enemy.position)} hex</dd>
      </dl>
    </section>
  );
}
