import { describe, expect, it } from 'vitest';
import { HexCoord } from '../hex/HexCoord';
import { createEnemy } from './Enemy';
import { createPlayer, PLAYER_DATA } from './Player';

describe('createPlayer', () => {
  const player = createPlayer(new HexCoord(0, 0));

  it('has RAM and Qi pools of 100, as in the GDD', () => {
    expect(player.maxRam).toBe(100);
    expect(player.maxQi).toBe(100);
  });

  it('starts the run with HP, RAM and Qi full', () => {
    expect([player.hp, player.ram, player.qi]).toEqual([player.maxHp, player.maxRam, player.maxQi]);
  });

  it('takes its starting resources from player.json, separately from the maximums', () => {
    expect([player.hp, player.ram, player.qi]).toEqual([PLAYER_DATA.hp, PLAYER_DATA.ram, PLAYER_DATA.qi]);
    expect(player.ramRegen).toBe(PLAYER_DATA.ramRegen);
  });

  it('starts with full AP and nothing banked', () => {
    expect([player.ap, player.apBank]).toEqual([PLAYER_DATA.maxAp, 0]);
  });
});

describe('createEnemy', () => {
  it('starts an enemy at full HP with its firewall intact', () => {
    const crawler = createEnemy('crawler', 'crawler_0', new HexCoord(1, 1));
    expect([crawler.hp, crawler.firewallCurrent, crawler.breached]).toEqual([
      crawler.maxHp,
      crawler.firewallMax,
      false,
    ]);
  });

  it('rejects an unknown enemy type', () => {
    expect(() => createEnemy('kernel_panic', 'x', new HexCoord(0, 0))).toThrow();
  });
});
