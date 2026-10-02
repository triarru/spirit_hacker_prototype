import type { ActiveSpec } from '../core/programs/Program';
import type { UiMode } from '../stores/useUIStore';

/** The words a spell is described with, per HUD mode. */
const WORDS = {
  grid: {
    damage: (n: number) => `${n} dmg`,
    stun: (t: number) => `stun ${t}t`,
    slow: (t: number) => `slow ${t}t`,
    heal: (n: number) => `heal ${n}`,
    walls: (count: number, turns: number) => `${count} walls, ${turns}t`,
    splash: (n: number) => `splash ${n}`,
    firewall: (n: number) => `FW +${n}`,
    firewallOnly: 'firewall only',
    self: 'self',
    anyRange: 'any range',
    anyHex: 'any hex',
    line: (n: number) => `line ${n}`,
    range: (n: number) => `range ${n}`,
    free: 'free',
  },
  veil: {
    damage: (n: number) => `${n} sát thương`,
    stun: (t: number) => `phong ${t}t`,
    slow: (t: number) => `trì ${t}t`,
    heal: (n: number) => `hồi ${n}`,
    walls: (count: number, turns: number) => `${count} tường, ${turns}t`,
    splash: (n: number) => `lan ${n}`,
    firewall: (n: number) => `bùa +${n}`,
    firewallOnly: 'chỉ phá bùa',
    self: 'tự thân',
    anyRange: 'mọi tầm',
    anyHex: 'mọi ô',
    line: (n: number) => `tuyến ${n} ô`,
    range: (n: number) => `tầm ${n} ô`,
    free: 'miễn phí',
  },
} as const;

/** What a spell does, in a few words, read off the spec it will actually cast with. */
export function describeSpec(spec: ActiveSpec, mode: UiMode = 'grid'): string {
  const words = WORDS[mode];
  const parts: string[] = [];
  if (spec.damage > 0) parts.push(words.damage(spec.damage));
  for (const effect of spec.effects) {
    if (effect.type === 'stun') parts.push(words.stun(effect.turns));
    if (effect.type === 'slow') parts.push(words.slow(effect.turns));
    if (effect.type === 'heal') parts.push(words.heal(effect.amount));
    if (effect.type === 'createWall') parts.push(words.walls(effect.count, effect.turns));
  }
  if (spec.aoe > 0) parts.push(words.splash(spec.aoe));
  if (spec.firewallBonus > 0) parts.push(words.firewall(spec.firewallBonus));
  // Every hit strips firewall; say so when that is all the spell does.
  const hitsEnemies = spec.targeting === 'ENEMY' || spec.targeting === 'LINE';
  if (parts.length === 0 && hitsEnemies) parts.push(words.firewallOnly);

  if (spec.targeting === 'SELF') parts.push(words.self);
  else if (spec.range === null) parts.push(spec.targeting === 'ENEMY' ? words.anyRange : words.anyHex);
  else parts.push(spec.targeting === 'LINE' ? words.line(spec.range) : words.range(spec.range));
  return parts.join(' · ');
}

export function describeCost(spec: ActiveSpec): string {
  const costs = [`${spec.apCost} AP`];
  if (spec.ramCost > 0) costs.push(`${spec.ramCost} RAM`);
  if (spec.qiCost > 0) costs.push(`${spec.qiCost} Qi`);
  return costs.join(' · ');
}

/** The RAM and Qi a spell costs, without its AP: "15 ram", "15 qi", or both. */
export function describeResources(spec: ActiveSpec, units: { ram: string; qi: string }, mode: UiMode = 'grid'): string {
  const costs: string[] = [];
  if (spec.ramCost > 0) costs.push(`${spec.ramCost} ${units.ram}`);
  if (spec.qiCost > 0) costs.push(`${spec.qiCost} ${units.qi}`);
  return costs.length > 0 ? costs.join(' · ') : WORDS[mode].free;
}
