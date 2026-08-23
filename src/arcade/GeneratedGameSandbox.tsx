import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GeneratedGameArtifact } from '../types';
import './arcade.css';

/** Server-owned arcade preset or stable-template id sent as PairPlay v1 `mode`. */
export type PairPlayMode =
  | 'dash-duel'
  | 'tandem-rescue'
  | 'basketball-duel'
  | 'relic-expedition'
  | 'grid-command'
  | 'profile-riddle'
  | 'keyword-wheel'
  | 'rapid-choice';
export type PairPlayValue = number | boolean | string | null
  | { x: number; y: number }
  | { slot: number; optionIndex: number }
  | { selections: [number, number, number] }
  | { questionId: string; answer: 0 | 1 }
  | { questionId: string }
  | Record<string, never>;

export interface PairPlayInput {
  control: string;
  value?: PairPlayValue;
  sequence: number;
}

export interface PairPlayCompleteResult {
  outcome: 'a' | 'b' | 'draw' | 'together';
  score?: { a: number; b: number };
  headline?: string;
}

export interface GeneratedGameSandboxProps {
  artifact: GeneratedGameArtifact;
  role: string;
  /** Preview artifacts simulate locally; network artifacts render host state. */
  playMode?: 'preview' | 'network';
  mode: PairPlayMode;
  seed: number;
  /** State is JSON-cloned, size-capped, and never includes participant secrets. */
  state?: unknown;
  /** Already ordered by the server's monotonic cursor. */
  remoteEvents?: readonly unknown[];
  allowedControls: readonly string[];
  paused?: boolean;
  reducedMotion?: boolean;
  timeoutMs?: number;
  title?: string;
  className?: string;
  fallback?: ReactNode;
  onInput: (input: PairPlayInput) => void | Promise<void>;
  /**
   * Advisory renderer signal only. Never finish a room or persist its score
   * from this callback; authoritative completion is `state.phase=finished`.
   */
  onComplete?: (result: PairPlayCompleteResult, meta: { trusted: false; source: 'sandbox' }) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  onEscape?: () => void;
}

type SandboxStatus = 'verifying' | 'loading' | 'ready' | 'error' | 'stopped';

const PAIRPLAY_VERSION = 1;
const MAX_SYNC_BYTES = 96_000;
const MAX_REMOTE_EVENTS = 240;
const MAX_MESSAGES_PER_SECOND = 90;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key));
}

function createChannel() {
  const bytes = new Uint8Array(24);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function safeJsonClone(value: unknown, maximumBytes = MAX_SYNC_BYTES): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > maximumBytes) return null;
    return JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
}

function safeRuntimeUrl(runtimePath: string) {
  try {
    const url = new URL(runtimePath, window.location.origin);
    const localDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (url.origin !== window.location.origin) return null;
    if (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:')) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (!url.pathname.startsWith('/api/') || url.pathname.includes('..')) return null;
    return url.href;
  } catch {
    return null;
  }
}

function safeArcadePairPlayValue(value: unknown): PairPlayValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= 1_000_000 ? value : undefined;
  if (typeof value === 'string') return value.length <= 80 ? value : undefined;
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length === 2 && keys.includes('x') && keys.includes('y')) {
    const { x, y } = value;
    return typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1_000_000 &&
      typeof y === 'number' && Number.isFinite(y) && Math.abs(y) <= 1_000_000
      ? { x, y }
      : undefined;
  }
  return undefined;
}

function safeGeneratedTemplateValue(control: string, value: unknown): PairPlayValue | undefined {
  if (value === undefined) return ['profile.submit', 'wheel.spin', 'wheel.next'].includes(control) ? undefined : undefined;
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if ((control === 'wheel.spin' || control === 'wheel.next') && keys.length === 0) return {};
  if (control === 'profile.select' && keys.length === 2 && keys.includes('slot') && keys.includes('optionIndex') &&
    Number.isSafeInteger(value.slot) && Number(value.slot) >= 0 && Number(value.slot) <= 2 &&
    Number.isSafeInteger(value.optionIndex) && Number(value.optionIndex) >= 0 && Number(value.optionIndex) <= 2) {
    return { slot: Number(value.slot), optionIndex: Number(value.optionIndex) };
  }
  if (control === 'profile.submit' && keys.length === 1 && Array.isArray(value.selections) && value.selections.length === 3 &&
    value.selections.every((item) => Number.isSafeInteger(item) && Number(item) >= 0 && Number(item) <= 2)) {
    return { selections: value.selections.map(Number) as [number, number, number] };
  }
  if ((control === 'rapid.answer' || control === 'rapid.timeout') &&
    typeof value.questionId === 'string' && /^[A-Za-z0-9_-]{1,40}$/u.test(value.questionId)) {
    if (control === 'rapid.timeout' && keys.length === 1) return { questionId: value.questionId };
    if (control === 'rapid.answer' && keys.length === 2 && keys.includes('answer') && (value.answer === 0 || value.answer === 1)) {
      return { questionId: value.questionId, answer: value.answer };
    }
  }
  return undefined;
}

function safeCompleteResult(value: unknown): PairPlayCompleteResult | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['outcome', 'score', 'headline', 'reason', 'completedAt'])) return null;
  if (value.completedAt !== undefined && (typeof value.completedAt !== 'number' || !Number.isFinite(value.completedAt))) return null;
  if (value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.length > 40)) return null;
  const score = isRecord(value.score) && hasOnlyKeys(value.score, ['a', 'b', 'shooter', 'keeper', 'primary', 'secondary', 'team'])
    ? value.score
    : null;
  if (value.score !== undefined && (!score || Object.values(score).some((item) => typeof item !== 'number' || !Number.isFinite(item)))) return null;
  const explicitOutcome = ['a', 'b', 'draw', 'together'].includes(String(value.outcome))
    ? value.outcome as PairPlayCompleteResult['outcome']
    : null;
  if (!explicitOutcome && !score) return null;
  const left = Number(score?.a ?? score?.shooter ?? score?.primary ?? score?.team ?? 0);
  const right = Number(score?.b ?? score?.keeper ?? score?.secondary ?? score?.team ?? 0);
  const inferredOutcome = score?.team !== undefined
    ? 'together'
    : left > right
      ? 'a'
      : right > left
        ? 'b'
        : 'draw';
  const result: PairPlayCompleteResult = { outcome: explicitOutcome ?? inferredOutcome };
  if (score) result.score = { a: left, b: right };
  if (typeof value.headline === 'string' && value.headline.length <= 100) result.headline = value.headline;
  return result;
}

/**
 * Executes generated game code only inside an opaque-origin iframe. The parent
 * never evals code, never injects HTML, and accepts only PairPlay v1 messages
 * from this exact WindowProxy plus a per-load 192-bit channel.
 */
export function GeneratedGameSandbox({
  artifact,
  role,
  playMode,
  mode,
  seed,
  state,
  remoteEvents = [],
  allowedControls,
  paused = false,
  reducedMotion = false,
  timeoutMs = 8_000,
  title = 'AI 生成的双人小游戏',
  className = '',
  fallback,
  onInput,
  onComplete,
  onReady,
  onError,
  onEscape,
}: GeneratedGameSandboxProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<SandboxStatus>('verifying');
  const [verifiedRuntimeUrl, setVerifiedRuntimeUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const channelRef = useRef(createChannel());
  const sequenceRef = useRef(0);
  const rateRef = useRef({ startedAt: performance.now(), count: 0 });
  const blockedRef = useRef(false);
  const frameLoadCountRef = useRef(0);
  const bootstrapSeenRef = useRef(false);
  const initSentRef = useRef(false);
  const lastSyncSignatureRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const preflightRef = useRef<AbortController | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const runtimeUrl = useMemo(() => safeRuntimeUrl(artifact.runtimePath), [artifact.runtimePath]);
  const validArtifact = /^[a-zA-Z0-9_-]{8,160}$/u.test(artifact.artifactId) && /^[a-f0-9]{64}$/u.test(artifact.codeHash);
  const resolvedPlayMode = playMode ?? (state === undefined || state === null ? 'preview' : 'network');
  const controlList = useMemo(() => [...new Set(allowedControls.filter((control) => /^[a-z][a-z0-9._-]{0,39}$/u.test(control)))].slice(0, 32), [allowedControls]);
  const controls = useMemo(() => new Set(controlList), [controlList]);
  const stateSnapshot = useMemo(() => safeJsonClone(state), [state]);
  const eventSnapshot = useMemo(() => safeJsonClone(remoteEvents.slice(-MAX_REMOTE_EVENTS), MAX_SYNC_BYTES), [remoteEvents]);
  const syncPayload = useMemo(() => ({
    playMode: resolvedPlayMode,
    state: stateSnapshot,
    events: eventSnapshot,
    paused,
    reducedMotion,
    controls: controlList,
  }), [controlList, eventSnapshot, paused, reducedMotion, resolvedPlayMode, stateSnapshot]);
  const syncSignature = useMemo(() => JSON.stringify(syncPayload), [syncPayload]);

  const reportError = useCallback((message: string) => {
    preflightRef.current?.abort();
    preflightRef.current = null;
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    blockedRef.current = true;
    setVerifiedRuntimeUrl(null);
    setStatus('error');
    setErrorMessage(message);
    onErrorRef.current?.(message);
  }, []);

  const post = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    // A sandboxed iframe without allow-same-origin has an opaque `null` origin,
    // so targetOrigin must be `*`; authentication is source + channel instead.
    target.postMessage({ pairplay: PAIRPLAY_VERSION, type, channel: channelRef.current, ...payload }, '*');
  }, []);

  const sendInit = useCallback(() => {
    if (blockedRef.current || initSentRef.current) return;
    initSentRef.current = true;
    post('host.init', {
      artifactId: artifact.artifactId,
      codeHash: artifact.codeHash,
      role: role.slice(0, 40),
      mode,
      seed: Number.isFinite(seed) ? Math.trunc(seed) : 0,
      ...syncPayload,
    });
    // host.init already carries the same public state as host.sync. Remember
    // its semantic payload so parent polling/re-renders cannot make generated
    // games rebuild an unchanged interface and steal focus from the player.
    lastSyncSignatureRef.current = syncSignature;
  }, [artifact.artifactId, artifact.codeHash, mode, post, role, seed, syncPayload, syncSignature]);

  useEffect(() => {
    if (!runtimeUrl || !validArtifact) {
      reportError('游戏运行地址或代码指纹无效，已阻止加载。');
      return undefined;
    }
    const controller = new AbortController();
    preflightRef.current?.abort();
    preflightRef.current = controller;
    let disposed = false;
    setStatus('verifying');
    setVerifiedRuntimeUrl(null);
    setErrorMessage(null);
    frameLoadCountRef.current = 0;
    bootstrapSeenRef.current = false;
    initSentRef.current = false;
    lastSyncSignatureRef.current = null;
    const boundedTimeout = Math.max(3_000, Math.min(20_000, timeoutMs));
    const verificationTimer = window.setTimeout(() => {
      if (disposed) return;
      controller.abort();
      reportError('游戏版本校验超时，已阻止加载。');
    }, boundedTimeout);
    void fetch(runtimeUrl, {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'text/html' },
      signal: controller.signal,
    }).then((response) => {
      if (disposed || controller.signal.aborted) return;
      const contentType = response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
      const codeHash = response.headers.get('X-Arcade-Code-Hash');
      const finalUrl = safeRuntimeUrl(response.url);
      if (!response.ok || response.redirected || finalUrl !== runtimeUrl || contentType !== 'text/html' || codeHash !== artifact.codeHash) {
        throw new Error('RUNTIME_VERSION_MISMATCH');
      }
      window.clearTimeout(verificationTimer);
      preflightRef.current = null;
      setVerifiedRuntimeUrl(runtimeUrl);
      setStatus('loading');
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        reportError('游戏加载超时，可以重新加载或使用安全模板。');
      }, boundedTimeout);
    }).catch((error: unknown) => {
      if (disposed || controller.signal.aborted) return;
      window.clearTimeout(verificationTimer);
      reportError(error instanceof Error && error.message === 'RUNTIME_VERSION_MISMATCH'
        ? '游戏代码指纹不一致，已阻止加载。'
        : '无法校验游戏运行版本，已阻止加载。');
    });
    return () => {
      disposed = true;
      window.clearTimeout(verificationTimer);
      controller.abort();
      if (preflightRef.current === controller) preflightRef.current = null;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [artifact.codeHash, reloadKey, reportError, runtimeUrl, timeoutMs, validArtifact]);

  useEffect(() => {
    if (status === 'error' || status === 'stopped') return undefined;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow || !isRecord(event.data)) return;
      if (blockedRef.current) return;
      const data = event.data;
      const now = performance.now();
      if (now - rateRef.current.startedAt >= 1_000) rateRef.current = { startedAt: now, count: 0 };
      rateRef.current.count += 1;
      if (rateRef.current.count > MAX_MESSAGES_PER_SECOND) {
        blockedRef.current = true;
        reportError('游戏消息频率异常，已停止接收操作。');
        return;
      }

      // Bootstrap contains no data and is accepted only from this exact iframe.
      if (data.pairplay === PAIRPLAY_VERSION && data.type === 'game.bootstrap-ready' && hasOnlyKeys(data, ['pairplay', 'type'])) {
        if (bootstrapSeenRef.current) {
          reportError('游戏运行页发生了异常重载，已停止同步状态。');
          return;
        }
        bootstrapSeenRef.current = true;
        sendInit();
        return;
      }
      if (data.pairplay !== PAIRPLAY_VERSION || data.channel !== channelRef.current || typeof data.type !== 'string') return;

      if (data.type === 'game.ready') {
        if (!hasOnlyKeys(data, ['pairplay', 'type', 'channel'])) return;
        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        setStatus('ready');
        setErrorMessage(null);
        onReady?.();
      } else if (data.type === 'game.input') {
        if (!hasOnlyKeys(data, ['pairplay', 'type', 'channel', 'control', 'value'])) return;
        if (typeof data.control !== 'string' || !controls.has(data.control)) return;
        const hasValue = Object.prototype.hasOwnProperty.call(data, 'value');
        const generatedTemplateMode = mode === 'profile-riddle' || mode === 'keyword-wheel' || mode === 'rapid-choice';
        const value = generatedTemplateMode
          ? safeGeneratedTemplateValue(data.control, data.value)
          : safeArcadePairPlayValue(data.value);
        const optionalTemplateValue = generatedTemplateMode && data.value === undefined &&
          ['profile.submit', 'wheel.spin', 'wheel.next'].includes(data.control);
        if (hasValue && value === undefined && !optionalTemplateValue) return;
        if (!hasValue && generatedTemplateMode && !['profile.submit', 'wheel.spin', 'wheel.next'].includes(data.control)) return;
        const input: PairPlayInput = { control: data.control, sequence: ++sequenceRef.current };
        if (hasValue && value !== undefined) input.value = value;
        try {
          const pending = onInput(input);
          if (pending && typeof pending.then === 'function') void pending.catch(() => reportError('操作同步失败，请检查网络后重试。'));
        } catch {
          reportError('操作同步失败，请检查网络后重试。');
        }
      } else if (data.type === 'game.complete') {
        if (!hasOnlyKeys(data, ['pairplay', 'type', 'channel', 'result'])) return;
        const result = safeCompleteResult(data.result);
        if (result) onComplete?.(result, { trusted: false, source: 'sandbox' });
      } else if (data.type === 'game.error') {
        if (!hasOnlyKeys(data, ['pairplay', 'type', 'channel', 'message'])) return;
        if (typeof data.message === 'string' && data.message.length <= 200) reportError(data.message);
      } else if (data.type === 'game.escape') {
        if (!hasOnlyKeys(data, ['pairplay', 'type', 'channel'])) return;
        onEscape?.();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [controls, mode, onComplete, onEscape, onInput, onReady, reportError, sendInit, status]);

  useEffect(() => {
    if (status !== 'ready') return;
    if (lastSyncSignatureRef.current === syncSignature) return;
    lastSyncSignatureRef.current = syncSignature;
    post('host.sync', syncPayload);
  }, [post, status, syncPayload, syncSignature]);

  useEffect(() => {
    if (status !== 'ready') return;
    post(paused ? 'host.pause' : 'host.resume');
  }, [paused, post, status]);

  const reload = () => {
    preflightRef.current?.abort();
    preflightRef.current = null;
    channelRef.current = createChannel();
    sequenceRef.current = 0;
    rateRef.current = { startedAt: performance.now(), count: 0 };
    blockedRef.current = false;
    frameLoadCountRef.current = 0;
    bootstrapSeenRef.current = false;
    initSentRef.current = false;
    lastSyncSignatureRef.current = null;
    setErrorMessage(null);
    setVerifiedRuntimeUrl(null);
    setStatus('verifying');
    setReloadKey((current) => current + 1);
  };

  const stop = () => {
    post('host.stop');
    preflightRef.current?.abort();
    preflightRef.current = null;
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    blockedRef.current = true;
    setStatus('stopped');
    setErrorMessage(null);
  };

  const handleFrameLoad = () => {
    frameLoadCountRef.current += 1;
    if (frameLoadCountRef.current > 1) {
      reportError('游戏运行页尝试离开已校验版本，已立即停止。');
      return;
    }
    // Some browsers finish the frame load before the bootstrap message is
    // observed. `sendInit` is independently idempotent, so either ordering is
    // safe while a second iframe load still trips the guard above.
    sendInit();
  };

  return (
    <section className={`generated-game-sandbox ${className}`.trim()} aria-label={title} data-code-hash={artifact.codeHash}>
      <header>
        <span><i className={`is-${status}`} aria-hidden="true" />{status === 'ready' ? 'AI GAME · LIVE' : status === 'verifying' ? '正在校验游戏版本' : status === 'loading' ? '正在启动隔离游戏' : status === 'stopped' ? '游戏已停止' : '游戏启动失败'}</span>
        <small title={artifact.codeHash}>版本 {artifact.codeHash.slice(0, 8)}</small>
      </header>
      <div className="generated-game-sandbox__frame">
        {verifiedRuntimeUrl && validArtifact && (status === 'loading' || status === 'ready') ? (
          <iframe
            key={`${artifact.artifactId}-${reloadKey}`}
            ref={iframeRef}
            src={verifiedRuntimeUrl}
            title={title}
            sandbox="allow-scripts"
            allow=""
            referrerPolicy="no-referrer"
            loading="eager"
            onLoad={handleFrameLoad}
          />
        ) : (
          <div className="generated-game-sandbox__empty">{fallback ?? <p>这个生成版本暂时无法运行，请重新生成。</p>}</div>
        )}
        {(status === 'verifying' || status === 'loading') && <div className="generated-game-sandbox__loading" role="status"><span aria-hidden="true" /><strong>{status === 'verifying' ? '正在核对这一局的代码指纹…' : '正在装载真实游戏世界…'}</strong><small>{status === 'verifying' ? '验证通过前不会执行任何游戏代码' : '代码只在隔离沙箱中运行'}</small></div>}
        {status === 'error' && <div className="generated-game-sandbox__loading is-error" role="alert"><strong>{errorMessage}</strong><small>主聊天页面和账户状态没有受到影响</small></div>}
      </div>
      <footer>
        <span>隔离运行 · 不读取主页面资料</span>
        <div>
          <button type="button" onClick={reload}>重新加载</button>
          <button type="button" onClick={stop} disabled={status === 'stopped'}>停止游戏</button>
        </div>
      </footer>
    </section>
  );
}
