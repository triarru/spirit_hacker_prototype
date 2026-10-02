import { selectPlayer, useCombatStore } from '../stores/useCombatStore';
import { useUIStore } from '../stores/useUIStore';

export function EnemyInfo() {
  const selectedEntityId = useUIStore((state) => state.selectedEntityId);
  const entities = useCombatStore((state) => state.entities);
  const player = useCombatStore(selectPlayer);

  const enemy = entities.find((entity) => entity.id === selectedEntityId && entity.kind === 'enemy');
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
