# Spirit Hacker — Web Prototype Implementation Plan

> File này dùng cho Claude Code. Đọc kỹ trước khi code bất kỳ phần nào.
> Mục tiêu: prototype web chơi được 1 encounter hoàn chỉnh, validate core gameplay.

---

## Tech Stack

- **Runtime**: Vite + React 19 + TypeScript 5
- **Rendering**: PixiJS 8 (Canvas 2D) cho game world
- **UI Overlay**: React DOM overlay cho HUD, spell bar, menu
- **State**: Zustand cho game state (combat, inventory, deck)
- **Deploy**: Vercel / Netlify (static build)

## Cấu trúc thư mục

```
spirit-hacker-prototype/
├── public/
│   └── assets/            # placeholder sprites (geometric shapes)
├── src/
│   ├── main.tsx           # React entry point
│   ├── App.tsx            # Layout: PixiJS canvas + React UI overlay
│   │
│   ├── core/              # Game logic thuần TS, không phụ thuộc React/Pixi
│   │   ├── hex/
│   │   │   ├── HexCoord.ts        # Cube coordinate (q, r, s), distance, neighbors
│   │   │   ├── HexGrid.ts         # Grid state, cell data, blocked check
│   │   │   ├── HexPathfinding.ts  # A* trên hex grid
│   │   │   └── HexFOV.ts          # Shadow casting cho fog of war
│   │   │
│   │   ├── combat/
│   │   │   ├── CombatManager.ts       # State machine: PLAYER_TURN → ENEMY_TURN → CHECK
│   │   │   ├── TurnManager.ts         # Turn order (speed-based), AP tracking, AP bank
│   │   │   ├── CombatResolver.ts      # Damage calc, effect apply, Break check
│   │   │   ├── ReactiveDefense.ts     # Parry/Dodge/Counter prompt logic + timing
│   │   │   ├── BreakSystem.ts         # Firewall Integrity tracking, Breach state
│   │   │   └── EnvironmentHack.ts     # Hex hack logic: turret, trap, wall, portal
│   │   │
│   │   ├── entities/
│   │   │   ├── Entity.ts          # Base: position, hp, stats, firewall
│   │   │   ├── Player.ts          # Player state: AP, RAM, Qi, spell deck
│   │   │   └── Enemy.ts           # Enemy state + AI behavior type
│   │   │
│   │   ├── programs/
│   │   │   ├── Program.ts         # Program definition: active/modifier/passive
│   │   │   ├── ProgramRegistry.ts # Tất cả program data (JSON-like registry)
│   │   │   └── SpellDeck.ts       # Deck management: active slot, modifier, passive
│   │   │
│   │   ├── ai/
│   │   │   ├── EnemyAI.ts         # AI dispatcher theo behavior type
│   │   │   ├── PatrolBehavior.ts  # Crawler: move along path, aggro in range
│   │   │   ├── GuardBehavior.ts   # Guardian: hold position, counter melee
│   │   │   └── RandomBehavior.ts  # Ghost Process: random move, target nearest
│   │   │
│   │   └── data/
│   │       ├── programs.json      # Program definitions (starter set)
│   │       ├── enemies.json       # Enemy stat definitions
│   │       └── rooms.json         # Hardcoded room layout cho prototype
│   │
│   ├── renderer/           # PixiJS rendering layer
│   │   ├── GameCanvas.tsx         # PixiJS Application wrapper (React component)
│   │   ├── HexGridRenderer.ts    # Vẽ hex grid, highlight, fog
│   │   ├── EntityRenderer.ts     # Vẽ entity (placeholder shapes)
│   │   ├── EffectRenderer.ts     # Spell VFX, hack VFX (simple particles)
│   │   ├── ReactivePrompt.ts     # Render parry/dodge/counter prompt trên canvas
│   │   └── PreviewRenderer.ts    # Hiển thị move range, spell range, AoE preview
│   │
│   ├── ui/                 # React overlay components
│   │   ├── HUD.tsx                # HP bar, RAM bar, Qi bar, AP dots
│   │   ├── SpellBar.tsx           # 3 spell hand + modifier indicator
│   │   ├── ActionMenu.tsx         # Context menu: move/cast/hack/interact
│   │   ├── EnemyInfo.tsx          # Enemy hover panel: HP, Firewall, weakness
│   │   ├── BreakIndicator.tsx     # Firewall bar UI trên enemy
│   │   ├── TurnIndicator.tsx      # "Your Turn" / "Enemy Turn" indicator
│   │   ├── CombatLog.tsx          # Text log các action đã xảy ra
│   │   └── GameOverScreen.tsx     # Win/Lose screen
│   │
│   └── stores/
│       ├── useCombatStore.ts      # Zustand: combat state, current turn, AP
│       ├── usePlayerStore.ts      # Zustand: player stats, deck, inventory
│       └── useUIStore.ts          # Zustand: selected hex, hover info, menu state
│
├── package.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

---

## Thứ tự Implementation (theo milestone)

### Milestone 0: Project Setup
- [ ] Scaffold Vite + React + TypeScript
- [ ] Cài dependencies: pixi.js@8, zustand, @pixi/react (nếu cần)
- [ ] Setup folder structure theo trên
- [ ] Verify: blank page với PixiJS canvas render + React overlay

### Milestone 1: Hex Grid (ưu tiên cao nhất)
Đây là foundation — mọi thứ build trên hex grid.

- [ ] `HexCoord.ts` — cube coordinates (q, r, s), constraint q+r+s=0
  - Methods: `distance()`, `neighbors()`, `hexesInRange(n)`, `lineTo(target)`
  - Convert: `hexToPixel()`, `pixelToHex()` (flat-top hex layout)
  - Hex size: 40px radius

- [ ] `HexGrid.ts` — grid state
  - Grid size: 7 columns × 9 rows
  - Cell data: `{ hex: HexCoord, terrain: TerrainType, entity: Entity | null, hacked: HackType | null }`
  - TerrainType: `FLOOR | WALL | TERMINAL | VEIL_TEAR | OBSTACLE`
  - Methods: `isWalkable()`, `isBlocked()`, `getEntityAt()`, `setEntityAt()`

- [ ] `HexGridRenderer.ts` — vẽ grid bằng PixiJS
  - Vẽ hex outlines (stroke, không fill background)
  - Color code terrain: wall = dark gray, terminal = cyan outline, veil_tear = purple
  - Highlight hex khi hover (light outline)
  - Highlight moveable range khi player turn (green tint)
  - Highlight spell range khi chọn spell (orange tint)

- [ ] `HexPathfinding.ts` — A* trên hex
  - Heuristic: hex distance (cube distance / 2)
  - Neighbor function: 6 hex directions
  - Block: wall, obstacle, entity (enemy blocks path)
  - Return: Array<HexCoord> path

- [ ] Click interaction:
  - Click hex → highlight path từ player → hex đó
  - Click hex có enemy → show enemy info

**Verify**: hex grid hiển thị, click hex highlight, pathfinding hoạt động visual.

### Milestone 2: Entity + Movement
- [ ] `Entity.ts` — base class
  - Properties: `id, position: HexCoord, hp, maxHp, speed`
  - Player thêm: `ap, maxAp, ram, maxRam, qi, maxQi, apBank`
  - Enemy thêm: `firewallMax, firewallCurrent, weakness: SpellTag, behaviorType, attackType: 'melee' | 'ranged' | 'aoe'`

- [ ] `EntityRenderer.ts` — placeholder art
  - Player: blue circle (24px radius) với white border
  - Crawler: red triangle
  - Guardian: red square
  - Ghost Process: red diamond, semi-transparent

- [ ] Player movement:
  - Player turn: click hex trong move range → animate player di chuyển dọc path
  - AP cost: 1 per hex (FLOOR), 2 per hex (VEIL_TEAR)
  - Animation: tween position 0.15s per hex
  - Sau move: trừ AP, update grid, re-render range

- [ ] Spawn entities từ `rooms.json`:
  - 1 hardcoded room layout: player start position, 3 enemy positions, vài wall, 2 terminal, 1 veil_tear

**Verify**: player di chuyển trên grid, tốn AP, enemy đứng yên hiển thị đúng.

### Milestone 3: Turn System + Basic Combat
- [ ] `CombatManager.ts` — state machine
  ```
  PLAYER_TURN → ENEMY_TURN → CHECK_END → loop
  ```
  - PLAYER_TURN: enable input, show AP, wait for actions
  - ENEMY_TURN: disable input, run AI sequentially, wait for reactive defense
  - CHECK_END: all enemy dead? player dead? continue?

- [ ] `TurnManager.ts`
  - Turn order: sort entities by speed (high first), player priority on tie
  - AP: player starts each turn with 3 + apBank (max 5 total)
  - apBank resets nếu không dùng trong turn này
  - End Turn button: skip remaining AP, +15% dodge passive

- [ ] Basic attack:
  - Tạm thời: click enemy trong range 1 → deal 10 damage → tốn 1 AP
  - Show damage number popup (float up, fade out)
  - Enemy HP bar update

- [ ] Enemy AI basic:
  - `PatrolBehavior`: di chuyển 1 hex hướng player, nếu adjacent → attack player (10 damage)
  - `GuardBehavior`: không di chuyển, nếu player adjacent → attack (15 damage)
  - `RandomBehavior`: di chuyển random 1 hex, nếu player trong range 2 → ranged attack (8 damage)

- [ ] Combat end:
  - All enemy dead → show "CLEARED" message
  - Player HP ≤ 0 → show "SYSTEM FORMATTED" game over

**Verify**: player và enemy thay phiên hành động, đánh nhau cơ bản, combat kết thúc đúng.

### Milestone 4: Reactive Defense
- [ ] `ReactiveDefense.ts` — timing system
  - Khi enemy attack → pause AI sequence → show prompt → wait for input → resolve → continue AI

- [ ] Parry prompt (melee attack — Crawler, Guardian):
  - Visual: vòng tròn co lại trên canvas (outer ring shrinks toward inner ring)
  - Duration: 1.2s total, perfect window: 0.15s khi 2 ring trùng
  - Input: nhấn Space hoặc click
  - Perfect Parry: block 100% damage + apBank += 1 + enemy firewall -= 1
  - Good Parry (±0.15s từ perfect): block 50% damage
  - Miss: full damage

- [ ] Dodge prompt (ranged attack — Ghost Process):
  - Visual: arrow indicator từ enemy → player, chỉ hướng projectile
  - Duration: 0.8s
  - Input: nhấn arrow key ngược hướng projectile (hoặc WASD)
  - Perfect Dodge: 0 damage + player teleport 1 hex (reposition miễn phí)
  - Miss: full damage

- [ ] Expedition Counter (AoE — boss/elite, chưa implement cho prototype):
  - Skip cho prototype, thêm khi có elite enemy

**Verify**: mỗi enemy attack có prompt, timing satisfying, parry cho AP bank.

### Milestone 5: Break System (Firewall Integrity)
- [ ] `BreakSystem.ts`
  - Mỗi enemy có `firewallCurrent` / `firewallMax`
  - Hit bình thường: -1 vạch
  - Hit đúng weakness tag: -2 vạch
  - Perfect Parry reflect: -1 vạch
  - Trap/Turret hit: -1 vạch

- [ ] `BreakIndicator.tsx` — UI
  - Dưới enemy HP bar: hàng ô vuông nhỏ biểu diễn Firewall vạch
  - Filled = intact, Empty = broken
  - Weakness icon nhỏ bên cạnh (tag icon)

- [ ] Breach state:
  - Firewall = 0 → enemy status = BREACHED
  - BREACHED: skip enemy turn (stunned), nhận x1.5 damage
  - Visual: enemy flash white, "BREACHED!" text popup
  - Sau 1 turn: firewall reset = firewallMax - 1

- [ ] Hack Enemy (khi BREACHED):
  - Click BREACHED enemy → option "Inject Virus" (1 AP, 15 RAM)
  - Enemy tấn công ally gần nhất 1 lần (hoặc di chuyển theo hướng player chọn)

**Verify**: firewall giảm khi hit, breach trigger stun, hack enemy hoạt động.

### Milestone 6: Program System (Triple-Slot)
- [ ] `Program.ts` — data structure
  ```typescript
  interface Program {
    id: string;
    name: string;
    displayName: string;     // Vietnamese name
    tag: SpellTag;           // FIRE | ICE | SHOCK | CORRUPT | PURE
    tier: 1 | 2 | 3;
    resourceType: 'RAM' | 'QI' | 'HYBRID';
    active: {
      apCost: number;
      ramCost: number;
      qiCost: number;
      range: number;
      aoe: number;           // 0 = single target
      damage: number;
      effects: Effect[];
    };
    modifier: {
      description: string;
      modifyFn: string;      // key to modifier function
    };
    passive: {
      description: string;
      passiveFn: string;     // key to passive function
    };
  }
  ```

- [ ] `SpellDeck.ts`
  - 4 Active slots (mỗi slot 1 Program)
  - Mỗi Active slot có 1 Modifier sub-slot
  - 2 Passive slots riêng
  - Mỗi turn: random rút 3 từ 4 Active vào hand
  - Cast: chọn từ hand, chọn target hex, execute

- [ ] `SpellBar.tsx` — UI
  - 3 card hand ở bottom center
  - Mỗi card: tên, AP cost, resource cost, tag color
  - Modifier chip nhỏ gắn góc card (nếu có)
  - Passive icon bar ở sidebar
  - Click card → enter targeting mode (highlight valid target hexes)
  - Click valid hex → cast

- [ ] Starter Programs cho prototype (6 programs):
  ```
  brute_force()  — Attack, RAM, damage 20, range 1, single target
  ping_flood()   — Attack, RAM, damage 12, range 3, line 3 hex
  firewall_up()  — Defense, RAM, tạo 2 hex wall, range 2
  incense_burn() — Spirit, QI, heal 15HP + reveal fog 3 hex
  tran_yem()     — Seal, QI, stun 1 turn, range 2, single target
  nmap_scan()    — Utility, RAM, reveal fog 6 hex, range unlimited
  ```

- [ ] Modifier + Passive behavior cho mỗi program (implement dưới dạng function map)

- [ ] Spell targeting:
  - Single target: highlight 1 hex
  - Line: highlight line từ player → direction
  - AoE: highlight area
  - Preview: show damage number trước khi confirm

**Verify**: chọn spell từ hand, target, cast, damage apply, modifier effect hoạt động.

### Milestone 7: Environmental Hacking
- [ ] `EnvironmentHack.ts`
  - Hack action: 1 AP + RAM cost
  - Player chọn "Hack" mode → highlight hackable hex trong range 3
  - Click hackable hex → execute hack

- [ ] Hack types:
  - Terminal → Turret: auto-attack enemy gần nhất mỗi enemy turn (8 damage, -1 firewall), tồn tại 3 turn. Cost: 15 RAM
  - Floor → Trap: enemy bước vào → 10 damage + slow 1 turn + -1 firewall. Trigger 1 lần. Cost: 10 RAM
  - Floor → Wall: chặn path 4 turn. Cost: 12 RAM
  - Wall → Phá wall: mở lối đi vĩnh viễn. Cost: 10 RAM

- [ ] Visual:
  - Turret: hex có rotating cyan dot
  - Trap: hex có subtle glow (player thấy, enemy không)
  - Hacked wall: hex border dashed

- [ ] Turret AI (trong enemy turn):
  - Tìm enemy gần nhất trong range 3
  - Bắn → damage + firewall reduction
  - Giảm turn counter, xóa khi hết

- [ ] Trap trigger:
  - Enemy bước vào hex có trap → trigger damage + slow (enemy mất 1 AP next turn)

**Verify**: hack terminal thành turret bắn tự động, trap trigger khi enemy bước vào.

### Milestone 8: HUD + Polish
- [ ] `HUD.tsx` hoàn chỉnh:
  - HP bar (red gradient)
  - RAM bar (cyan gradient) + số hiện tại
  - Qi bar (yellow/gold gradient) + số hiện tại
  - AP dots (3 dots, filled = available, empty = used, gold = AP bank)
  - Turn indicator: "YOUR TURN" (xanh) / "ENEMY TURN" (đỏ)

- [ ] `CombatLog.tsx`:
  - Scrollable log panel góc phải dưới
  - Log mỗi action: "Vân cast ping_flood() → Crawler takes 12 damage"
  - Log reactive: "Perfect Parry! +1 AP"
  - Log break: "Crawler FIREWALL BREACHED!"
  - Log hack: "Terminal hacked → Turret deployed (3 turns)"

- [ ] `EnemyInfo.tsx`:
  - Hover/click enemy → panel hiện: tên, HP bar, Firewall bar, weakness tag, behavior hint
  - Khi BREACHED: hiện "INJECT VIRUS" button

- [ ] Camera:
  - Center camera trên player
  - Smooth pan khi player di chuyển
  - Zoom mặc định fit toàn bộ grid

- [ ] Restart:
  - Game over → "Try Again" button → reset combat state, respawn entities

**Verify**: UI đọc được, combat log hữu ích, game feel polished.

---

## Quy tắc code

1. **Game logic trong `core/` KHÔNG import React, PixiJS, hay Zustand.** Core phải testable độc lập — đây là phần sẽ port sang Godot.

2. **Renderer chỉ đọc state, không mutate.** Zustand store là single source of truth. Renderer subscribe store và re-render.

3. **Reactive Defense cần `requestAnimationFrame` loop riêng**, tách khỏi turn-based game loop. Chỉ active trong ENEMY_TURN khi prompt hiện.

4. **Tất cả số liệu (damage, cost, range, timing) lấy từ data files** (`programs.json`, `enemies.json`), không hardcode trong logic. Dễ balance sau.

5. **Placeholder art**: dùng PixiJS Graphics API vẽ geometric shapes. Không dùng sprite image files. Player = blue circle, Enemy = red shapes (triangle/square/diamond), Terminal = cyan rectangle, Trap = yellow dot, Turret = cyan rotating dot, Wall = dark gray filled hex.

6. **TypeScript strict mode.** Không dùng `any`. Define interface cho mọi data structure.

---

## Không làm trong prototype

- ❌ Dungeon generation (dùng 1 room hardcode)
- ❌ Veil layer toggle
- ❌ Moral system (Giải/Giữ)
- ❌ Narrative / dialogue / lore
- ❌ Multiple archetype (chỉ Phá Mã)
- ❌ Spell tier upgrade
- ❌ Hub / meta progression / mutation
- ❌ Audio
- ❌ Save / load
- ❌ Art assets thật
- ❌ Mobile responsive
- ❌ Expedition Counter (AoE reactive defense)
- ❌ Veil Tear portal hack

---

## Câu hỏi cần validate qua playtesting

Sau khi prototype chạy, test với người chơi thật và trả lời:

1. 3 AP per turn đủ chưa? Quá ít (frustrating) hay quá nhiều (không cần trade-off)?
2. Reactive defense timing 0.4s — fun hay annoying? Cần dễ hơn / khó hơn?
3. Player có chủ động target weakness để Break, hay ignore firewall system?
4. Player có dùng hack hex, hay chỉ brute force damage?
5. Triple-slot combo có được khám phá, hay player chỉ dùng Active ignore Modifier/Passive?
6. Combat kéo dài bao lâu? Target: 2–4 phút per encounter.