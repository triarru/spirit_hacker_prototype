import { inAttackRange } from '../entities/Enemy';
import type { Behavior, EnemyAction } from './EnemyAI';

/** Ghost Process: drifts to a random free neighbor, then fires if the player is in range. */
export const randomBehavior: Behavior = (enemy, { grid, player, rng }) => {
  const actions: EnemyAction[] = [];
  let position = enemy.position;

  for (let moved = 0; moved < enemy.moveRange; moved++) {
    const options = position.neighbors().filter((hex) => !grid.isBlocked(hex));
    const next = options[Math.min(Math.floor(rng() * options.length), options.length - 1)];
    if (!next) break;
    actions.push({ type: 'move', to: next });
    position = next;
  }

  if (inAttackRange(enemy, position, player.position)) {
    actions.push({ type: 'attack', targetId: player.id });
  }
  return actions;
};
