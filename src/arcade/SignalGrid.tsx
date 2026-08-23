import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { ParticipantId } from '../types';
import {
  ArcadeControls,
  ArcadeHud,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  canvasPoint,
  drawRoundedRect,
  useArcadeCanvas,
  useEventReplay,
  useLatest,
  usePrefersReducedMotion,
  useRoundClock,
  type ArcadeGameInnerProps,
} from './shared';

type Cell = ParticipantId | null;
interface StrategyWorld {
  cells: Cell[];
  turn: ParticipantId;
  winner: ParticipantId | 'draw' | null;
  winningCells: number[];
}

const GRID_SIZE = 4;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const BOARD_LEFT = 190;
const BOARD_TOP = 40;
const BOARD_SIZE = 340;
const CELL_SIZE = BOARD_SIZE / GRID_SIZE;

function initialWorld(seed: number): StrategyWorld {
  return { cells: Array<Cell>(CELL_COUNT).fill(null), turn: seed % 2 === 0 ? 'a' : 'b', winner: null, winningCells: [] };
}

function linesOfThree() {
  const lines: number[][] = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let column = 0; column <= GRID_SIZE - 3; column += 1) lines.push([row * GRID_SIZE + column, row * GRID_SIZE + column + 1, row * GRID_SIZE + column + 2]);
  }
  for (let column = 0; column < GRID_SIZE; column += 1) {
    for (let row = 0; row <= GRID_SIZE - 3; row += 1) lines.push([row * GRID_SIZE + column, (row + 1) * GRID_SIZE + column, (row + 2) * GRID_SIZE + column]);
  }
  for (let row = 0; row <= GRID_SIZE - 3; row += 1) {
    for (let column = 0; column <= GRID_SIZE - 3; column += 1) {
      lines.push([row * GRID_SIZE + column, (row + 1) * GRID_SIZE + column + 1, (row + 2) * GRID_SIZE + column + 2]);
      lines.push([row * GRID_SIZE + column + 2, (row + 1) * GRID_SIZE + column + 1, (row + 2) * GRID_SIZE + column]);
    }
  }
  return lines;
}

const WINNING_LINES = linesOfThree();

function place(world: StrategyWorld, player: ParticipantId, cell: number) {
  if (world.winner || world.turn !== player || !Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT || world.cells[cell]) return false;
  world.cells[cell] = player;
  const line = WINNING_LINES.find((candidate) => candidate.every((index) => world.cells[index] === player));
  if (line) {
    world.winner = player;
    world.winningCells = line;
  } else if (world.cells.every(Boolean)) {
    world.winner = 'draw';
  } else {
    world.turn = player === 'a' ? 'b' : 'a';
  }
  return true;
}

function bestAiCell(world: StrategyWorld, ai: ParticipantId) {
  const opponent = ai === 'a' ? 'b' : 'a';
  const free = world.cells.map((value, index) => value ? -1 : index).filter((index) => index >= 0);
  for (const candidate of free) {
    const copy: StrategyWorld = { ...world, cells: [...world.cells], winningCells: [] };
    place(copy, ai, candidate);
    if (copy.winner === ai) return candidate;
  }
  for (const candidate of free) {
    const copy: StrategyWorld = { ...world, cells: [...world.cells], turn: opponent, winner: null, winningCells: [] };
    place(copy, opponent, candidate);
    if (copy.winner === opponent) return candidate;
  }
  return [5, 10, 6, 9, 0, 15, 3, 12].find((cell) => world.cells[cell] === null) ?? free[0] ?? -1;
}

function drawGrid(context: CanvasRenderingContext2D, world: StrategyWorld, nowMs: number, reducedMotion: boolean) {
  const gradient = context.createLinearGradient(0, 0, FIELD_WIDTH, FIELD_HEIGHT);
  gradient.addColorStop(0, '#f8e8ce');
  gradient.addColorStop(1, '#d9cef2');
  context.fillStyle = gradient;
  context.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);
  context.fillStyle = 'rgba(255,255,255,.64)';
  drawRoundedRect(context, BOARD_LEFT - 18, BOARD_TOP - 18, BOARD_SIZE + 36, BOARD_SIZE + 36, 30);
  context.fill();

  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    const column = cell % GRID_SIZE;
    const row = Math.floor(cell / GRID_SIZE);
    const x = BOARD_LEFT + column * CELL_SIZE;
    const y = BOARD_TOP + row * CELL_SIZE;
    context.fillStyle = world.winningCells.includes(cell) ? 'rgba(255,233,137,.75)' : 'rgba(255,255,255,.58)';
    context.strokeStyle = 'rgba(67,52,89,.16)';
    context.lineWidth = 2;
    drawRoundedRect(context, x + 5, y + 5, CELL_SIZE - 10, CELL_SIZE - 10, 18);
    context.fill();
    context.stroke();
    const owner = world.cells[cell];
    if (!owner) continue;
    const centerX = x + CELL_SIZE / 2;
    const centerY = y + CELL_SIZE / 2;
    const pulse = reducedMotion ? 0 : Math.sin(nowMs / 260 + cell) * 2;
    context.save();
    context.shadowColor = owner === 'a' ? '#ff776b' : '#6c66df';
    context.shadowBlur = 12 + pulse;
    context.strokeStyle = owner === 'a' ? '#e95f56' : '#6259d1';
    context.fillStyle = owner === 'a' ? '#ff8a72' : '#7770e6';
    context.lineWidth = 8;
    if (owner === 'a') {
      context.beginPath();
      context.arc(centerX, centerY, 24, 0, Math.PI * 2);
      context.stroke();
    } else {
      context.beginPath();
      context.moveTo(centerX - 22, centerY - 22);
      context.lineTo(centerX + 22, centerY + 22);
      context.moveTo(centerX + 22, centerY - 22);
      context.lineTo(centerX - 22, centerY + 22);
      context.stroke();
    }
    context.restore();
  }
}

export function SignalGrid(props: ArcadeGameInnerProps) {
  const { definition, viewer, players, paused, events, emit, onComplete, soloAssist, sessionKey } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef(initialWorld(definition.seed));
  const remainingMs = useRoundClock(definition.durationSeconds, paused, sessionKey);
  const remainingRef = useLatest(remainingMs);
  const completeRef = useRef(false);
  const [view, setView] = useState(() => ({ ...initialWorld(definition.seed), cells: [...initialWorld(definition.seed).cells] }));
  const reducedMotion = usePrefersReducedMotion();
  const roundActive = remainingMs > 0;

  const publishView = () => {
    const world = worldRef.current;
    setView({ ...world, cells: [...world.cells], winningCells: [...world.winningCells] });
  };

  useEffect(() => {
    worldRef.current = initialWorld(definition.seed);
    completeRef.current = false;
    publishView();
  }, [definition.seed, sessionKey]);

  useEventReplay(events, (event) => {
    if (event.input.kind === 'strategy.place' && place(worldRef.current, event.participantId, event.input.cell)) {
      publishView();
    } else if (event.input.kind === 'session.restart') {
      worldRef.current = initialWorld(definition.seed);
      publishView();
    }
  }, sessionKey);

  useEffect(() => {
    if (!soloAssist || paused || !roundActive || view.winner || view.turn === viewer) return undefined;
    const timer = window.setTimeout(() => {
      const world = worldRef.current;
      const cell = bestAiCell(world, world.turn);
      if (cell >= 0 && place(world, world.turn, cell)) publishView();
    }, 520);
    return () => window.clearTimeout(timer);
  }, [paused, roundActive, soloAssist, view.turn, view.winner, viewer]);

  useEffect(() => {
    if ((!view.winner && remainingMs > 0) || completeRef.current) return;
    completeRef.current = true;
    const winner = view.winner ?? 'draw';
    onComplete?.({
      kind: 'signal-grid',
      category: 'strategy',
      score: { a: view.cells.filter((cell) => cell === 'a').length, b: view.cells.filter((cell) => cell === 'b').length },
      outcome: winner,
      headline: winner === 'draw' ? '棋盘布满，策略握手言和' : `${players[winner].nickname} 连成了信号链`,
    });
  }, [onComplete, players, remainingMs, view.cells, view.winner]);

  useArcadeCanvas(canvasRef, (context) => {
    drawGrid(context, worldRef.current, performance.now(), reducedMotion);
  }, paused || remainingRef.current <= 0);

  const choose = (cell: number) => {
    if (paused || remainingMs <= 0 || view.winner || view.turn !== viewer || view.cells[cell]) return;
    emit({ kind: 'strategy.place', cell });
  };
  const chooseFromCanvas = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY);
    if (point.x < BOARD_LEFT || point.x >= BOARD_LEFT + BOARD_SIZE || point.y < BOARD_TOP || point.y >= BOARD_TOP + BOARD_SIZE) return;
    const column = Math.floor((point.x - BOARD_LEFT) / CELL_SIZE);
    const row = Math.floor((point.y - BOARD_TOP) / CELL_SIZE);
    choose(row * GRID_SIZE + column);
  };

  return (
    <div className="arcade-strategy">
      <ArcadeHud
        label="占领节点"
        value={`${view.cells.filter((cell) => cell === 'a').length} : ${view.cells.filter((cell) => cell === 'b').length}`}
        secondary={view.winner ? view.winner === 'draw' ? '平局' : `${players[view.winner].nickname} 连线成功` : `轮到 ${players[view.turn].nickname}`}
        remainingMs={remainingMs}
      />
      <canvas ref={canvasRef} role="img" tabIndex={0} aria-label={`四乘四策略棋盘。${view.winner ? '本局已结束' : `轮到 ${players[view.turn].nickname}`}。`} onClick={chooseFromCanvas} />
      <ArcadeControls role={`${players[viewer].nickname} · 指挥官`} hint="轮流占领节点，横、竖或斜线率先连成 3 个">
        <div className="arcade-grid-buttons" role="grid" aria-label="信号节点棋盘">
          {view.cells.map((owner, cell) => (
            <button
              key={cell}
              type="button"
              role="gridcell"
              className={owner ? `is-${owner}` : ''}
              aria-label={`第 ${Math.floor(cell / GRID_SIZE) + 1} 行第 ${cell % GRID_SIZE + 1} 列，${owner ? `${players[owner].nickname} 已占领` : '空节点'}`}
              disabled={Boolean(owner) || Boolean(view.winner) || view.turn !== viewer || paused || remainingMs <= 0}
              onClick={() => choose(cell)}
            >{owner === 'a' ? '○' : owner === 'b' ? '×' : <span />}</button>
          ))}
        </div>
      </ArcadeControls>
    </div>
  );
}
