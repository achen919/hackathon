import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArcadeControls,
  ArcadeHud,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  canvasPoint,
  clamp,
  useArcadeCanvas,
  useEventReplay,
  useLatest,
  usePrefersReducedMotion,
  useRoundClock,
  type ArcadeGameInnerProps,
} from './shared';

interface FallingObject {
  id: number;
  x: number;
  y: number;
  speed: number;
  kind: 'star' | 'meteor';
  spin: number;
}

interface RescueWorld {
  shipX: number;
  shieldRemaining: number;
  shieldCooldown: number;
  spawnIn: number;
  nextId: number;
  randomState: number;
  items: FallingObject[];
  rescued: number;
  damage: number;
}

function initialWorld(seed: number): RescueWorld {
  return {
    shipX: FIELD_WIDTH / 2,
    shieldRemaining: 0,
    shieldCooldown: 0,
    spawnIn: 0.35,
    nextId: 1,
    randomState: seed || 1,
    items: [],
    rescued: 0,
    damage: 0,
  };
}

function random(world: RescueWorld) {
  world.randomState = (world.randomState * 1_664_525 + 1_013_904_223) >>> 0;
  return world.randomState / 4_294_967_296;
}

function spawn(world: RescueWorld) {
  const chance = random(world);
  world.items.push({
    id: world.nextId++,
    x: 42 + random(world) * (FIELD_WIDTH - 84),
    y: -24,
    speed: 112 + random(world) * 100,
    kind: chance < 0.66 ? 'star' : 'meteor',
    spin: random(world) * Math.PI * 2,
  });
}

function drawStar(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  context.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const angle = -Math.PI / 2 + point * Math.PI / 5;
    const distance = point % 2 === 0 ? radius : radius * 0.42;
    const px = x + Math.cos(angle) * distance;
    const py = y + Math.sin(angle) * distance;
    if (point === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
}

function drawSpace(context: CanvasRenderingContext2D, world: RescueWorld, nowMs: number, reducedMotion: boolean) {
  const background = context.createLinearGradient(0, 0, 0, FIELD_HEIGHT);
  background.addColorStop(0, '#111b48');
  background.addColorStop(1, '#254f72');
  context.fillStyle = background;
  context.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);
  context.fillStyle = 'rgba(255,255,255,.48)';
  for (let index = 0; index < 28; index += 1) {
    const x = (index * 83 + 31) % FIELD_WIDTH;
    const baseY = (index * 47 + 22) % FIELD_HEIGHT;
    const y = reducedMotion ? baseY : (baseY + nowMs * (0.002 + index % 3 * 0.001)) % FIELD_HEIGHT;
    context.fillRect(x, y, index % 4 === 0 ? 3 : 2, index % 4 === 0 ? 3 : 2);
  }

  for (const item of world.items) {
    if (item.kind === 'star') {
      context.save();
      context.shadowColor = '#ffe779';
      context.shadowBlur = 16;
      context.fillStyle = '#ffe779';
      drawStar(context, item.x, item.y, 13);
      context.fill();
      context.restore();
    } else {
      context.save();
      context.translate(item.x, item.y);
      context.rotate(item.spin);
      context.fillStyle = '#c76b73';
      context.beginPath();
      context.moveTo(-14, -7);
      context.lineTo(-4, -17);
      context.lineTo(13, -10);
      context.lineTo(17, 8);
      context.lineTo(3, 16);
      context.lineTo(-15, 8);
      context.closePath();
      context.fill();
      context.fillStyle = 'rgba(64,32,56,.35)';
      context.beginPath();
      context.arc(3, -4, 5, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  const shipY = FIELD_HEIGHT - 63;
  if (world.shieldRemaining > 0) {
    context.save();
    context.strokeStyle = 'rgba(125,226,255,.92)';
    context.fillStyle = 'rgba(77,192,255,.13)';
    context.lineWidth = 5;
    context.shadowColor = '#80e4ff';
    context.shadowBlur = 18;
    context.beginPath();
    context.arc(world.shipX, shipY, 45, Math.PI, Math.PI * 2);
    context.lineTo(world.shipX + 45, shipY + 8);
    context.lineTo(world.shipX - 45, shipY + 8);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }
  context.save();
  context.translate(world.shipX, shipY);
  context.fillStyle = '#e8fbff';
  context.beginPath();
  context.moveTo(0, -24);
  context.lineTo(27, 17);
  context.lineTo(8, 11);
  context.lineTo(0, 22);
  context.lineTo(-8, 11);
  context.lineTo(-27, 17);
  context.closePath();
  context.fill();
  context.fillStyle = '#59cdf1';
  context.beginPath();
  context.ellipse(0, -4, 8, 13, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function MeteorRescue(props: ArcadeGameInnerProps) {
  const { definition, viewer, players, paused, events, emit, onComplete, soloAssist, sessionKey } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef(initialWorld(definition.seed));
  const remainingMs = useRoundClock(definition.durationSeconds, paused, sessionKey);
  const remainingRef = useLatest(remainingMs);
  const completeRef = useRef(false);
  const [hud, setHud] = useState({ rescued: 0, damage: 0, shield: 0, cooldown: 0 });
  const draggingRef = useRef<number | null>(null);
  const lastEmitRef = useRef(0);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    worldRef.current = initialWorld(definition.seed);
    completeRef.current = false;
    setHud({ rescued: 0, damage: 0, shield: 0, cooldown: 0 });
  }, [definition.seed, sessionKey]);

  useEventReplay(events, (event) => {
    const world = worldRef.current;
    if (event.input.kind === 'rescue.steer' && event.participantId === 'a') {
      world.shipX = 38 + clamp(event.input.x) * (FIELD_WIDTH - 76);
    } else if (event.input.kind === 'rescue.shield' && event.participantId === 'b' && world.shieldCooldown <= 0) {
      world.shieldRemaining = 1.35;
      world.shieldCooldown = 3.2;
    } else if (event.input.kind === 'session.restart') {
      worldRef.current = initialWorld(definition.seed);
    }
  }, sessionKey);

  useEffect(() => {
    if (remainingMs > 0 || completeRef.current) return;
    completeRef.current = true;
    const world = worldRef.current;
    onComplete?.({
      kind: 'meteor-rescue',
      category: 'cooperation',
      score: { a: world.rescued, b: Math.max(0, world.rescued - world.damage) },
      outcome: 'together',
      headline: world.rescued >= 12 ? '双人救援队满载返航' : '你们把飞船一起带回来了',
    });
  }, [onComplete, remainingMs]);

  useArcadeCanvas(canvasRef, (context, deltaSeconds, nowMs) => {
    const world = worldRef.current;
    if (deltaSeconds > 0 && remainingRef.current > 0) {
      world.shieldRemaining = Math.max(0, world.shieldRemaining - deltaSeconds);
      world.shieldCooldown = Math.max(0, world.shieldCooldown - deltaSeconds);
      world.spawnIn -= deltaSeconds;
      if (world.spawnIn <= 0) {
        spawn(world);
        world.spawnIn = 0.48 + random(world) * 0.42;
      }
      if (soloAssist && viewer === 'b') {
        const nearestStar = world.items.filter((item) => item.kind === 'star').sort((left, right) => right.y - left.y)[0];
        if (nearestStar) world.shipX += clamp(nearestStar.x - world.shipX, -150 * deltaSeconds, 150 * deltaSeconds);
      }
      if (soloAssist && viewer === 'a' && world.shieldCooldown <= 0 && world.items.some((item) => item.kind === 'meteor' && item.y > 265 && Math.abs(item.x - world.shipX) < 45)) {
        world.shieldRemaining = 1.35;
        world.shieldCooldown = 3.2;
      }
      const shipY = FIELD_HEIGHT - 63;
      for (const item of world.items) {
        item.y += item.speed * deltaSeconds;
        item.spin += deltaSeconds * 1.7;
        const hit = Math.hypot(item.x - world.shipX, item.y - shipY) < (item.kind === 'star' ? 32 : 36);
        if (!hit) continue;
        if (item.kind === 'star') world.rescued += 1;
        else if (world.shieldRemaining > 0) world.rescued += 1;
        else world.damage += 1;
        item.y = FIELD_HEIGHT + 100;
      }
      world.items = world.items.filter((item) => item.y < FIELD_HEIGHT + 35);
      if (Math.floor(nowMs / 100) !== Math.floor((nowMs - deltaSeconds * 1_000) / 100)) {
        setHud({ rescued: world.rescued, damage: world.damage, shield: world.shieldRemaining, cooldown: world.shieldCooldown });
      }
    }
    drawSpace(context, world, nowMs, reducedMotion);
  }, paused || remainingMs <= 0);

  const steer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (viewer !== 'a' || draggingRef.current !== event.pointerId || paused || remainingMs <= 0) return;
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY);
    const x = clamp((point.x - 38) / (FIELD_WIDTH - 76));
    worldRef.current.shipX = 38 + x * (FIELD_WIDTH - 76);
    const now = performance.now();
    if (now - lastEmitRef.current >= 45) {
      lastEmitRef.current = now;
      emit({ kind: 'rescue.steer', x });
    }
  };
  const nudge = (amount: number) => emit({
    kind: 'rescue.steer',
    x: clamp((worldRef.current.shipX - 38) / (FIELD_WIDTH - 76) + amount),
  });

  return (
    <div
      className="arcade-rescue"
      onKeyDown={(event) => {
        if (event.target instanceof HTMLButtonElement) return;
        if (viewer === 'a' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          nudge(event.key === 'ArrowLeft' ? -0.07 : 0.07);
        } else if (viewer === 'b' && (event.code === 'Space' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          emit({ kind: 'rescue.shield' });
        }
      }}
    >
      <ArcadeHud label="共同救援" value={`${hud.rescued} ✦`} secondary={hud.damage ? `飞船受损 ${hud.damage} 次` : '飞船状态完好'} remainingMs={remainingMs} />
      <canvas
        ref={canvasRef}
        className={viewer === 'a' ? 'is-draggable' : ''}
        role="img"
        tabIndex={0}
        aria-label={`流星救援场，已收集 ${hud.rescued} 颗星光，受损 ${hud.damage} 次。`}
        onPointerDown={(event) => {
          if (viewer !== 'a') return;
          draggingRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          steer(event);
        }}
        onPointerMove={steer}
        onPointerUp={(event) => { steer(event); draggingRef.current = null; }}
        onPointerCancel={() => { draggingRef.current = null; }}
      />
      {viewer === 'a' ? (
        <ArcadeControls role={`${players.a.nickname} · 驾驶员`} hint="拖动飞船收集星光，避开陨石">
          <div className="arcade-direction-row">
            <button type="button" disabled={paused || remainingMs <= 0} onClick={() => nudge(-0.1)} aria-label="飞船向左">←</button>
            <strong>接住星光</strong>
            <button type="button" disabled={paused || remainingMs <= 0} onClick={() => nudge(0.1)} aria-label="飞船向右">→</button>
          </div>
        </ArcadeControls>
      ) : (
        <ArcadeControls role={`${players.b.nickname} · 护盾工程师`} hint="陨石接近飞船时启动，持续约 1.3 秒">
          <button className="arcade-action arcade-action--shield" type="button" disabled={paused || remainingMs <= 0 || hud.cooldown > 0} onClick={() => emit({ kind: 'rescue.shield' })}>
            {hud.shield > 0 ? '护盾展开中' : hud.cooldown > 0 ? `冷却 ${hud.cooldown.toFixed(1)}s` : '启动能量护盾'}
          </button>
        </ArcadeControls>
      )}
    </div>
  );
}
