import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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

interface PaddleWorld {
  ball: { x: number; y: number; vx: number; vy: number };
  paddles: Record<'a' | 'b', number>;
  score: Record<'a' | 'b', number>;
}

const PADDLE_HEIGHT = 92;
const PADDLE_WIDTH = 15;
const BALL_RADIUS = 11;

function initialWorld(seed: number): PaddleWorld {
  const direction = seed % 2 === 0 ? 1 : -1;
  return {
    ball: { x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2, vx: 270 * direction, vy: 118 },
    paddles: { a: FIELD_HEIGHT / 2, b: FIELD_HEIGHT / 2 },
    score: { a: 0, b: 0 },
  };
}

function serve(world: PaddleWorld, toward: 'a' | 'b', seed: number) {
  world.ball.x = FIELD_WIDTH / 2;
  world.ball.y = FIELD_HEIGHT / 2;
  world.ball.vx = (toward === 'a' ? -1 : 1) * (260 + seed % 50);
  world.ball.vy = ((seed % 5) - 2) * 45 || 90;
}

function drawArena(context: CanvasRenderingContext2D, world: PaddleWorld, nowMs: number, reducedMotion: boolean) {
  const background = context.createRadialGradient(360, 210, 20, 360, 210, 480);
  background.addColorStop(0, '#342c6f');
  background.addColorStop(1, '#10142f');
  context.fillStyle = background;
  context.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);

  context.save();
  context.strokeStyle = 'rgba(151,238,255,.3)';
  context.lineWidth = 2;
  context.setLineDash([9, 12]);
  context.beginPath();
  context.moveTo(FIELD_WIDTH / 2, 22);
  context.lineTo(FIELD_WIDTH / 2, FIELD_HEIGHT - 22);
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.arc(FIELD_WIDTH / 2, FIELD_HEIGHT / 2, 70, 0, Math.PI * 2);
  context.stroke();
  context.restore();

  const glow = reducedMotion ? 8 : 11 + Math.sin(nowMs / 240) * 4;
  for (const side of ['a', 'b'] as const) {
    const x = side === 'a' ? 35 : FIELD_WIDTH - 50;
    context.save();
    context.shadowColor = side === 'a' ? '#ff7b73' : '#7dd6ff';
    context.shadowBlur = glow;
    context.fillStyle = side === 'a' ? '#ff7b73' : '#7dd6ff';
    drawRoundedRect(context, x, world.paddles[side] - PADDLE_HEIGHT / 2, PADDLE_WIDTH, PADDLE_HEIGHT, 8);
    context.fill();
    context.restore();
  }

  context.save();
  context.shadowColor = '#fff';
  context.shadowBlur = 18;
  context.fillStyle = '#fff';
  context.beginPath();
  context.arc(world.ball.x, world.ball.y, BALL_RADIUS, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function NeonPaddles(props: ArcadeGameInnerProps) {
  const { definition, viewer, players, paused, events, emit, onComplete, soloAssist, sessionKey } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef(initialWorld(definition.seed));
  const remainingMs = useRoundClock(definition.durationSeconds, paused, sessionKey);
  const remainingRef = useLatest(remainingMs);
  const completeRef = useRef(false);
  const [score, setScore] = useState({ a: 0, b: 0 });
  const reducedMotion = usePrefersReducedMotion();
  const draggingRef = useRef<number | null>(null);
  const lastEmitRef = useRef(0);

  useEffect(() => {
    worldRef.current = initialWorld(definition.seed);
    completeRef.current = false;
    setScore({ a: 0, b: 0 });
  }, [definition.seed, sessionKey]);

  useEventReplay(events, (event) => {
    if (event.input.kind === 'paddles.move') {
      worldRef.current.paddles[event.participantId] = 55 + clamp(event.input.y) * (FIELD_HEIGHT - 110);
    } else if (event.input.kind === 'session.restart') {
      worldRef.current = initialWorld(definition.seed);
    }
  }, sessionKey);

  useEffect(() => {
    if (remainingMs > 0 || completeRef.current) return;
    completeRef.current = true;
    const finalScore = worldRef.current.score;
    const outcome = finalScore.a > finalScore.b ? 'a' : finalScore.b > finalScore.a ? 'b' : 'draw';
    onComplete?.({
      kind: 'neon-paddles',
      category: 'competition',
      score: { ...finalScore },
      outcome,
      headline: outcome === 'draw' ? '光球停在一场平局' : `${players[outcome].nickname} 守住了最后一球`,
    });
  }, [onComplete, players, remainingMs]);

  useArcadeCanvas(canvasRef, (context, deltaSeconds, nowMs) => {
    const world = worldRef.current;
    if (deltaSeconds > 0 && remainingRef.current > 0) {
      const other = viewer === 'a' ? 'b' : 'a';
      if (soloAssist) {
        const target = clamp(world.ball.y, 55, FIELD_HEIGHT - 55);
        world.paddles[other] += clamp(target - world.paddles[other], -125 * deltaSeconds, 125 * deltaSeconds);
      }
      const ball = world.ball;
      ball.x += ball.vx * deltaSeconds;
      ball.y += ball.vy * deltaSeconds;
      if (ball.y <= BALL_RADIUS + 8 || ball.y >= FIELD_HEIGHT - BALL_RADIUS - 8) {
        ball.y = clamp(ball.y, BALL_RADIUS + 8, FIELD_HEIGHT - BALL_RADIUS - 8);
        ball.vy *= -1;
      }

      const leftX = 35 + PADDLE_WIDTH;
      if (ball.vx < 0 && ball.x - BALL_RADIUS <= leftX && ball.x > 25 && Math.abs(ball.y - world.paddles.a) <= PADDLE_HEIGHT / 2 + BALL_RADIUS) {
        ball.x = leftX + BALL_RADIUS;
        ball.vx = Math.abs(ball.vx) * 1.035;
        ball.vy += (ball.y - world.paddles.a) * 4.2;
      }
      const rightX = FIELD_WIDTH - 50;
      if (ball.vx > 0 && ball.x + BALL_RADIUS >= rightX && ball.x < FIELD_WIDTH - 25 && Math.abs(ball.y - world.paddles.b) <= PADDLE_HEIGHT / 2 + BALL_RADIUS) {
        ball.x = rightX - BALL_RADIUS;
        ball.vx = -Math.abs(ball.vx) * 1.035;
        ball.vy += (ball.y - world.paddles.b) * 4.2;
      }
      ball.vx = clamp(ball.vx, -520, 520);
      ball.vy = clamp(ball.vy, -410, 410);

      if (ball.x < -30) {
        world.score.b += 1;
        setScore({ ...world.score });
        serve(world, 'a', definition.seed + world.score.a + world.score.b);
      } else if (ball.x > FIELD_WIDTH + 30) {
        world.score.a += 1;
        setScore({ ...world.score });
        serve(world, 'b', definition.seed + world.score.a + world.score.b);
      }
    }
    drawArena(context, world, nowMs, reducedMotion);
  }, paused || remainingMs <= 0);

  const movePaddle = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (paused || remainingMs <= 0 || draggingRef.current !== event.pointerId) return;
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY);
    const normalized = clamp((point.y - 55) / (FIELD_HEIGHT - 110));
    worldRef.current.paddles[viewer] = 55 + normalized * (FIELD_HEIGHT - 110);
    const now = performance.now();
    if (now - lastEmitRef.current >= 42) {
      lastEmitRef.current = now;
      emit({ kind: 'paddles.move', y: normalized });
    }
  };

  const nudge = (amount: number) => {
    const next = clamp((worldRef.current.paddles[viewer] - 55) / (FIELD_HEIGHT - 110) + amount);
    emit({ kind: 'paddles.move', y: next });
  };

  return (
    <div
      className="arcade-paddles"
      onKeyDown={(event) => {
        if (event.target instanceof HTMLButtonElement) return;
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        nudge(event.key === 'ArrowUp' ? -0.07 : 0.07);
      }}
    >
      <ArcadeHud label={`${players.a.nickname} : ${players.b.nickname}`} value={`${score.a} : ${score.b}`} secondary="先漏球的一方失分" remainingMs={remainingMs} />
      <canvas
        ref={canvasRef}
        className="is-draggable"
        role="img"
        tabIndex={0}
        aria-label={`霓虹弹球场，比分 ${score.a} 比 ${score.b}。拖动自己的挡板接球。`}
        onPointerDown={(event) => {
          draggingRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          movePaddle(event);
        }}
        onPointerMove={movePaddle}
        onPointerUp={(event) => { movePaddle(event); draggingRef.current = null; }}
        onPointerCancel={() => { draggingRef.current = null; }}
      />
      <ArcadeControls role={`${players[viewer].nickname} · ${viewer === 'a' ? '左侧' : '右侧'}守门员`} hint="在场地上下拖动，或使用 ↑ ↓">
        <div className="arcade-direction-row arcade-direction-row--vertical">
          <button type="button" disabled={paused || remainingMs <= 0} onClick={() => nudge(-0.1)} aria-label="挡板向上">↑</button>
          <strong>守住你的底线</strong>
          <button type="button" disabled={paused || remainingMs <= 0} onClick={() => nudge(0.1)} aria-label="挡板向下">↓</button>
        </div>
      </ArcadeControls>
    </div>
  );
}
