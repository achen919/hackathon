import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';
import type { ParticipantId } from '../types';
import type {
  ArcadeGameDefinition,
  ArcadeGameInput,
  ArcadeGameResult,
  ArcadeInputEvent,
  ArcadePlayer,
} from './types';

export const FIELD_WIDTH = 720;
export const FIELD_HEIGHT = 420;

export interface ArcadeGameInnerProps {
  definition: ArcadeGameDefinition;
  viewer: ParticipantId;
  players: Record<ParticipantId, ArcadePlayer>;
  paused: boolean;
  events: readonly ArcadeInputEvent[];
  emit: (input: ArcadeGameInput) => void;
  onComplete?: (result: ArcadeGameResult) => void;
  soloAssist: boolean;
  sessionKey: string;
}

export function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function otherPlayer(player: ParticipantId): ParticipantId {
  return player === 'a' ? 'b' : 'a';
}

export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function useArcadeCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  frame: (context: CanvasRenderingContext2D, deltaSeconds: number, nowMs: number) => void,
  paused: boolean,
) {
  const frameRef = useLatest(frame);
  const pausedRef = useLatest(paused);
  useEffect(() => {
    let animationFrame = 0;
    let previous = performance.now();
    const draw = (now: number) => {
      const canvas = canvasRef.current;
      if (canvas) {
        const context = canvas.getContext('2d');
        if (context) {
          const ratio = Math.min(2, window.devicePixelRatio || 1);
          const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
          const height = Math.max(1, Math.round(canvas.clientWidth * (FIELD_HEIGHT / FIELD_WIDTH) * ratio));
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          context.setTransform(width / FIELD_WIDTH, 0, 0, height / FIELD_HEIGHT, 0, 0);
          const deltaSeconds = pausedRef.current ? 0 : Math.min(0.034, Math.max(0, (now - previous) / 1_000));
          frameRef.current(context, deltaSeconds, now);
        }
      }
      previous = now;
      animationFrame = window.requestAnimationFrame(draw);
    };
    animationFrame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [canvasRef, frameRef, pausedRef]);
}

export function useEventReplay(
  events: readonly ArcadeInputEvent[],
  onEvent: (event: ArcadeInputEvent) => void,
  sessionKey: string,
) {
  const seenRef = useRef(new Set<string>());
  const handlerRef = useLatest(onEvent);
  useEffect(() => {
    seenRef.current.clear();
  }, [sessionKey]);
  useEffect(() => {
    for (const event of events) {
      if (seenRef.current.has(event.eventId)) continue;
      seenRef.current.add(event.eventId);
      handlerRef.current(event);
    }
  }, [events, handlerRef]);
}

export function useRoundClock(durationSeconds: number, paused: boolean, sessionKey: string) {
  const [remainingMs, setRemainingMs] = useState(durationSeconds * 1_000);
  const endAtRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const now = performance.now();
    endAtRef.current = now + durationSeconds * 1_000;
    pausedAtRef.current = paused ? now : null;
    setRemainingMs(durationSeconds * 1_000);
  }, [durationSeconds, sessionKey]);

  useEffect(() => {
    const now = performance.now();
    if (paused && pausedAtRef.current === null) pausedAtRef.current = now;
    if (!paused && pausedAtRef.current !== null) {
      endAtRef.current += now - pausedAtRef.current;
      pausedAtRef.current = null;
    }
  }, [paused]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const basis = pausedAtRef.current ?? performance.now();
      setRemainingMs(Math.max(0, endAtRef.current - basis));
    }, 100);
    return () => window.clearInterval(timer);
  }, []);
  return remainingMs;
}

export function formatSeconds(remainingMs: number) {
  return `${Math.ceil(remainingMs / 1_000)}s`;
}

export function ArcadeHud({
  label,
  value,
  secondary,
  remainingMs,
}: {
  label: string;
  value: string | number;
  secondary?: string;
  remainingMs: number;
}) {
  return (
    <div className="arcade-hud" aria-live="polite">
      <span><small>{label}</small><strong>{value}</strong>{secondary && <em>{secondary}</em>}</span>
      <time aria-label={`剩余 ${Math.ceil(remainingMs / 1_000)} 秒`}>{formatSeconds(remainingMs)}</time>
    </div>
  );
}

export function ArcadeControls({
  role,
  hint,
  children,
}: {
  role: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="arcade-controls" aria-label={`${role}操作区`}>
      <header><span>{role}</span><small>{hint}</small></header>
      <div>{children}</div>
    </section>
  );
}

export function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

export function canvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: clamp((clientX - bounds.left) / bounds.width) * FIELD_WIDTH,
    y: clamp((clientY - bounds.top) / bounds.height) * FIELD_HEIGHT,
  };
}
