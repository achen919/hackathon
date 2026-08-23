import { useEffect, useMemo, useRef, useState } from 'react';
import type { ParticipantId } from '../types';
import { BasketballDuel } from './BasketballDuel';
import { MeteorRescue } from './MeteorRescue';
import { NeonPaddles } from './NeonPaddles';
import { RuinsRelay } from './RuinsRelay';
import { SignalGrid } from './SignalGrid';
import { arcadeDescriptor, normalizeArcadeDefinition } from './registry';
import type {
  ArcadeGameInput,
  ArcadeGameResult,
  ArcadeGameRuntimeProps,
  ArcadeInputEvent,
} from './types';
import './arcade.css';

const CATEGORY_LABELS = {
  competition: '实时对抗',
  cooperation: '双人合作',
  sport: '运动攻防',
  adventure: '合作冒险',
  strategy: '回合策略',
} as const;

const CATEGORY_ICONS = {
  competition: '⚡',
  cooperation: '✦',
  sport: '●',
  adventure: '◇',
  strategy: '⌗',
} as const;

function createEventId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `arcade-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mergeEvents(remote: readonly ArcadeInputEvent[], optimistic: readonly ArcadeInputEvent[]) {
  const unique = new Map<string, ArcadeInputEvent>();
  // The backend's array order is authoritative. Per-player sequence numbers and
  // client clocks are deliberately not compared across two devices.
  for (const event of remote) unique.set(event.eventId, event);
  for (const event of optimistic) {
    if (!unique.has(event.eventId)) unique.set(event.eventId, event);
  }
  return [...unique.values()];
}

function resultSummary(result: ArcadeGameResult, players: ArcadeGameRuntimeProps['players']) {
  if (result.outcome === 'together') return '这局不是答案卡：你们刚才确实一起控制了同一个游戏世界。';
  if (result.outcome === 'draw') return '没有标准答案，你们在真实操作里打成了平局。';
  return `${players[result.outcome].nickname} 拿下这一局，换个角色可以马上再来。`;
}

export function ArcadeGameRuntime({
  definition: rawDefinition,
  viewer,
  players,
  sessionKey = 'arcade-local',
  paused = false,
  remoteEvents = [],
  onInput,
  onComplete,
  onViewerChange,
  onExit,
  mode,
  allowPerspectiveSwitch = false,
  className = '',
}: ArcadeGameRuntimeProps) {
  const definition = useMemo(() => normalizeArcadeDefinition(rawDefinition), [rawDefinition]);
  const descriptor = arcadeDescriptor(definition.kind);
  const [activeViewer, setActiveViewer] = useState(viewer);
  const [optimisticEvents, setOptimisticEvents] = useState<ArcadeInputEvent[]>([]);
  const [localRound, setLocalRound] = useState(0);
  const [result, setResult] = useState<ArcadeGameResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const localPreview = mode === 'local-preview' || (mode === undefined && !onInput && remoteEvents.length === 0);
  const runtimeKey = `${sessionKey}-${localRound}`;
  const events = useMemo(() => mergeEvents(remoteEvents, optimisticEvents), [optimisticEvents, remoteEvents]);

  useEffect(() => setActiveViewer(viewer), [viewer]);
  useEffect(() => {
    setOptimisticEvents([]);
    setResult(null);
    setSyncError(null);
    sequenceRef.current = 0;
  }, [sessionKey]);

  useEffect(() => {
    if (remoteEvents.length === 0 || optimisticEvents.length === 0) return;
    const confirmed = new Set(remoteEvents.map((event) => event.eventId));
    if (!optimisticEvents.some((event) => confirmed.has(event.eventId))) return;
    setOptimisticEvents((current) => current.filter((event) => !confirmed.has(event.eventId)));
  }, [optimisticEvents, remoteEvents]);

  const emit = (input: ArcadeGameInput, force = false) => {
    if (paused || (result && !force)) return;
    const event: ArcadeInputEvent = {
      eventId: createEventId(),
      participantId: activeViewer,
      sequence: ++sequenceRef.current,
      clientAtMs: Date.now(),
      input,
    };
    setOptimisticEvents((current) => [...current.slice(-199), event]);
    if (!onInput) return;
    setSyncError(null);
    try {
      const pending = onInput(event);
      if (pending && typeof pending.then === 'function') {
        void pending.catch(() => setSyncError('操作暂时没有同步到对方，正在保留本地画面。'));
      }
    } catch {
      setSyncError('操作暂时没有同步到对方，正在保留本地画面。');
    }
  };

  const finish = (nextResult: ArcadeGameResult) => {
    setResult(nextResult);
    onComplete?.(nextResult);
  };

  const changeViewer = (nextViewer: ParticipantId) => {
    setActiveViewer(nextViewer);
    onViewerChange?.(nextViewer);
  };

  const gameProps = {
    definition,
    viewer: activeViewer,
    players,
    paused: paused || Boolean(result),
    events,
    emit,
    onComplete: finish,
    soloAssist: localPreview,
    sessionKey: runtimeKey,
  };

  return (
    <section
      className={`arcade-runtime tone-${definition.theme.accent} backdrop-${definition.theme.backdrop} ${className}`.trim()}
      aria-label={`${definition.title}，${CATEGORY_LABELS[definition.category]}`}
      data-arcade-engine="arcade-v1"
      data-arcade-kind={definition.kind}
    >
      <header className="arcade-runtime__header">
        <div className="arcade-runtime__mark" aria-hidden="true">{CATEGORY_ICONS[definition.category]}</div>
        <div>
          <p><span>REAL PLAY</span> {CATEGORY_LABELS[definition.category]} · {descriptor.label}</p>
          <h2>{definition.title}</h2>
          <small>{definition.subtitle}</small>
        </div>
        {onExit && <button className="arcade-runtime__close" type="button" onClick={onExit} aria-label="退出小游戏">×</button>}
      </header>

      <div className="arcade-runtime__roles" aria-label="双方游戏角色">
        {(['a', 'b'] as const).map((participant, index) => (
          <button
            key={participant}
            type="button"
            className={activeViewer === participant ? 'is-active' : ''}
            aria-pressed={activeViewer === participant}
            disabled={!allowPerspectiveSwitch || Boolean(result)}
            onClick={() => changeViewer(participant)}
          >
            <i aria-hidden="true">{players[participant].nickname.trim().slice(0, 1) || (participant === 'a' ? 'A' : 'B')}</i>
            <span><strong>{players[participant].nickname}</strong><small>{descriptor.roles[index]}</small></span>
            {activeViewer === participant && <em>当前操作</em>}
          </button>
        ))}
      </div>

      {syncError && <p className="arcade-runtime__error" role="alert">{syncError}</p>}
      {localPreview && <p className="arcade-runtime__preview-note"><span aria-hidden="true">●</span> 本地试玩模式 · 未操作的一方由游戏助手接管</p>}

      <div className="arcade-runtime__stage" inert={result ? true : undefined}>
        {definition.kind === 'basketball-duel' && <BasketballDuel {...gameProps} />}
        {definition.kind === 'neon-paddles' && <NeonPaddles {...gameProps} />}
        {definition.kind === 'meteor-rescue' && <MeteorRescue {...gameProps} />}
        {definition.kind === 'ruins-relay' && <RuinsRelay {...gameProps} />}
        {definition.kind === 'signal-grid' && <SignalGrid {...gameProps} />}
      </div>

      {result && (
        <div className="arcade-runtime__result" role="status" aria-live="polite">
          <span aria-hidden="true">{result.outcome === 'together' ? '✦' : result.outcome === 'draw' ? '↔' : '⚑'}</span>
          <p>本局完成</p>
          <h3>{result.headline}</h3>
          <small>{resultSummary(result, players)}</small>
          <div>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setOptimisticEvents([]);
                setLocalRound((current) => current + 1);
                if (!localPreview) emit({ kind: 'session.restart' }, true);
              }}
            >再玩一局</button>
            {onExit && <button type="button" onClick={onExit}>回到聊天</button>}
          </div>
        </div>
      )}

      <footer className="arcade-runtime__footer">
        <span>{localPreview ? '可切换双方视角试玩完整操作' : '双方操作通过同一局实时同步'}</span>
        <small>触控 · 键盘 · 手机横竖屏</small>
      </footer>
    </section>
  );
}
