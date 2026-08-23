import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ArcadeGameInput, ArcadeGameResult, ArcadeInputEvent } from './types';
import {
  ArcadeControls,
  ArcadeHud,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  canvasPoint,
  clamp,
  drawRoundedRect,
  useArcadeCanvas,
  useEventReplay,
  useLatest,
  usePrefersReducedMotion,
  useRoundClock,
  type ArcadeGameInnerProps,
} from './shared';

interface BasketballWorld {
  ball: { x: number; y: number; previousY: number; vx: number; vy: number; inFlight: boolean };
  hoopX: number;
  aim: number;
  power: number;
  charging: boolean;
  chargeDirection: 1 | -1;
  made: number;
  defended: number;
  shots: number;
  resetAt: number;
  nextAiShotAt: number;
}

const BALL_START = { x: 92, y: 336 };
const RIM_Y = 166;
const RIM_WIDTH = 86;
const BALL_RADIUS = 14;

function initialWorld(): BasketballWorld {
  return {
    ball: { ...BALL_START, previousY: BALL_START.y, vx: 0, vy: 0, inFlight: false },
    hoopX: 574,
    aim: 47,
    power: 0.56,
    charging: false,
    chargeDirection: 1,
    made: 0,
    defended: 0,
    shots: 0,
    resetAt: 0,
    nextAiShotAt: 0,
  };
}

function resetBall(world: BasketballWorld) {
  world.ball = { ...BALL_START, previousY: BALL_START.y, vx: 0, vy: 0, inFlight: false };
  world.resetAt = 0;
}

function launch(world: BasketballWorld, angle: number, power: number) {
  if (world.ball.inFlight || world.resetAt > 0) return;
  const safeAngle = clamp(angle, 28, 72);
  const safePower = clamp(power, 0.12, 1);
  const radians = safeAngle * Math.PI / 180;
  const speed = 510 + safePower * 250;
  world.aim = safeAngle;
  world.power = safePower;
  world.charging = false;
  world.ball = {
    ...BALL_START,
    previousY: BALL_START.y,
    vx: Math.cos(radians) * speed,
    vy: -Math.sin(radians) * speed,
    inFlight: true,
  };
  world.shots += 1;
}

function applyInput(world: BasketballWorld, event: ArcadeInputEvent) {
  const { input } = event;
  if (input.kind === 'basketball.aim' && event.participantId === 'a') {
    world.aim = clamp(input.angle, 28, 72);
  } else if (input.kind === 'basketball.charge' && event.participantId === 'a') {
    world.charging = input.active && !world.ball.inFlight;
  } else if (input.kind === 'basketball.shoot' && event.participantId === 'a') {
    launch(world, input.angle, input.power);
  } else if (input.kind === 'basketball.hoop' && event.participantId === 'b') {
    world.hoopX = 435 + clamp(input.x) * 225;
  } else if (input.kind === 'session.restart') {
    Object.assign(world, initialWorld());
  }
}

function drawCourt(
  context: CanvasRenderingContext2D,
  world: BasketballWorld,
  reducedMotion: boolean,
  nowMs: number,
  topic: string,
) {
  const gradient = context.createLinearGradient(0, 0, 0, FIELD_HEIGHT);
  gradient.addColorStop(0, '#20275f');
  gradient.addColorStop(0.55, '#5157a8');
  gradient.addColorStop(0.56, '#f1a06d');
  gradient.addColorStop(1, '#d66f50');
  context.fillStyle = gradient;
  context.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);

  context.save();
  context.globalAlpha = 0.22;
  context.fillStyle = '#fff';
  for (let index = 0; index < 11; index += 1) {
    const phase = reducedMotion ? 0 : Math.sin(nowMs / 700 + index) * 4;
    context.beginPath();
    context.arc(34 + index * 70, 66 + (index % 2) * 18 + phase, 8, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  context.strokeStyle = 'rgba(255,255,255,.54)';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(0, 242);
  context.lineTo(FIELD_WIDTH, 242);
  context.stroke();
  context.beginPath();
  context.arc(574, 422, 172, Math.PI, Math.PI * 2);
  context.stroke();
  context.setLineDash([8, 10]);
  context.beginPath();
  context.arc(574, 282, 70, Math.PI, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);

  if (topic) {
    context.font = '700 13px system-ui, sans-serif';
    context.fillStyle = 'rgba(255,255,255,.76)';
    context.fillText(`本局主题 · ${topic}`, 24, 32);
  }

  const angle = world.aim * Math.PI / 180;
  context.save();
  context.translate(BALL_START.x, BALL_START.y);
  context.strokeStyle = 'rgba(255,255,255,.72)';
  context.lineWidth = 3;
  context.setLineDash([7, 8]);
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(Math.cos(angle) * 102, -Math.sin(angle) * 102);
  context.stroke();
  context.setLineDash([]);
  context.restore();

  // Backboard, rim and net move as one defender-controlled object.
  context.fillStyle = 'rgba(238,247,255,.94)';
  drawRoundedRect(context, world.hoopX + RIM_WIDTH / 2 - 6, 84, 12, 93, 5);
  context.fill();
  context.strokeStyle = '#fff';
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(world.hoopX - RIM_WIDTH / 2, RIM_Y);
  context.lineTo(world.hoopX + RIM_WIDTH / 2, RIM_Y);
  context.stroke();
  context.strokeStyle = '#ff755f';
  context.lineWidth = 5;
  context.stroke();
  context.strokeStyle = 'rgba(255,255,255,.72)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(world.hoopX - RIM_WIDTH / 2 + 5, RIM_Y + 3);
  context.lineTo(world.hoopX - RIM_WIDTH / 4, RIM_Y + 60);
  context.lineTo(world.hoopX, RIM_Y + 6);
  context.lineTo(world.hoopX + RIM_WIDTH / 4, RIM_Y + 60);
  context.lineTo(world.hoopX + RIM_WIDTH / 2 - 5, RIM_Y + 3);
  context.stroke();

  context.save();
  context.translate(world.ball.x, world.ball.y);
  context.fillStyle = '#ff9b42';
  context.shadowColor = 'rgba(30,20,45,.38)';
  context.shadowBlur = 12;
  context.beginPath();
  context.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = '#71351e';
  context.lineWidth = 2;
  context.beginPath();
  context.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
  context.moveTo(-BALL_RADIUS, 0);
  context.lineTo(BALL_RADIUS, 0);
  context.moveTo(0, -BALL_RADIUS);
  context.quadraticCurveTo(8, 0, 0, BALL_RADIUS);
  context.stroke();
  context.restore();

  // Charge meter lives inside the court so it remains visible on small phones.
  context.fillStyle = 'rgba(20,23,50,.42)';
  drawRoundedRect(context, 24, 374, 178, 20, 10);
  context.fill();
  context.fillStyle = world.power > 0.78 ? '#ffe66e' : '#fff';
  drawRoundedRect(context, 27, 377, 172 * world.power, 14, 7);
  context.fill();
}

export function BasketballDuel(props: ArcadeGameInnerProps) {
  const { definition, viewer, players, paused, events, emit, onComplete, soloAssist, sessionKey } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef(initialWorld());
  const remainingMs = useRoundClock(definition.durationSeconds, paused, sessionKey);
  const remainingRef = useLatest(remainingMs);
  const completeRef = useRef(false);
  const [hud, setHud] = useState({ made: 0, defended: 0, shots: 0, power: 0.56, aim: 47 });
  const [message, setMessage] = useState('投手准备瞄准，守门员可以拖动篮筐');
  const reducedMotion = usePrefersReducedMotion();
  const pointerCapturedRef = useRef<number | null>(null);
  const lastMoveEmitRef = useRef(0);

  useEffect(() => {
    worldRef.current = initialWorld();
    completeRef.current = false;
    setHud({ made: 0, defended: 0, shots: 0, power: 0.56, aim: 47 });
    setMessage('投手准备瞄准，守门员可以拖动篮筐');
  }, [sessionKey]);

  useEventReplay(events, (event) => applyInput(worldRef.current, event), sessionKey);

  useEffect(() => {
    if (remainingMs > 0 || completeRef.current) return;
    completeRef.current = true;
    const world = worldRef.current;
    const outcome = world.made > world.defended ? 'a' : world.made < world.defended ? 'b' : 'draw';
    onComplete?.({
      kind: 'basketball-duel',
      category: 'sport',
      score: { a: world.made, b: world.defended },
      outcome,
      headline: outcome === 'a' ? '投手拿下这一局' : outcome === 'b' ? '移动篮筐守住了' : '攻防打成默契平局',
    });
  }, [onComplete, remainingMs]);

  useArcadeCanvas(canvasRef, (context, deltaSeconds, nowMs) => {
    const world = worldRef.current;
    if (deltaSeconds > 0 && remainingRef.current > 0) {
      if (world.charging && !world.ball.inFlight) {
        world.power += world.chargeDirection * deltaSeconds * 0.7;
        if (world.power >= 1) {
          world.power = 1;
          world.chargeDirection = -1;
        } else if (world.power <= 0.18) {
          world.power = 0.18;
          world.chargeDirection = 1;
        }
      }

      if (soloAssist && viewer === 'a') {
        world.hoopX = 548 + Math.sin(nowMs / 860) * 92;
      } else if (soloAssist && viewer === 'b' && !world.ball.inFlight && !world.resetAt) {
        if (!world.nextAiShotAt) world.nextAiShotAt = nowMs + 1_100;
        if (nowMs >= world.nextAiShotAt) {
          const drift = Math.sin(nowMs / 733);
          launch(world, 43 + drift * 5, 0.58 + (drift + 1) * 0.12);
          world.nextAiShotAt = nowMs + 2_300;
        }
      }

      const ball = world.ball;
      if (ball.inFlight) {
        ball.previousY = ball.y;
        ball.vy += 690 * deltaSeconds;
        ball.x += ball.vx * deltaSeconds;
        ball.y += ball.vy * deltaSeconds;

        // Backboard collision gives the shooter a real bank-shot option.
        const boardX = world.hoopX + RIM_WIDTH / 2;
        if (ball.vx > 0 && ball.x + BALL_RADIUS >= boardX && ball.x < boardX && ball.y > 78 && ball.y < 180) {
          ball.x = boardX - BALL_RADIUS;
          ball.vx *= -0.7;
        }

        if (ball.previousY + BALL_RADIUS < RIM_Y && ball.y + BALL_RADIUS >= RIM_Y && ball.vy > 0) {
          const inside = Math.abs(ball.x - world.hoopX) < RIM_WIDTH / 2 - BALL_RADIUS * 0.45;
          if (inside) {
            world.made += 2;
            world.resetAt = nowMs + 650;
            ball.inFlight = false;
            setMessage('空心命中！篮筐守门员还可以更快地移动');
          }
        }
        if (ball.y > FIELD_HEIGHT + 45 || ball.x > FIELD_WIDTH + 45 || ball.x < -45) {
          world.defended += 1;
          world.resetAt = nowMs + 420;
          ball.inFlight = false;
          setMessage('守住一球！投手马上可以再来一次');
        }
      } else if (world.resetAt > 0 && nowMs >= world.resetAt) {
        resetBall(world);
      }

      if (Math.floor(nowMs / 90) !== Math.floor((nowMs - deltaSeconds * 1_000) / 90)) {
        setHud({ made: world.made, defended: world.defended, shots: world.shots, power: world.power, aim: world.aim });
      }
    }
    drawCourt(context, world, reducedMotion, nowMs, definition.topicTokens[0] ?? '双人攻防');
  }, paused || remainingMs <= 0);

  const shoot = () => {
    const world = worldRef.current;
    if (world.ball.inFlight || world.resetAt || remainingMs <= 0) return;
    emit({ kind: 'basketball.shoot', angle: world.aim, power: world.power });
    setMessage(`${players.a.nickname} 出手了，${players.b.nickname} 快移动篮筐！`);
  };

  const startCharge = () => {
    if (viewer !== 'a' || paused || remainingMs <= 0) return;
    emit({ kind: 'basketball.charge', active: true });
  };

  const releaseCharge = () => {
    if (viewer !== 'a') return;
    emit({ kind: 'basketball.charge', active: false });
    shoot();
  };

  const moveHoop = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (viewer !== 'b' || paused || remainingMs <= 0 || pointerCapturedRef.current !== event.pointerId) return;
    const now = performance.now();
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY);
    const normalized = clamp((point.x - 435) / 225);
    worldRef.current.hoopX = 435 + normalized * 225;
    if (now - lastMoveEmitRef.current >= 45) {
      lastMoveEmitRef.current = now;
      emit({ kind: 'basketball.hoop', x: normalized });
    }
  };

  const ended = remainingMs <= 0;
  return (
    <div
      className="arcade-basketball"
      onKeyDown={(event) => {
        if (paused || ended) return;
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
        if (viewer === 'a' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          const angle = clamp(worldRef.current.aim + (event.key === 'ArrowUp' ? 2 : -2), 28, 72);
          emit({ kind: 'basketball.aim', angle });
        } else if (viewer === 'a' && event.code === 'Space' && !event.repeat) {
          event.preventDefault();
          startCharge();
        } else if (viewer === 'b' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          const x = clamp((worldRef.current.hoopX - 435) / 225 + (event.key === 'ArrowLeft' ? -0.055 : 0.055));
          emit({ kind: 'basketball.hoop', x });
        }
      }}
      onKeyUp={(event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
        if (viewer === 'a' && event.code === 'Space') {
          event.preventDefault();
          releaseCharge();
        }
      }}
    >
      <ArcadeHud
        label="投手 : 守筐"
        value={`${hud.made} : ${hud.defended}`}
        secondary={`${hud.shots} 次出手`}
        remainingMs={remainingMs}
      />
      <canvas
        ref={canvasRef}
        className={viewer === 'b' ? 'is-draggable' : ''}
        role="img"
        tabIndex={0}
        aria-label={`篮球攻防场，投手 ${hud.made} 分，守筐 ${hud.defended} 分。${message}`}
        onPointerDown={(event) => {
          if (viewer !== 'b') return;
          pointerCapturedRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          moveHoop(event);
        }}
        onPointerMove={moveHoop}
        onPointerUp={(event) => {
          if (pointerCapturedRef.current !== event.pointerId) return;
          moveHoop(event);
          pointerCapturedRef.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => { pointerCapturedRef.current = null; }}
      />
      <p className="arcade-live-message" aria-live="polite">{ended ? '本局结束，可以重新开一局' : message}</p>
      {viewer === 'a' ? (
        <ArcadeControls role={`${players.a.nickname} · 投手`} hint="↑↓ 调角度 · 空格或按住按钮蓄力">
          <label className="arcade-range">
            <span>角度 {Math.round(hud.aim)}°</span>
            <input
              type="range"
              min="28"
              max="72"
              value={hud.aim}
              disabled={paused || ended}
              onChange={(event) => emit({ kind: 'basketball.aim', angle: Number(event.target.value) })}
              aria-label="投篮角度"
            />
          </label>
          <button
            className="arcade-action arcade-action--charge"
            type="button"
            disabled={paused || ended || worldRef.current.ball.inFlight}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startCharge(); }}
            onPointerUp={releaseCharge}
            onPointerCancel={() => emit({ kind: 'basketball.charge', active: false })}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.code === 'Space') && !event.repeat) {
                event.preventDefault();
                event.stopPropagation();
                startCharge();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === 'Enter' || event.code === 'Space') {
                event.preventDefault();
                event.stopPropagation();
                releaseCharge();
              }
            }}
          >
            <span style={{ '--arcade-charge': hud.power } as React.CSSProperties} />
            按住蓄力 · 松手投篮
          </button>
        </ArcadeControls>
      ) : (
        <ArcadeControls role={`${players.b.nickname} · 篮筐守门员`} hint="在球场拖动篮筐，或使用 ← →">
          <div className="arcade-direction-row">
            <button type="button" disabled={paused || ended} onClick={() => emit({ kind: 'basketball.hoop', x: clamp((worldRef.current.hoopX - 435) / 225 - 0.1) })} aria-label="篮筐向左">←</button>
            <strong>拖动篮筐拦截</strong>
            <button type="button" disabled={paused || ended} onClick={() => emit({ kind: 'basketball.hoop', x: clamp((worldRef.current.hoopX - 435) / 225 + 0.1) })} aria-label="篮筐向右">→</button>
          </div>
        </ArcadeControls>
      )}
    </div>
  );
}
