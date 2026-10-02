import breakJson from '../data/break.json';
import type { Enemy } from '../entities/Enemy';
import type { SpellTag } from '../programs/Program';

/** Break rules, straight from break.json. */
export const BREAK_RULES = breakJson;

/** Firewall bars a hit strips: more when its tag is the enemy's weakness. `null` is an untagged hit. */
export function firewallDamageForHit(enemy: Enemy, tag: SpellTag | null): number {
  return tag === enemy.weakness
    ? BREAK_RULES.weaknessHitFirewallDamage
    : BREAK_RULES.normalHitFirewallDamage;
}

/**
 * Strips firewall from an enemy. Returns true when this is the hit that broke
 * through, which puts the enemy in the BREACHED state. An enemy that is
 * already breached has no firewall left to strip.
 */
export function damageFirewall(enemy: Enemy, amount: number): boolean {
  if (enemy.breached || amount <= 0) return false;

  enemy.firewallCurrent = Math.max(0, enemy.firewallCurrent - amount);
  if (enemy.firewallCurrent > 0) return false;

  enemy.breached = true;
  enemy.breachSkipsLeft = BREAK_RULES.breachSkippedTurns;
  return true;
}

/** Damage taken is multiplied by this: above 1 while the enemy is breached. */
export function breachDamageMultiplier(enemy: Enemy): number {
  return enemy.breached ? BREAK_RULES.breachDamageMultiplier : 1;
}

export type BreachTick = 'not_breached' | 'skip_turn' | 'recovered';

/**
 * Advances the breach as the enemy's turn comes up. A breached enemy loses
 * its next turn(s) and stays breached through the player turn that follows;
 * on the turn after that it recovers with a slightly weaker firewall, and acts.
 */
export function tickBreach(enemy: Enemy): BreachTick {
  if (!enemy.breached) return 'not_breached';

  if (enemy.breachSkipsLeft > 0) {
    enemy.breachSkipsLeft -= 1;
    return 'skip_turn';
  }

  enemy.breached = false;
  // Never restore to 0, or an enemy with a 1-bar firewall would be breached forever.
  enemy.firewallCurrent = Math.max(1, enemy.firewallMax - BREAK_RULES.recoveryFirewallPenalty);
  return 'recovered';
}
