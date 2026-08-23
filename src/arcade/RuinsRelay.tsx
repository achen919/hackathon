import { useEffect, useRef, useState } from 'react';
import {
  ArcadeControls,
  ArcadeHud,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  clamp,
  drawRoundedRect,
  useArcadeCanvas,
  useEventReplay,
  useLatest,
  usePrefersReducedMotion,
  useRoundClock,
  type ArcadeGameInnerProps,
} from './shared';

const LANES = [142, 238, 334] as const;
const FINISH_DISTANCE = 2_600;
const GATE_SPACING = 430;
const ROCK_SPACING = 315;

interface RuinsWorld {
  progress: number;
  lane: 0 | 1 | 2;
  bridgeLane: 0 | 1 | 2;
  jumpRemaining: number;
  nextGate: number;
  nextRock: number;
  rockLane: 0 | 1 | 2;
  stumbles: number;
  gates: number;
  slowRemaining: number;
  randomState: number;
}

function initialWorld(seed: number): RuinsWorld {
  return {
    progress: 0,
    lane: 1,
    bridgeLane: 1,
    jumpRemaining: 0,
    nextGate: 390,
    nextRock: 235,
    rockLane: (seed % 3) as 0 | 1 | 2,
    stumbles: 0,
    gates: 0,
    slowRemaining: 0,
    randomState: seed || 1,
  };
}

function nextLane(world: RuinsWorld) {
  world.randomState = (world.randomState * 1_103_515_245 + 12_345) & 0x7fffffff;
  return (world.randomState % 3) as 0 | 1 | 2;
}

function drawJungle(context: CanvasRenderingContext2D, world: RuinsWorld, nowMs: number, reducedMotion: boolean) {
  const gradient = context.createLinearGradient(0, 0, 0, FIELD_HEIGHT);
  gradient.addColorStop(0, '#173f48');
  gradient.addColorStop(0.48, '#36745d');
  gradient.addColorStop(1, '#172f2f');
  context.fillStyle = gradient;
  context.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);

  const parallax = reducedMotion ? 0 : world.progress * 0.18;
  context.fillStyle = 'rgba(12,42,38,.5)';
  for (let index = -1; index < 8; index += 1) {
    const x = ((index * 126 - parallax) % 882 + 882) % 882 - 80;
    context.beginPath();
    context.moveTo(x, 130);
    context.lineTo(x + 58, 42);
    context.lineTo(x + 110, 130);
    context.closePath();
    context.fill();
  }

  for (let lane = 0; lane < LANES.length; lane += 1) {
    const y = LANES[lane];
    context.strokeStyle = 'rgba(255,243,197,.24)';
    context.lineWidth = 2;
    context.setLineDash([13, 10]);
    context.beginPath();
    context.moveTo(0, y + 26);
    context.lineTo(FIELD_WIDTH, y + 26);
    context.stroke();
    context.setLineDash([]);
  }

  const gateDistance = world.nextGate - world.progress;
  const gateX = 130 + gateDistance;
  if (gateX > -80 && gateX < FIELD_WIDTH + 100) {
    for (let lane = 0; lane < 3; lane += 1) {
      const y = LANES[lane];
      context.fillStyle = lane === world.bridgeLane ? '#f8d56a' : 'rgba(18,30,29,.83)';
      context.shadowColor = lane === world.bridgeLane ? '#ffe78f' : 'transparent';
      context.shadowBlur = lane === world.bridgeLane ? 15 : 0;
      drawRoundedRect(context, gateX - 54, y + 8, 108, 18, 6);
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = 'rgba(9,21,22,.82)';
      context.fillRect(gateX - 8, y + 27, 16, 40);
    }
  }

  const rockDistance = world.nextRock - world.progress;
  const rockX = 130 + rockDistance;
  if (rockX > -40 && rockX < FIELD_WIDTH + 50) {
    const y = LANES[world.rockLane] + 13;
    context.save();
    context.translate(rockX, y);
    context.rotate(reducedMotion ? 0 : nowMs / 700);
    context.fillStyle = '#725a4b';
    context.beginPath();
    context.moveTo(-18, -12);
    context.lineTo(2, -22);
    context.lineTo(20, -4);
    context.lineTo(14, 17);
    context.lineTo(-14, 19);
    context.closePath();
    context.fill();
    context.restore();
  }

  const runnerY = LANES[world.lane] - (world.jumpRemaining > 0 ? Math.sin((1 - world.jumpRemaining / 0.72) * Math.PI) * 47 : 0);
  context.save();
  context.translate(130, runnerY);
  context.fillStyle = '#ffe2b8';
  context.beginPath();
  context.arc(0, -22, 11, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#ff896d';
  context.lineWidth = 8;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(0, -10);
  context.lineTo(0, 15);
  context.moveTo(0, 0);
  context.lineTo(-14, 10);
  context.moveTo(0, 0);
  context.lineTo(16, 8);
  const runPhase = reducedMotion ? 0 : Math.sin(nowMs / 90) * 10;
  context.moveTo(0, 14);
  context.lineTo(-10 - runPhase * 0.35, 30);
  context.moveTo(0, 14);
  context.lineTo(12 + runPhase * 0.35, 30);
  context.stroke();
  context.restore();

  context.fillStyle = 'rgba(0,0,0,.34)';
  drawRoundedRect(context, 18, 18, FIELD_WIDTH - 36, 12, 6);
  context.fill();
  context.fillStyle = '#f8d56a';
  drawRoundedRect(context, 18, 18, (FIELD_WIDTH - 36) * clamp(world.progress / FINISH_DISTANCE), 12, 6);
  context.fill();
}

export function RuinsRelay(props: ArcadeGameInnerProps) {
  const { definition, viewer, players, paused, events, emit, onComplete, soloAssist, sessionKey } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef(initialWorld(definition.seed));
  const remainingMs = useRoundClock(definition.durationSeconds, paused, sessionKey);
  const remainingRef = useLatest(remainingMs);
  const completeRef = useRef(false);
  const [hud, setHud] = useState({ progress: 0, stumbles: 0, gates: 0, lane: 1, bridgeLane: 1 });
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    worldRef.current = initialWorld(definition.seed);
    completeRef.current = false;
    setHud({ progress: 0, stumbles: 0, gates: 0, lane: 1, bridgeLane: 1 });
  }, [definition.seed, sessionKey]);

  useEventReplay(events, (event) => {
    const world = worldRef.current;
    if (event.input.kind === 'ruins.move' && event.participantId === 'a') {
      world.lane = clamp(world.lane + event.input.direction, 0, 2) as 0 | 1 | 2;
    } else if (event.input.kind === 'ruins.jump' && event.participantId === 'a' && world.jumpRemaining <= 0) {
      world.jumpRemaining = 0.72;
    } else if (event.input.kind === 'ruins.bridge' && event.participantId === 'b') {
      world.bridgeLane = event.input.lane;
    } else if (event.input.kind === 'session.restart') {
      worldRef.current = initialWorld(definition.seed);
    }
  }, sessionKey);

  const finish = (reason: 'distance' | 'time') => {
    if (completeRef.current) return;
    completeRef.current = true;
    const world = worldRef.current;
    onComplete?.({
      kind: 'ruins-relay',
      category: 'adventure',
      score: { a: world.gates, b: Math.max(0, world.gates - world.stumbles) },
      outcome: 'together',
      headline: reason === 'distance' ? '你们一起跑出了遗迹' : '探险暂停，默契路线已经找到',
    });
  };

  useEffect(() => {
    if (remainingMs <= 0) finish('time');
  // finish reads the current ref only; including it would restart this effect every frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs]);

  useArcadeCanvas(canvasRef, (context, deltaSeconds, nowMs) => {
    const world = worldRef.current;
    if (deltaSeconds > 0 && remainingRef.current > 0 && world.progress < FINISH_DISTANCE) {
      world.jumpRemaining = Math.max(0, world.jumpRemaining - deltaSeconds);
      world.slowRemaining = Math.max(0, world.slowRemaining - deltaSeconds);

      if (soloAssist && viewer === 'a' && world.nextGate - world.progress < 230) world.bridgeLane = world.lane;
      if (soloAssist && viewer === 'b') {
        if (world.nextGate - world.progress < 230) world.lane = world.bridgeLane;
        if (world.nextRock - world.progress < 95 && world.rockLane === world.lane) world.jumpRemaining = Math.max(world.jumpRemaining, 0.72);
      }

      world.progress += (world.slowRemaining > 0 ? 52 : 106) * deltaSeconds;
      if (world.progress >= world.nextGate) {
        if (world.lane === world.bridgeLane) world.gates += 1;
        else {
          world.stumbles += 1;
          world.slowRemaining = 1.15;
        }
        world.nextGate += GATE_SPACING;
      }
      if (world.progress >= world.nextRock) {
        if (world.lane === world.rockLane && world.jumpRemaining <= 0.18) {
          world.stumbles += 1;
          world.slowRemaining = 0.9;
        }
        world.nextRock += ROCK_SPACING;
        world.rockLane = nextLane(world);
      }
      if (Math.floor(nowMs / 100) !== Math.floor((nowMs - deltaSeconds * 1_000) / 100)) {
        setHud({
          progress: Math.min(100, Math.round(world.progress / FINISH_DISTANCE * 100)),
          stumbles: world.stumbles,
          gates: world.gates,
          lane: world.lane,
          bridgeLane: world.bridgeLane,
        });
      }
      if (world.progress >= FINISH_DISTANCE) finish('distance');
    }
    drawJungle(context, world, nowMs, reducedMotion);
  }, paused || remainingMs <= 0 || completeRef.current);

  const changeLane = (direction: -1 | 1) => emit({ kind: 'ruins.move', direction });
  const laneNames = ['上层', '中层', '下层'];
  return (
    <div
      className="arcade-ruins"
      onKeyDown={(event) => {
        if (event.target instanceof HTMLButtonElement) return;
        if (viewer === 'a' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          changeLane(event.key === 'ArrowUp' ? -1 : 1);
        } else if (viewer === 'a' && (event.code === 'Space' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          emit({ kind: 'ruins.jump' });
        } else if (viewer === 'b' && ['1', '2', '3'].includes(event.key)) {
          emit({ kind: 'ruins.bridge', lane: (Number(event.key) - 1) as 0 | 1 | 2 });
        }
      }}
    >
      <ArcadeHud label="遗迹进度" value={`${hud.progress}%`} secondary={`通过 ${hud.gates} 座桥 · 磕碰 ${hud.stumbles} 次`} remainingMs={remainingMs} />
      <canvas ref={canvasRef} role="img" tabIndex={0} aria-label={`遗迹闯关，完成 ${hud.progress}%，探险家在${laneNames[hud.lane]}，安全桥在${laneNames[hud.bridgeLane]}。`} />
      {viewer === 'a' ? (
        <ArcadeControls role={`${players.a.nickname} · 探险家`} hint="换层对准亮起的桥，遇到滚石就跳">
          <div className="arcade-runner-controls">
            <button type="button" disabled={paused || remainingMs <= 0 || hud.lane === 0} onClick={() => changeLane(-1)}>↑ 换到上层</button>
            <button className="arcade-action" type="button" disabled={paused || remainingMs <= 0} onClick={() => emit({ kind: 'ruins.jump' })}>跳跃</button>
            <button type="button" disabled={paused || remainingMs <= 0 || hud.lane === 2} onClick={() => changeLane(1)}>↓ 换到下层</button>
          </div>
        </ArcadeControls>
      ) : (
        <ArcadeControls role={`${players.b.nickname} · 机关向导`} hint="为探险家点亮下一座桥，键盘可按 1 / 2 / 3">
          <div className="arcade-lane-picker" role="radiogroup" aria-label="选择安全桥层数">
            {laneNames.map((label, index) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={hud.bridgeLane === index}
                className={hud.bridgeLane === index ? 'is-selected' : ''}
                disabled={paused || remainingMs <= 0}
                onClick={() => emit({ kind: 'ruins.bridge', lane: index as 0 | 1 | 2 })}
              >{index + 1}<small>{label}</small></button>
            ))}
          </div>
        </ArcadeControls>
      )}
    </div>
  );
}
