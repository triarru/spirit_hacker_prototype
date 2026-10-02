import type { SpellTag } from '../core/programs/Program';
import { useUIStore, type UiMode } from '../stores/useUIStore';

/** Every word the HUD shows that depends on which face of the world is being looked at. */
export interface Labels {
  modeTitle: string;
  /** Shown on the button that switches to the other mode. */
  switchTo: string;
  playerTurn: string;
  enemyTurn: string;
  turn: string;
  bank: string;
  move: string;
  cast: string;
  hack: string;
  end: string;
  help: string;
  target: string;
  hp: string;
  firewall: string;
  weak: string;
  react: string;
  parry: string;
  dodge: string;
  breached: string;
  passives: string;
  /** Unit after an AP cost on a card; empty to show the number alone. */
  ap: string;
  ram: string;
  qi: string;
  tags: Record<SpellTag, string>;
}

/**
 * The same HUD in two voices: the machine's (code names, English) and the
 * spirit world's (given names, Vietnamese). The switch is cosmetic: the rules
 * are the same in both.
 */
export const LABELS: Record<UiMode, Labels> = {
  grid: {
    modeTitle: '// GRID MODE',
    switchTo: 'veil',
    playerTurn: 'PLAYER_TURN',
    enemyTurn: 'ENEMY_TURN',
    turn: 'turn',
    bank: 'bank',
    move: 'move',
    cast: 'cast',
    hack: 'hack',
    end: 'end',
    help: 'controls',
    target: 'target',
    hp: 'hp',
    firewall: 'firewall',
    weak: 'weak',
    react: 'react',
    parry: 'parry',
    dodge: 'dodge',
    breached: 'breached',
    passives: 'passive',
    ap: 'ap',
    ram: 'ram',
    qi: 'qi',
    tags: { FIRE: 'FIRE', ICE: 'ICE', SHOCK: 'SHOCK', CORRUPT: 'CORRUPT', PURE: 'PURE' },
  },
  veil: {
    modeTitle: '~ VEIL MODE ~',
    switchTo: 'grid',
    playerTurn: 'Lượt Người Chơi',
    enemyTurn: 'Lượt Kẻ Địch',
    turn: 'lượt',
    bank: 'tích',
    move: 'bước',
    cast: 'thi',
    hack: 'phá',
    end: 'chờ',
    help: 'chỉ dẫn',
    target: 'cảm ứng',
    hp: 'sinh khí',
    firewall: 'bùa hộ',
    weak: 'yếu huyệt',
    react: 'phản',
    parry: 'đỡ',
    dodge: 'né',
    breached: 'phá giới',
    passives: 'nội công',
    ap: '',
    ram: 'khí',
    qi: 'qi',
    tags: { FIRE: 'Hỏa', ICE: 'Băng', SHOCK: 'Lôi', CORRUPT: 'Uế', PURE: 'Tịnh' },
  },
};

export function useLabels(): Labels {
  return LABELS[useUIStore((state) => state.mode)];
}
