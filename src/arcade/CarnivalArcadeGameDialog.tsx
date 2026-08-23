import { useEffect, useMemo, useRef, useState } from 'react';
import { CarnivalApiError } from '../carnival-api';
import type { CarnivalNetworkGameContext } from '../carnival-types';
import { GeneratedGameSandbox, type PairPlayInput } from './GeneratedGameSandbox';

type ArcadePhase = 'waiting' | 'countdown' | 'playing' | 'finished';
type NetworkArcadePreset = 'dash-duel' | 'tandem-rescue' | 'basketball-duel' | 'relic-expedition' | 'grid-command';

interface CarnivalArcadePublicState {
  inviteId: string;
  revision: number;
  serverNowMs: number;
  schemaVersion: 4;
  engine: 'arcade-v1';
  phase: ArcadePhase;
  title: string;
  description: string;
  generatedBy: 'ai' | 'fallback';
  arcade: {
    preset: NetworkArcadePreset;
    kind: string;
    roles: Array<{ id: string; label: string; objective: string; controls: string[] }>;
  };
  artifact: { artifactId: string; codeHash: string; runtimePath: string };
  self: { role: string; ready: boolean; controls: string[]; seq: number; input?: unknown };
  peer: { role: string; ready: boolean };
  frame: unknown;
  events: unknown[];
  eventCursor: number;
  countdownEndsAtMs?: number;
  deadlineAtMs?: number;
  outcome?: { score?: Record<string, number>; reason?: string } | null;
}

const PRESETS = new Set<NetworkArcadePreset>([
  'dash-duel', 'tandem-rescue', 'basketball-duel', 'relic-expedition', 'grid-command',
]);
const PHASES = new Set<ArcadePhase>(['waiting', 'countdown', 'playing', 'finished']);
const CONTINUOUS_CONTROLS = new Set(['move', 'aim', 'power', 'select']);
const NON_FATAL_ACTION_CODES = new Set([
  'ACTION_THROTTLED',
  'STALE_ACTION',
  'ALREADY_READY',
  'GAME_NOT_READY',
  'COUNTDOWN_ACTIVE',
  'SHOT_IN_FLIGHT',
  'ROUND_LIMIT',
  'GAME_COMPLETE',
]);

const MOBILE_PRESET_COPY: Record<NetworkArcadePreset, {
  icon: string;
  title: string;
  hint: string;
  moveLeft: string;
  moveRight: string;
}> = {
  'dash-duel': { icon: '⚡', title: '冲线控制台', hint: '按住前进，抓住时机冲刺', moveLeft: '调整节奏', moveRight: '按住前进' },
  'tandem-rescue': { icon: '✦', title: '救援控制台', hint: '校准位置，与对方同时发出脉冲', moveLeft: '向左校准', moveRight: '向右校准' },
  'basketball-duel': { icon: '●', title: '球场控制台', hint: '拖动或使用大按钮完成攻防', moveLeft: '按住向左', moveRight: '按住向右' },
  'relic-expedition': { icon: '◇', title: '探险控制台', hint: '移动位置，使用你的角色能力', moveLeft: '向左移动', moveRight: '向右移动' },
  'grid-command': { icon: '⌗', title: '九格指挥台', hint: '先选节点，再锁定本轮指令', moveLeft: '上一格', moveRight: '下一格' },
};

const MOBILE_ACTION_COPY: Record<string, string> = {
  boost: '⚡ 立即冲刺',
  sync: '✦ 发出同步脉冲',
  jump: '↑ 跳跃越障',
  guard: '◇ 开启防护',
};

function useMobileGameShell() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 620px), (max-height: 520px) and (pointer: coarse)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeControls(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return null;
  const controls = value.filter((item): item is string => typeof item === 'string' && /^[a-z][a-z0-9._-]{0,39}$/u.test(item));
  return controls.length === value.length && new Set(controls).size === controls.length ? controls : null;
}

export function normalizeCarnivalArcadePublicState(value: unknown, inviteId: string): CarnivalArcadePublicState | null {
  if (!isRecord(value) || value.inviteId !== inviteId || value.schemaVersion !== 4 || value.engine !== 'arcade-v1' ||
    typeof value.revision !== 'number' || !Number.isFinite(value.revision) ||
    typeof value.serverNowMs !== 'number' || !Number.isFinite(value.serverNowMs) ||
    !PHASES.has(value.phase as ArcadePhase) || !isRecord(value.arcade) || !isRecord(value.artifact) ||
    !isRecord(value.self) || !isRecord(value.peer) || !PRESETS.has(value.arcade.preset as NetworkArcadePreset)) return null;
  const selfControls = safeControls(value.self.controls);
  const roles = Array.isArray(value.arcade.roles) ? value.arcade.roles : [];
  if (!selfControls || roles.length !== 2 || !roles.every((role) => isRecord(role) && safeControls(role.controls))) return null;
  const artifactId = typeof value.artifact.artifactId === 'string' ? value.artifact.artifactId : '';
  const codeHash = typeof value.artifact.codeHash === 'string' ? value.artifact.codeHash : '';
  const runtimePath = typeof value.artifact.runtimePath === 'string' ? value.artifact.runtimePath : '';
  if (!/^artifact_[A-Za-z0-9_-]{32,80}$/u.test(artifactId) || !/^[a-f0-9]{64}$/u.test(codeHash) ||
    !/^\/api\/carnival\/games\/runtime\/artifact_[A-Za-z0-9_-]{32,80}$/u.test(runtimePath) ||
    typeof value.self.role !== 'string' || typeof value.peer.role !== 'string' ||
    typeof value.self.ready !== 'boolean' || typeof value.peer.ready !== 'boolean' ||
    !Number.isSafeInteger(value.self.seq)) return null;
  return {
    inviteId,
    revision: value.revision,
    serverNowMs: value.serverNowMs,
    schemaVersion: 4,
    engine: 'arcade-v1',
    phase: value.phase as ArcadePhase,
    title: typeof value.title === 'string' ? value.title.slice(0, 80) : 'AI 双人小游戏',
    description: typeof value.description === 'string' ? value.description.slice(0, 240) : '',
    generatedBy: value.generatedBy === 'ai' ? 'ai' : 'fallback',
    arcade: {
      preset: value.arcade.preset as NetworkArcadePreset,
      kind: typeof value.arcade.kind === 'string' ? value.arcade.kind : 'competition',
      roles: roles.map((role) => {
        const item = role as Record<string, unknown>;
        return {
          id: String(item.id ?? '').slice(0, 40),
          label: String(item.label ?? '游戏角色').slice(0, 40),
          objective: String(item.objective ?? '').slice(0, 100),
          controls: safeControls(item.controls) ?? [],
        };
      }),
    },
    artifact: { artifactId, codeHash, runtimePath },
    self: { role: value.self.role, ready: value.self.ready, controls: selfControls, seq: Number(value.self.seq), input: value.self.input },
    peer: { role: value.peer.role, ready: value.peer.ready },
    frame: value.frame,
    events: Array.isArray(value.events) ? value.events.slice(-128) : [],
    eventCursor: typeof value.eventCursor === 'number' && Number.isFinite(value.eventCursor) ? value.eventCursor : 0,
    countdownEndsAtMs: typeof value.countdownEndsAtMs === 'number' ? value.countdownEndsAtMs : undefined,
    deadlineAtMs: typeof value.deadlineAtMs === 'number' ? value.deadlineAtMs : undefined,
    outcome: isRecord(value.outcome) ? value.outcome as CarnivalArcadePublicState['outcome'] : null,
  };
}

function actionId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `arcade-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CarnivalArcadeGameDialog({
  context,
  state,
  onUseChatPrompt,
}: {
  context: CarnivalNetworkGameContext;
  state: CarnivalArcadePublicState;
  onUseChatPrompt?: (text: string) => void;
}) {
  const [syncError, setSyncError] = useState<string | null>(null);
  const seqRef = useRef(state.self.seq);
  const readySentRef = useRef(false);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastContinuousAtRef = useRef(new Map<string, number>());
  const continuousTimersRef = useRef(new Map<string, number>());
  const queuedContinuousRef = useRef(new Map<string, PairPlayInput>());
  const readyRetryTimerRef = useRef<number | null>(null);
  const moveHoldRef = useRef<{ pointerId: number; startedAt: number } | null>(null);
  const moveStopTimerRef = useRef<number | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [hostAim, setHostAim] = useState(0);
  const [hostPower, setHostPower] = useState(0.72);
  const [hostSelected, setHostSelected] = useState<number | null>(null);
  const mobileGameShell = useMobileGameShell();
  const closeRef = useRef(context.close);
  closeRef.current = context.close;
  const sendActionRef = useRef(context.sendAction);
  sendActionRef.current = context.sendAction;
  const roleDefinition = useMemo(() => state.arcade.roles.find((role) => role.id === state.self.role), [state.arcade.roles, state.self.role]);
  const peerRole = useMemo(() => state.arcade.roles.find((role) => role.id === state.peer.role), [state.arcade.roles, state.peer.role]);
  const rendererState = useMemo(() => ({
    phase: state.phase,
    serverNowMs: state.serverNowMs,
    frame: state.frame,
    countdownEndsAtMs: state.countdownEndsAtMs,
    deadlineAtMs: state.deadlineAtMs,
    outcome: state.outcome,
  }), [state.countdownEndsAtMs, state.deadlineAtMs, state.frame, state.outcome, state.phase, state.serverNowMs]);

  useEffect(() => {
    seqRef.current = Math.max(seqRef.current, state.self.seq);
    if (state.self.ready) {
      readySentRef.current = true;
      if (readyRetryTimerRef.current !== null) {
        window.clearTimeout(readyRetryTimerRef.current);
        readyRetryTimerRef.current = null;
      }
    }
  }, [state.self.ready, state.self.seq]);

  useEffect(() => {
    const input = isRecord(state.self.input) ? state.self.input : {};
    if (typeof input.aim === 'number' && Number.isFinite(input.aim)) setHostAim(Math.max(-1, Math.min(1, input.aim)));
    if (typeof input.power === 'number' && Number.isFinite(input.power)) setHostPower(Math.max(0.25, Math.min(1, input.power)));
    setHostSelected(Number.isInteger(input.select) && Number(input.select) >= 0 && Number(input.select) <= 8 ? Number(input.select) : null);
  }, [state.self.input, state.self.role]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyWasModalOpen = document.body.classList.contains('is-modal-open');
    const frame = window.requestAnimationFrame(() => {
      dialog?.querySelector<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])')?.focus();
    });
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), iframe:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('is-modal-open');
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      if (!bodyWasModalOpen) document.body.classList.remove('is-modal-open');
      previousFocus?.focus();
    };
  }, []);

  const enqueueAction = (action: 'arcade.ready' | 'arcade.input' | 'arcade.tick', payload: Record<string, unknown>) => {
    const sequence = ++seqRef.current;
    const pending = chainRef.current.then(() => context.sendAction(action, {
      ...payload,
      seq: sequence,
      requestId: actionId(),
    }));
    const result: Promise<void> = pending.then(() => undefined).catch((error: unknown) => {
      if (error instanceof CarnivalApiError && NON_FATAL_ACTION_CODES.has(error.code)) return undefined;
      setSyncError(error instanceof Error ? error.message : '操作暂时没有同步，请重试。');
      throw error;
    });
    chainRef.current = result.catch(() => undefined);
    return result;
  };

  const flushContinuous = (control: string) => {
    const timer = continuousTimersRef.current.get(control);
    if (timer !== undefined) window.clearTimeout(timer);
    continuousTimersRef.current.delete(control);
    const latest = queuedContinuousRef.current.get(control);
    queuedContinuousRef.current.delete(control);
    if (!latest) return undefined;
    lastContinuousAtRef.current.set(control, performance.now());
    return enqueueAction('arcade.input', {
      control: latest.control,
      ...(latest.value !== undefined ? { value: latest.value } : {}),
    });
  };

  const sendInput = (input: PairPlayInput) => {
    setSyncError(null);
    if (!CONTINUOUS_CONTROLS.has(input.control)) {
      // A shot/commit must be sequenced after the latest aim, power or selected
      // cell even when those continuous controls were waiting in the 90ms gate.
      for (const control of [...queuedContinuousRef.current.keys()]) {
        void flushContinuous(control)?.catch(() => undefined);
      }
      return enqueueAction('arcade.input', { control: input.control, ...(input.value !== undefined ? { value: input.value } : {}) });
    }
    queuedContinuousRef.current.set(input.control, input);
    const elapsed = performance.now() - (lastContinuousAtRef.current.get(input.control) ?? 0);
    if (elapsed >= 90 && !continuousTimersRef.current.has(input.control)) {
      return flushContinuous(input.control);
    }
    if (!continuousTimersRef.current.has(input.control)) {
      const timer = window.setTimeout(() => {
        void flushContinuous(input.control)?.catch(() => undefined);
      }, Math.max(0, 90 - elapsed));
      continuousTimersRef.current.set(input.control, timer);
    }
    return undefined;
  };

  const markReady = () => {
    if (state.self.ready || readySentRef.current) return;
    readySentRef.current = true;
    void enqueueAction('arcade.ready', {}).catch(() => {
      readySentRef.current = false;
      if (readyRetryTimerRef.current !== null) window.clearTimeout(readyRetryTimerRef.current);
      readyRetryTimerRef.current = window.setTimeout(() => {
        readyRetryTimerRef.current = null;
        markReady();
      }, 1_200);
    });
  };

  const startMove = (event: React.PointerEvent<HTMLButtonElement>, direction: -1 | 1) => {
    if (state.phase !== 'playing') return;
    event.preventDefault();
    if (moveStopTimerRef.current !== null) {
      window.clearTimeout(moveStopTimerRef.current);
      moveStopTimerRef.current = null;
    }
    moveHoldRef.current = { pointerId: event.pointerId, startedAt: performance.now() };
    event.currentTarget.setPointerCapture(event.pointerId);
    void sendInput({ control: 'move', value: direction, sequence: 0 })?.catch(() => undefined);
  };

  const stopMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const hold = moveHoldRef.current;
    if (!hold || hold.pointerId !== event.pointerId) return;
    moveHoldRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const finish = () => {
      moveStopTimerRef.current = null;
      void sendInput({ control: 'move', value: 0, sequence: 0 })?.catch(() => undefined);
    };
    // A quick phone tap must still advance at least one authoritative frame.
    const remaining = Math.max(0, 180 - (performance.now() - hold.startedAt));
    moveStopTimerRef.current = window.setTimeout(finish, remaining);
  };

  const pulseMove = (direction: -1 | 1) => {
    if (state.phase !== 'playing') return;
    if (moveStopTimerRef.current !== null) window.clearTimeout(moveStopTimerRef.current);
    void sendInput({ control: 'move', value: direction, sequence: 0 })?.catch(() => undefined);
    moveStopTimerRef.current = window.setTimeout(() => {
      moveStopTimerRef.current = null;
      void sendInput({ control: 'move', value: 0, sequence: 0 })?.catch(() => undefined);
    }, 220);
  };

  useEffect(() => {
    const releaseMove = () => {
      if (!moveHoldRef.current && moveStopTimerRef.current === null) return;
      moveHoldRef.current = null;
      if (moveStopTimerRef.current !== null) window.clearTimeout(moveStopTimerRef.current);
      moveStopTimerRef.current = null;
      void sendInput({ control: 'move', value: 0, sequence: 0 })?.catch(() => undefined);
    };
    const onVisibility = () => { if (document.hidden) releaseMove(); };
    window.addEventListener('blur', releaseMove);
    document.addEventListener('visibilitychange', onVisibility);
    if (state.phase !== 'playing') releaseMove();
    return () => {
      window.removeEventListener('blur', releaseMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [state.phase]);

  useEffect(() => () => {
    const queuedMove = queuedContinuousRef.current.get('move');
    const hadLiveMove = moveHoldRef.current !== null || moveStopTimerRef.current !== null ||
      (queuedMove !== undefined && queuedMove.value !== 0);
    continuousTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    continuousTimersRef.current.clear();
    queuedContinuousRef.current.clear();
    moveHoldRef.current = null;
    if (readyRetryTimerRef.current !== null) window.clearTimeout(readyRetryTimerRef.current);
    if (moveStopTimerRef.current !== null) window.clearTimeout(moveStopTimerRef.current);
    moveStopTimerRef.current = null;
    if (!hadLiveMove) return;
    // Keep the current request chain alive and enqueue the release after any
    // movement already in flight. Closing the dialog must not leave a remote
    // role moving until it reaches an arena boundary.
    const sequence = ++seqRef.current;
    const release = chainRef.current.catch(() => undefined).then(() => sendActionRef.current('arcade.input', {
      control: 'move',
      value: 0,
      seq: sequence,
      requestId: actionId(),
    }));
    chainRef.current = release.catch(() => undefined);
  }, []);

  const finished = state.phase === 'finished';
  const score = isRecord(state.outcome?.score) ? state.outcome?.score : null;
  const mobileCopy = MOBILE_PRESET_COPY[state.arcade.preset];
  const actionControl = state.self.controls.find((control) => MOBILE_ACTION_COPY[control]);
  const controlsEnabled = state.phase === 'playing';
  const hasCommitted = isRecord(state.self.input) && state.self.input.commit === 1;

  return (
    <div className="carnival-game-backdrop arcade-network-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && context.close()}>
      <section
        ref={dialogRef}
        className="carnival-game-dialog arcade-network-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="carnival-arcade-title"
        tabIndex={-1}
        data-preset={state.arcade.preset}
        data-phase={state.phase}
      >
        <header className="carnival-game-header">
          <div>
            <p className="carnival-game-kicker">专属小游戏 · {state.generatedBy === 'ai' ? 'AI 生成代码' : '安全离线代码'} · {context.inviteId.slice(-6)}</p>
            <h2 id="carnival-arcade-title">{state.title}</h2>
            <small>{roleDefinition?.label ?? state.self.role} · 对方是 {peerRole?.label ?? state.peer.role}</small>
          </div>
          <button type="button" onClick={context.close} aria-label="收起游戏，返回聊天">×</button>
        </header>

        <div className="arcade-network-presence" aria-live="polite">
          <span className={state.self.ready ? 'is-ready' : ''}>我 · {state.self.ready ? '已就位' : '正在加载'}</span>
          <span className={state.peer.ready ? 'is-ready' : ''}>对方 · {state.peer.ready ? '已就位' : '等待进入'}</span>
          <b>{state.phase === 'waiting' ? '双方打开同一张邀请卡后开始' : state.phase === 'countdown' ? '准备开局' : finished ? '本局完成' : '游戏进行中'}</b>
        </div>

        {syncError && <p className="carnival-game-error" role="alert">{syncError}</p>}
        <GeneratedGameSandbox
          className="arcade-network-sandbox"
          artifact={state.artifact}
          role={state.self.role}
          playMode="network"
          mode={state.arcade.preset}
          seed={Number.parseInt(state.artifact.codeHash.slice(0, 8), 16)}
          state={rendererState}
          remoteEvents={state.events}
          allowedControls={state.self.controls}
          paused={state.phase !== 'playing'}
          presentationOnly={mobileGameShell}
          title={state.title}
          onReady={markReady}
          onInput={sendInput}
        />

        {!finished && (
          <section className="arcade-mobile-controls" aria-label={`${mobileCopy.title}，手机主操作区`} data-preset={state.arcade.preset}>
            <header>
              <span className="arcade-mobile-controls__icon" aria-hidden="true">{mobileCopy.icon}</span>
              <div><strong>{mobileCopy.title}</strong><small>{roleDefinition?.label ?? state.self.role} · {roleDefinition?.objective ?? mobileCopy.hint}</small></div>
              <em>{state.phase === 'playing' ? '操作中' : state.phase === 'countdown' ? '准备' : '等待'}</em>
            </header>
            {state.arcade.preset === 'basketball-duel' && state.self.role === 'shooter' ? (
              <div className="arcade-mobile-controls__shooter">
                <label><span>角度 {Math.round(28 + (hostAim + 1) * 22)}°</span><input type="range" min="-1" max="1" step="0.02" value={hostAim} disabled={state.phase !== 'playing'} onChange={(event) => { const value = Number(event.target.value); setHostAim(value); void sendInput({ control: 'aim', value, sequence: 0 })?.catch(() => undefined); }} /></label>
                <label><span>力度 {Math.round(hostPower * 100)}%</span><input type="range" min="0.25" max="1" step="0.02" value={hostPower} disabled={state.phase !== 'playing'} onChange={(event) => { const value = Number(event.target.value); setHostPower(value); void sendInput({ control: 'power', value, sequence: 0 })?.catch(() => undefined); }} /></label>
                <button className="arcade-mobile-controls__primary" type="button" disabled={!controlsEnabled} onClick={() => { void sendInput({ control: 'shoot', value: 1, sequence: 0 })?.catch(() => undefined); }}>● 投篮</button>
              </div>
            ) : state.arcade.preset === 'grid-command' ? (
              <div className="arcade-mobile-controls__strategy">
                <div className="arcade-mobile-controls__grid" role="radiogroup" aria-label="选择九格节点">
                  {Array.from({ length: 9 }, (_, cell) => (
                    <button
                      key={cell}
                      type="button"
                      role="radio"
                      aria-checked={hostSelected === cell}
                      className={hostSelected === cell ? 'is-selected' : ''}
                      disabled={!controlsEnabled || hasCommitted}
                      onClick={() => {
                        setHostSelected(cell);
                        void sendInput({ control: 'select', value: cell, sequence: 0 })?.catch(() => undefined);
                      }}
                    >{cell + 1}</button>
                  ))}
                </div>
                <button className="arcade-mobile-controls__primary" type="button" disabled={!controlsEnabled || hostSelected === null || hasCommitted} onClick={() => { void sendInput({ control: 'commit', value: 1, sequence: 0 })?.catch(() => undefined); }}>{hasCommitted ? '等待对方锁定' : hostSelected === null ? '先选择一个节点' : `锁定 ${hostSelected + 1} 号节点`}</button>
              </div>
            ) : (
              <div className="arcade-mobile-controls__actions">
                {state.self.controls.includes('move') && (
                  <div className="arcade-mobile-controls__direction" aria-label="移动控制">
                    {([-1, 1] as const).map((direction) => (
                      <button
                        key={direction}
                        type="button"
                        disabled={!controlsEnabled}
                        onPointerDown={(event) => startMove(event, direction)}
                        onPointerUp={stopMove}
                        onPointerCancel={stopMove}
                        onLostPointerCapture={stopMove}
                        onClick={(event) => { if (event.detail === 0) pulseMove(direction); }}
                      ><span aria-hidden="true">{direction < 0 ? '←' : '→'}</span>{direction < 0 ? mobileCopy.moveLeft : mobileCopy.moveRight}</button>
                    ))}
                  </div>
                )}
                {actionControl && <button className="arcade-mobile-controls__primary" type="button" disabled={!controlsEnabled} onClick={() => { void sendInput({ control: actionControl, value: 1, sequence: 0 })?.catch(() => undefined); }}>{MOBILE_ACTION_COPY[actionControl]}</button>}
              </div>
            )}
          </section>
        )}

        {finished && (
          <div className="arcade-network-result" role="status" aria-live="polite">
            <span aria-hidden="true">🏁</span>
            <div><strong>这局是真的一起玩完了</strong><p>{score ? `最终记录：${Object.entries(score).map(([key, value]) => `${key} ${value}`).join(' · ')}` : '服务器已经锁定本局结果。'}</p></div>
            {onUseChatPrompt && <button type="button" onClick={() => onUseChatPrompt(`刚才这局「${state.title}」，你最想换个角色重来哪一段？`)}>把赛后话题放进输入框</button>}
          </div>
        )}
      </section>
    </div>
  );
}
