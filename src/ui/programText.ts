import type { ActiveSpec } from '../core/programs/Program';

/** What a spell does, in a few words, read off the spec it will actually cast with. */
export function describeSpec(spec: ActiveSpec): string {
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
  else if (spec.range === null) parts.push(spec.targeting === 'ENEMY' ? 'any range' : 'any hex');
  else parts.push(`${spec.targeting === 'LINE' ? 'line' : 'range'} ${spec.range}`);
  return parts.join(' · ');
}

export function describeCost(spec: ActiveSpec): string {
  const costs = [`${spec.apCost} AP`];
  if (spec.ramCost > 0) costs.push(`${spec.ramCost} RAM`);
  if (spec.qiCost > 0) costs.push(`${spec.qiCost} Qi`);
  return costs.join(' · ');
}
