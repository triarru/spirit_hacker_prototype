import { useEffect, useRef, useState } from 'react';
import { combinePassives } from '../core/programs/ProgramRegistry';
import { useCombatStore } from '../stores/useCombatStore';
import { useUIStore } from '../stores/useUIStore';
import { useLabels } from './labels';
import { heartbeatSeconds, LOW_HEALTH, memoryCells } from './vitalsMath';

/** One heartbeat of the trace, repeated across a strip twice the width of the bar so it can scroll. */
const HEART_TRACE =
  '0,13 30,13 36,13 40,9 44,13 58,13 62,16 66,3 71,20 75,13 100,13 130,13 136,13 140,9 144,13 158,13 162,16 166,3 171,20 175,13 200,13 230,13 236,13 240,9 244,13 258,13 262,16 266,3 271,20 275,13 300,13 330,13 336,13 340,9 344,13 358,13 362,16 366,3 371,20 375,13 400,13';

/** How long the white trace of lost health lingers before it drains away. */
const TRAIL_DELAY_MS = 500;

/** HP as a vital monitor: a heart trace running through the bar, racing as health falls. */
function HeartMonitor({ hp, maxHp }: { hp: number; maxHp: number }) {
  // What was lost stays lit for a moment, so a hit can be read even out of the corner of the eye.
  const [trail, setTrail] = useState(hp);
  useEffect(() => {
    if (hp >= trail) {
      setTrail(hp);
      return;
    }
    const timer = setTimeout(() => setTrail(hp), TRAIL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hp, trail]);

  const low = hp / maxHp <= LOW_HEALTH;
  return (
    <div className={`vital vital-hp${low ? ' vital-low' : ''}`}>
      <span className="vital-label">HP</span>
      <div className="monitor" role="img" aria-label={`HP ${hp} of ${maxHp}`}>
        <div className="monitor-trail" style={{ width: `${(trail / maxHp) * 100}%` }} />
        <div className="monitor-fill" style={{ width: `${(hp / maxHp) * 100}%` }}>
          <svg
            className="monitor-trace"
            viewBox="0 0 400 22"
            preserveAspectRatio="none"
            aria-hidden="true"
            style={{ animationDuration: `${heartbeatSeconds(hp, maxHp).toFixed(2)}s` }}
          >
            <polyline points={HEART_TRACE} />
          </svg>
        </div>
      </div>
      <span className="vital-value">{hp}</span>
    </div>
  );
}

/** RAM as a memory map: blocks of RAM, the ones the aimed spell would use blinking, the ones about to refill striped. */
function MemoryMap({ ram, maxRam, cost, regen }: { ram: number; maxRam: number; cost: number; regen: number }) {
  const cells = memoryCells(ram, maxRam, cost, regen);
  const label = cost > 0 ? `RAM ${ram} of ${maxRam}, ${cost} for the program being aimed` : `RAM ${ram} of ${maxRam}`;
  return (
    <div className="vital vital-ram">
      <span className="vital-label">RAM</span>
      <div className="memory" role="img" aria-label={label}>
        {cells.map((cell, index) => (
          <i
            key={index}
            className={`memory-block${cell.fill > 0 ? ' memory-block-used' : ''}${cell.pending ? ' memory-block-pending' : ''}${cell.loading ? ' memory-block-loading' : ''}`}
            style={{ '--fill': `${Math.round(cell.fill * 100)}%` } as React.CSSProperties}
          />
        ))}
      </div>
      <span className="vital-value">{ram}</span>
    </div>
  );
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

/** Qi as a stick of incense burning down: an ember at its end, smoke rising, ash falling when Qi is spent. */
function IncenseStick({ qi, maxQi, cost }: { qi: number; maxQi: number; cost: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The drawing loop runs on its own; it reads the latest values from here.
  const latest = useRef({ qi, maxQi, cost });
  const shownQi = useRef(qi);
  const ash = useRef<Particle[]>([]);
  const previousQi = useRef(qi);

  useEffect(() => {
    latest.current = { qi, maxQi, cost };
    const canvas = canvasRef.current;
    // Spending Qi knocks ash off the part of the stick that burned away.
    if (canvas && qi < previousQi.current) {
      const width = canvas.width;
      const y = canvas.height * 0.68;
      for (let i = 0; i < 18; i++) {
        const at = qi + Math.random() * (previousQi.current - qi);
        ash.current.push({
          x: (width - 30) * (at / maxQi) + 4,
          y,
          vx: (Math.random() - 0.5) * 30,
          vy: -15 - Math.random() * 25,
          life: 0,
          size: 2 + Math.random() * 2,
        });
      }
    }
    previousQi.current = qi;
  }, [qi, maxQi, cost]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const smoke: Particle[] = [];
    let frame = 0;
    let last = performance.now();

    const draw = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const scale = window.devicePixelRatio || 1;
      const width = Math.round(canvas.clientWidth * scale);
      const height = Math.round(canvas.clientHeight * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const { qi: target, maxQi: max, cost: aimed } = latest.current;
      shownQi.current += (target - shownQi.current) * Math.min(1, dt * 5);

      context.clearRect(0, 0, width, height);
      const y = height * 0.68;
      const full = width - 30 * scale;
      const length = full * (shownQi.current / max);
      const keep = aimed > 0 ? full * (Math.max(0, target - aimed) / max) : length;
      const thick = 6 * scale;

      // The bare reed the whole way, the coated part over it, and what the aimed rite would burn.
      context.fillStyle = '#3a2a16';
      context.fillRect(4, y - thick / 4, full, thick / 2);
      context.fillStyle = '#7a4a1f';
      context.fillRect(4, y - thick / 2, Math.max(0, Math.min(keep, length)), thick);
      if (keep < length) {
        context.fillStyle = 'rgba(227, 179, 65, 0.6)';
        context.fillRect(4 + keep, y - thick / 2, length - keep, thick);
      }

      if (target > 0) {
        const emberX = 4 + length;
        const radius = 9 * scale;
        const glow = context.createRadialGradient(emberX, y, 0, emberX, y, radius);
        glow.addColorStop(0, 'rgba(255, 210, 120, 0.95)');
        glow.addColorStop(0.35, 'rgba(230, 90, 40, 0.6)');
        glow.addColorStop(1, 'rgba(230, 90, 40, 0)');
        context.fillStyle = glow;
        context.beginPath();
        context.arc(emberX, y, radius, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#ffcf7a';
        context.fillRect(emberX - 1.5 * scale, y - thick / 2, 3 * scale, thick);
        if (!calm && Math.random() < dt * 20) {
          smoke.push({
            x: emberX,
            y: y - thick,
            vx: (Math.random() - 0.5) * 6 * scale,
            vy: -(10 + Math.random() * 8) * scale,
            life: 0,
            size: (1.2 + Math.random()) * scale,
          });
        }
      }

      for (const puff of smoke) {
        puff.life += dt;
        puff.x += (puff.vx + Math.sin(puff.life * 3 + puff.y) * 4 * scale) * dt;
        puff.y += puff.vy * dt;
        puff.size += dt * 2.5 * scale;
        context.fillStyle = `rgba(200, 200, 210, ${Math.max(0, 0.35 - puff.life * 0.25)})`;
        context.beginPath();
        context.arc(puff.x, puff.y, puff.size, 0, Math.PI * 2);
        context.fill();
      }
      for (const flake of ash.current) {
        flake.life += dt;
        flake.vy += 60 * dt;
        flake.x += flake.vx * dt;
        flake.y += flake.vy * dt;
        context.fillStyle = `rgba(150, 140, 130, ${Math.max(0, 1 - flake.life)})`;
        context.fillRect(flake.x, flake.y, flake.size, flake.size);
      }
      while (smoke[0] && smoke[0].life > 1.5) smoke.shift();
      while (ash.current[0] && ash.current[0].life > 1) ash.current.shift();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  const label = cost > 0 ? `Qi ${qi} of ${maxQi}, ${cost} for the rite being aimed` : `Qi ${qi} of ${maxQi}`;
  return (
    <div className="vital vital-qi">
      <span className="vital-label vital-label-qi">Qi</span>
      <canvas ref={canvasRef} className="incense" role="img" aria-label={label} />
      <span className="vital-value">{qi}</span>
    </div>
  );
}

/**
 * The player's three pools, each in the shape of what it is: the body's
 * health as a heart monitor, the machine's RAM as a memory map, the soul's Qi
 * as a stick of incense.
 */
export function HUD() {
  const player = useCombatStore((state) => state.player);
  const passives = useCombatStore((state) => state.passives);
  const hand = useCombatStore((state) => state.hand);
  const targetingSlot = useUIStore((state) => state.targetingSlot);

  // What the card being aimed would cost, so the pools can show what is about to go.
  const aimed = hand.find((card) => card.slot === targetingSlot)?.spec;
  const ramRegen = player.ramRegen + combinePassives(passives).ramPerTurn;

  return (
    <section className="hud">
      <HeartMonitor hp={player.hp} maxHp={player.maxHp} />
      <MemoryMap ram={player.ram} maxRam={player.maxRam} cost={aimed?.ramCost ?? 0} regen={ramRegen} />
      <IncenseStick qi={player.qi} maxQi={player.maxQi} cost={aimed?.qiCost ?? 0} />
    </section>
  );
}

/**
 * Action points as dots: filled is available, hollow is spent. AP above the
 * usual maximum came from the bank and is gold. AP still sitting in the bank,
 * earned for next turn, shows as gold dots after the divider.
 */
export function ApDots() {
  const player = useCombatStore((state) => state.player);
  const usableCount = Math.max(player.maxAp, player.ap);
  const usable = Array.from({ length: usableCount }, (_, index) => (
    <span
      key={index}
      className={`ap-dot${index < player.ap ? ' ap-dot-filled' : ''}${index >= player.maxAp ? ' ap-dot-banked' : ''}`}
    />
  ));
  const banked = Array.from({ length: player.apBank }, (_, index) => (
    <span key={index} className="ap-dot ap-dot-filled ap-dot-banked" />
  ));
  const label =
    player.apBank > 0
      ? `${player.ap} action points, ${player.apBank} banked for next turn`
      : `${player.ap} action points`;

  return (
    <div className="ap-dots" role="img" aria-label={label}>
      {usable}
      {banked.length > 0 && <span className="ap-divider" />}
      {banked}
    </div>
  );
}

/** The programs slotted as passives: always on, so they sit off to the side. */
export function Passives() {
  const passives = useCombatStore((state) => state.passives);
  const inFight = useCombatStore((state) => state.phase === 'PLAYER_TURN' || state.phase === 'ENEMY_TURN');
  const labels = useLabels();
  if (!inFight || passives.length === 0) return null;

  return (
    <section className="panel passives-panel">
      <h2>{labels.passives}</h2>
      <ul className="passives">
        {passives.map((program) => (
          <li key={program.id}>
            <strong>{program.name}</strong> {program.passive.description}
          </li>
        ))}
      </ul>
    </section>
  );
}
