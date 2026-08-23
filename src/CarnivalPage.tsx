import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  CarnivalApiError,
  carnivalErrorMessage,
  defaultCarnivalApi,
  isAbortError,
  isCarnivalUnauthorized,
} from './carnival-api';
import {
  buildCarnivalExclusivePrompt,
  CARNIVAL_EXCLUSIVE_SERIES,
  exclusiveSeriesById,
  summarizeCarnivalTopics,
  type CarnivalExclusiveSeriesId,
} from './carnival-exclusive';
import type {
  CarnivalCreateInviteInput,
  CarnivalGameActionResponse,
  CarnivalGameType,
  CarnivalGender,
  CarnivalGamePreview,
  CarnivalInvite,
  CarnivalNetworkGameContext,
  CarnivalPageProps,
  CarnivalParticipant,
  CarnivalState,
  CarnivalTextMessage,
} from './carnival-types';
import { CarnivalGameBridge, type CarnivalGameCompletion } from './components/CarnivalGameBridge';
import { GameResultCardView } from './components/GameResultCard';
import { buildFallbackResultCard, type ResultCardRequest } from './game-result';
import type { GameResultCard } from './types';
import { PromptGamePreviewCard } from './components/PromptGamePreviewCard';
import './carnival.css';

const DEFAULT_STORAGE_KEY = 'liangpei:carnival:token';
const DEFAULT_GAME_TYPES: CarnivalGameType[] = [
  {
    templateId: 'profile-riddle',
    label: '资料猜谜局',
    description: '三组生活候选各选一个，让 TA 很想接着回应。',
    enabled: true,
    available: true,
  },
  {
    templateId: 'keyword-wheel',
    label: '关键词深挖',
    description: '转到一个共同话题，再自然多问一层。',
    enabled: true,
    available: true,
  },
  {
    templateId: 'rapid-choice',
    label: '极限2选1',
    description: '五秒凭直觉作答，最后一起看答案。',
    enabled: true,
    available: true,
  },
  {
    templateId: 'custom',
    label: '专属小游戏',
    description: '写一句 Prompt，AI 现场编写并运行一局真正可操作的双人游戏。',
    enabled: true,
    available: true,
  },
];

const PROMPT_GAME_STAGES = ['理解 Prompt', '设计玩法', '编写代码', '隔离检查'] as const;

const PROMPT_GAME_ESTIMATE_SECONDS = 20;

const REGENERABLE_PREVIEW_ERROR_CODES = new Set([
  'INVALID_GAME_PREVIEW',
  'GAME_PREVIEW_EXPIRED',
  'GAME_PREVIEW_FORBIDDEN',
  'GAME_PREVIEW_MISMATCH',
  'GAME_PREVIEW_STALE',
  'GAME_PREVIEW_ALREADY_USED',
]);

type TimelineEntry =
  | { kind: 'message'; id: string; createdAt: string; message: CarnivalTextMessage }
  | { kind: 'invite'; id: string; createdAt: string; invite: CarnivalInvite }
  | { kind: 'result'; id: string; createdAt: string; card: GameResultCard };

interface PendingInviteDraft extends CarnivalCreateInviteInput {
  label: string;
}

function carnivalResultHistoryKey(roomId: string) {
  return `liangpei:carnival-game-results:${roomId}`;
}

function readCarnivalResultCards(roomId: string): GameResultCard[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(carnivalResultHistoryKey(roomId)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is GameResultCard => Boolean(
      item && typeof item === 'object' && typeof item.id === 'string' &&
      item.templateId !== 'profile-riddle' &&
      typeof item.gameId === 'string' && typeof item.gameTitle === 'string' &&
      typeof item.headline === 'string' && typeof item.summary === 'string',
    ));
  } catch {
    return [];
  }
}

function writeCarnivalResultCards(roomId: string, cards: GameResultCard[]) {
  if (typeof window === 'undefined') return;
  try {
    let serialized = JSON.stringify(cards);
    if (serialized.length > 3_500_000) {
      serialized = JSON.stringify(cards.map((card) => ({ ...card, backgroundUrl: undefined })));
    }
    window.localStorage.setItem(carnivalResultHistoryKey(roomId), serialized);
  } catch {
    // The current in-memory timeline remains usable when storage is unavailable.
  }
}

function safeReadToken(storageKey: string) {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function safeWriteToken(storageKey: string, token: string) {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(storageKey, token);
    return true;
  } catch {
    return false;
  }
}

function safeRemoveToken(storageKey: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // The in-memory session is still cleared when storage is unavailable.
  }
}

function requestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `invite-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function waitForVisibleBuildStages(startedAt: number, signal: AbortSignal) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const remaining = Math.max(0, 2_600 - (Date.now() - startedAt));
  if (remaining === 0 || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = window.setTimeout(finish, remaining);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function gamePreviewContextFingerprint(room: {
  roomId: string;
  messages: CarnivalTextMessage[];
} | undefined) {
  if (!room) return '';
  return JSON.stringify([
    room.roomId,
    room.messages.map((message) => [
      message.messageId,
      message.senderId,
      message.content,
      message.createdAt,
    ]),
  ]);
}

function regenerablePreviewErrorMessage(error: CarnivalApiError) {
  if (error.code === 'GAME_PREVIEW_STALE') return '聊天刚有新内容，旧预览已失效。请按最新聊天重新生成后再邀请。';
  if (error.code === 'GAME_PREVIEW_EXPIRED') return '这份可玩预览已过期，请重新生成一个邀请版本。';
  if (error.code === 'GAME_PREVIEW_ALREADY_USED') return '这个预览版本已经发过邀请，请重新生成一个新版本。';
  if (error.code === 'GAME_PREVIEW_MISMATCH') return 'Prompt 或玩法已变化，请重新生成与当前内容一致的预览。';
  return '这个预览版本已经不可用，请重新生成后再发邀请。';
}

function moveRadioGroupChoice(event: KeyboardEvent<HTMLButtonElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const group = event.currentTarget.parentElement;
  if (!group) return;
  const options = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  const current = options.indexOf(event.currentTarget);
  if (current < 0 || options.length === 0) return;
  event.preventDefault();
  const next = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? options.length - 1
      : (current + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
  options[next]?.focus();
  options[next]?.click();
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function localPrompt(
  option: CarnivalGameType,
  messages: CarnivalTextMessage[] = [],
  seriesId?: CarnivalExclusiveSeriesId,
) {
  if (option.templateId === 'custom' && seriesId) {
    return buildCarnivalExclusivePrompt(seriesId, messages);
  }
  const mechanic = option.templateId === 'profile-riddle'
    ? '生成三个不同生活场景，每组恰好三个口语化行为候选；后台维度不展示，双方每组各选一个组成一句，完成后再一起揭晓。不要使用宽泛人格词或直接复述资料。'
    : option.templateId === 'keyword-wheel'
      ? '从公开聊天主题生成转盘，每个关键词配一条低压力追问。'
      : option.templateId === 'rapid-choice'
        ? '生成 3–5 道五秒二选一，双方完成后再一起查看答案。'
        : '根据双方公开聊天，生成一个轻量、可跳过的双人破冰玩法。';
  return `请为我们生成一局「${option.label}」。\n\n${mechanic}\n\n题面简短、轻松，不输出关系结论或私密资料，双方都可以选择不回答。`;
}

function inviteGameLabel(invitation: CarnivalInvite) {
  return exclusiveSeriesById(invitation.seriesId)?.shortTitle ?? invitation.gameLabel;
}

function genderLabel(gender: CarnivalGender) {
  return gender === 'female' ? '女生' : '男生';
}

function inviteStatus(status: CarnivalInvite['status'], mine: boolean) {
  if (status === 'generating') return '正在生成';
  if (status === 'ready') return mine ? '等待对方' : '等你加入';
  if (status === 'joined') return '双方已加入';
  if (status === 'playing') return '进行中';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '生成失败';
  return '已结束';
}

function useModalFocus(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const preferred = dialog?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)');
      const firstEnabled = dialog?.querySelector<HTMLElement>(
        'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      );
      (preferred ?? firstEnabled ?? dialog)?.focus();
    });
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
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
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  return dialogRef;
}

function CarnivalAvatar({ participant, small = false }: { participant: CarnivalParticipant; small?: boolean }) {
  return (
    <span
      className={`carnival-avatar is-${participant.gender} ${small ? 'is-small' : ''}`}
      aria-label={`${participant.nickname}的头像`}
    >
      {participant.nickname.trim().slice(0, 1) || '你'}
    </span>
  );
}

function ModalShell({
  open,
  title,
  onClose,
  children,
  className = '',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const dialogRef = useModalFocus(open, onClose);
  const titleId = `${useId()}-title`;
  if (!open) return null;
  return (
    <div className="carnival-modal-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={dialogRef}
        className={`carnival-modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="carnival-modal__header">
          <div><span>双人游园会</span><h2 id={titleId}>{title}</h2></div>
          <button type="button" onClick={onClose} aria-label="关闭">×</button>
        </header>
        {children}
      </section>
    </div>
  );
}

export default function CarnivalPage({
  api = defaultCarnivalApi,
  pollIntervalMs = 1_000,
  storageKey = DEFAULT_STORAGE_KEY,
  renderNetworkGame,
  onOpenNetworkGame,
}: CarnivalPageProps) {
  const [token, setToken] = useState<string | null>(() => safeReadToken(storageKey));
  const [carnivalState, setCarnivalState] = useState<CarnivalState | null>(null);
  const stateRef = useRef<CarnivalState | null>(null);
  const mountedRef = useRef(true);
  const controllersRef = useRef(new Set<AbortController>());
  const [restoring, setRestoring] = useState(Boolean(token));
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [manualSyncing, setManualSyncing] = useState(false);
  const manualSyncingRef = useRef(false);
  const [nickname, setNickname] = useState('');
  const [gender, setGender] = useState<CarnivalGender | ''>('');
  const [joining, setJoining] = useState(false);
  const joiningRef = useRef(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const messageSendingRef = useRef(false);
  const [messageError, setMessageError] = useState<string | null>(null);

  const [studioOpen, setStudioOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('profile-riddle');
  const [selectedSeriesId, setSelectedSeriesId] = useState<CarnivalExclusiveSeriesId | null>(null);
  const [prompt, setPrompt] = useState('');
  const [promptMaxLength, setPromptMaxLength] = useState(1_500);
  const [promptStatus, setPromptStatus] = useState<'idle' | 'loading' | 'editing'>('idle');
  const [promptError, setPromptError] = useState<string | null>(null);
  const promptVersionRef = useRef(0);
  const promptControllerRef = useRef<AbortController | null>(null);
  const [gamePreview, setGamePreview] = useState<CarnivalGamePreview | null>(null);
  const [gamePreviewStatus, setGamePreviewStatus] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [gamePreviewError, setGamePreviewError] = useState<string | null>(null);
  const [gamePreviewStage, setGamePreviewStage] = useState(0);
  const [gamePreviewCountdown, setGamePreviewCountdown] = useState(0);
  const gamePreviewVersionRef = useRef(0);
  const gamePreviewControllerRef = useRef<AbortController | null>(null);
  const gamePreviewContextRef = useRef<string | null>(null);
  const latestRoomContextRef = useRef('');

  const [inviteSending, setInviteSending] = useState(false);
  const inviteSendingRef = useRef(false);
  const [pendingInvite, setPendingInvite] = useState<PendingInviteDraft | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [activeInviteId, setActiveInviteId] = useState<string | null>(null);
  const [openingInviteId, setOpeningInviteId] = useState<string | null>(null);
  const [openInviteError, setOpenInviteError] = useState<string | null>(null);
  const [unlockAnnounced, setUnlockAnnounced] = useState(false);
  const [resultCards, setResultCards] = useState<GameResultCard[]>([]);
  const resultRoomIdRef = useRef<string | null>(null);
  const resultCardIdsRef = useRef(new Set<string>());
  const previousGateRef = useRef<{ roomId: string; unlocked: boolean } | null>(null);
  const timelineRef = useRef<HTMLElement>(null);
  const nearBottomRef = useRef(true);

  const makeController = useCallback(() => {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    return controller;
  }, []);
  const releaseController = useCallback((controller: AbortController) => {
    controllersRef.current.delete(controller);
  }, []);

  const invalidateGamePreview = useCallback(() => {
    gamePreviewVersionRef.current += 1;
    gamePreviewControllerRef.current?.abort();
    gamePreviewControllerRef.current = null;
    gamePreviewContextRef.current = null;
    setGamePreview(null);
    setGamePreviewStatus('idle');
    setGamePreviewError(null);
    setGamePreviewStage(0);
  }, []);
  const rejectBrokenGamePreview = useCallback((message: string) => {
    invalidateGamePreview();
    setGamePreviewStatus('error');
    setGamePreviewError(`${message} 这份代码不会被发送，请重新生成一版。`);
  }, [invalidateGamePreview]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
      promptControllerRef.current?.abort();
      gamePreviewControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (gamePreviewStatus !== 'generating') return undefined;
    setGamePreviewStage(0);
    const timer = window.setInterval(() => {
      setGamePreviewStage((current) => Math.min(PROMPT_GAME_STAGES.length - 1, current + 1));
    }, 650);
    return () => window.clearInterval(timer);
  }, [gamePreviewStatus]);

  useEffect(() => {
    if (gamePreviewStatus !== 'generating') {
      setGamePreviewCountdown(0);
      return undefined;
    }
    setGamePreviewCountdown(PROMPT_GAME_ESTIMATE_SECONDS);
    const timer = window.setInterval(() => {
      setGamePreviewCountdown((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [gamePreviewStatus]);

  const applyState = useCallback((nextState: CarnivalState) => {
    if (!mountedRef.current) return;
    const current = stateRef.current;
    if (current && nextState.revision < current.revision) return;
    stateRef.current = nextState;
    setCarnivalState(nextState);
    setSyncError(null);
  }, []);

  const clearLocalSession = useCallback((notice?: string) => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
    promptControllerRef.current?.abort();
    promptControllerRef.current = null;
    promptVersionRef.current += 1;
    invalidateGamePreview();
    safeRemoveToken(storageKey);
    stateRef.current = null;
    setCarnivalState(null);
    setToken(null);
    setRestoring(false);
    setRestoreError(null);
    setSyncError(null);
    setStudioOpen(false);
    setSelectedSeriesId(null);
    setActiveInviteId(null);
    setOpeningInviteId(null);
    setOpenInviteError(null);
    setPendingInvite(null);
    setInviteError(null);
    inviteSendingRef.current = false;
    setInviteSending(false);
    messageSendingRef.current = false;
    setMessageSending(false);
    setMessageError(null);
    setDraft('');
    manualSyncingRef.current = false;
    setManualSyncing(false);
    setLeaveError(null);
    setJoinError(notice ?? null);
  }, [invalidateGamePreview, storageKey]);

  const restoreSession = useCallback(async (sessionToken: string) => {
    const controller = makeController();
    setRestoring(true);
    setRestoreError(null);
    try {
      const nextState = await api.getState(sessionToken, controller.signal);
      if (!controller.signal.aborted) applyState(nextState);
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error) || !mountedRef.current) return;
      if (isCarnivalUnauthorized(error)) {
        clearLocalSession('上次游园会已经结束，请重新加入。');
        return;
      }
      setRestoreError(carnivalErrorMessage(error));
    } finally {
      releaseController(controller);
      if (mountedRef.current) setRestoring(false);
    }
  }, [api, applyState, clearLocalSession, makeController, releaseController]);

  useEffect(() => {
    if (!token || stateRef.current) {
      setRestoring(false);
      return;
    }
    void restoreSession(token);
  }, [restoreSession, token]);

  const hasState = Boolean(carnivalState);
  const activeArcade = Boolean(activeInviteId && carnivalState?.room?.invites.some((invitation) => (
    invitation.inviteId === activeInviteId &&
    invitation.game?.definition &&
    typeof invitation.game.definition === 'object' &&
    'engine' in invitation.game.definition &&
    invitation.game.definition.engine === 'arcade-v1'
  )));
  const safePollInterval = activeArcade ? 200 : Math.max(700, Math.min(5_000, pollIntervalMs));
  useEffect(() => {
    if (!token || !hasState) return undefined;
    let stopped = false;
    let timer: number | null = null;
    let activeController: AbortController | null = null;
    const poll = async () => {
      const controller = makeController();
      activeController = controller;
      try {
        const nextState = await api.getState(token, controller.signal);
        if (!stopped && !controller.signal.aborted) applyState(nextState);
      } catch (error) {
        if (stopped || isAbortError(error) || !mountedRef.current) return;
        if (isCarnivalUnauthorized(error)) {
          clearLocalSession('登录状态已失效，请重新加入游园会。');
          return;
        }
        setSyncError(carnivalErrorMessage(error));
      } finally {
        releaseController(controller);
        if (activeController === controller) activeController = null;
        if (!stopped && !controller.signal.aborted) timer = window.setTimeout(poll, safePollInterval);
      }
    };
    timer = window.setTimeout(poll, safePollInterval);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      activeController?.abort();
    };
  }, [api, applyState, clearLocalSession, hasState, makeController, releaseController, safePollInterval, token]);

  const room = carnivalState?.status === 'matched' ? carnivalState.room : undefined;
  useEffect(() => {
    const roomId = room?.roomId ?? null;
    if (resultRoomIdRef.current === roomId) return;
    resultRoomIdRef.current = roomId;
    const cards = roomId ? readCarnivalResultCards(roomId) : [];
    resultCardIdsRef.current = new Set(cards.map((card) => card.gameId));
    setResultCards(cards);
  }, [room?.roomId]);

  useEffect(() => {
    const roomId = room?.roomId;
    if (!roomId || resultRoomIdRef.current !== roomId) return;
    writeCarnivalResultCards(roomId, resultCards);
  }, [resultCards, room?.roomId]);



  const self = carnivalState?.self;
  const partner = room?.participants.find((participant) => participant.participantId !== self?.participantId);
  const currentRoomContext = useMemo(() => gamePreviewContextFingerprint(room), [room]);
  latestRoomContextRef.current = currentRoomContext;
  const gameTypes = useMemo(() => {
    const configured = carnivalState?.gameTypes.filter((option) => option.enabled) ?? [];
    const visible = configured.length > 0 ? configured : DEFAULT_GAME_TYPES;
    return visible.map((option) => option.templateId === 'custom'
      ? {
          ...option,
          available: true,
          description: !option.description || option.description.includes('三轮')
            ? '写一句 Prompt，AI 现场编写并运行一局真正可操作的双人游戏。'
            : option.description,
        }
      : option);
  }, [carnivalState?.gameTypes]);
  const hasAvailableGame = gameTypes.some((option) => option.available);
  const selectedGameType = gameTypes.find((option) => option.templateId === selectedTemplateId)
    ?? gameTypes.find((option) => option.available)
    ?? gameTypes[0];
  const selectedSeries = exclusiveSeriesById(selectedSeriesId);
  const messageCount = room?.textMessageCount ?? 0;
  const inviteThreshold = room?.inviteThreshold ?? 10;
  const gameUnlocked = Boolean(room && (
    carnivalState?.canInvite || room.canInvite || messageCount >= inviteThreshold
  ));
  const progressValue = Math.min(messageCount, inviteThreshold);
  const exclusiveTopics = useMemo(
    () => summarizeCarnivalTopics(room?.messages ?? []),
    [room?.messages],
  );
  const exclusiveSeriesOptions = useMemo(() => {
    const promptArcade = CARNIVAL_EXCLUSIVE_SERIES.find((series) => series.id === 'prompt-arcade');
    return promptArcade ? [promptArcade] : [];
  }, []);

  useEffect(() => {
    const previewContext = gamePreviewContextRef.current;
    if (
      !previewContext ||
      previewContext === currentRoomContext ||
      (!gamePreview && gamePreviewStatus !== 'generating')
    ) return;
    invalidateGamePreview();
    setGamePreviewStatus('error');
    setGamePreviewError('聊天刚有新内容，已清除旧预览。请按最新上下文重新生成。');
  }, [currentRoomContext, gamePreview, gamePreviewStatus, invalidateGamePreview]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    if (!room) return [];
    return [
      ...room.messages.map((item) => ({
        kind: 'message' as const,
        id: item.messageId,
        createdAt: item.createdAt,
        message: item,
      })),
      ...room.invites.map((item) => ({
        kind: 'invite' as const,
        id: item.inviteId,
        createdAt: item.createdAt,
        invite: item,
      })),
      ...resultCards.map((card) => ({
        kind: 'result' as const,
        id: card.id,
        createdAt: card.createdAt,
        card,
      })),
    ].sort((left, right) => {
      const time = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      return time || left.id.localeCompare(right.id);
    });
  }, [room, resultCards]);

  const partnerEnteredInvite = useMemo(() => {
    if (!room || !self || !partner) return null;
    return room.invites
      .filter((invitation) => (
        invitation.status === 'playing' &&
        invitation.joinedParticipantIds.includes(partner.participantId) &&
        !invitation.joinedParticipantIds.includes(self.participantId)
      ))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null;
  }, [partner, room, self]);

  useEffect(() => {
    const timelineElement = timelineRef.current;
    if (timelineElement && nearBottomRef.current) {
      timelineElement.scrollTop = timelineElement.scrollHeight;
    }
  }, [timeline.length]);

  const refreshState = useCallback(async () => {
    if (!token) throw new Error('Carnival session is missing');
    const controller = makeController();
    try {
      const nextState = await api.getState(token, controller.signal);
      if (controller.signal.aborted) throw new DOMException('Request aborted', 'AbortError');
      applyState(nextState);
      return nextState;
    } catch (error) {
      if (isCarnivalUnauthorized(error)) clearLocalSession('登录状态已失效，请重新加入游园会。');
      throw error;
    } finally {
      releaseController(controller);
    }
  }, [api, applyState, clearLocalSession, makeController, releaseController, token]);

  const retrySync = useCallback(async () => {
    if (manualSyncingRef.current) return;
    manualSyncingRef.current = true;
    setManualSyncing(true);
    setSyncError(null);
    try {
      await refreshState();
    } catch (error) {
      if (!isAbortError(error) && !isCarnivalUnauthorized(error) && mountedRef.current) {
        setSyncError(carnivalErrorMessage(error));
      }
    } finally {
      manualSyncingRef.current = false;
      if (mountedRef.current) setManualSyncing(false);
    }
  }, [refreshState]);

  async function joinCarnival(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanNickname = nickname.trim();
    if (joiningRef.current || cleanNickname.length < 2 || !gender) return;
    joiningRef.current = true;
    setJoining(true);
    setJoinError(null);
    const controller = makeController();
    try {
      const response = await api.join({ nickname: cleanNickname, gender }, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      const stored = safeWriteToken(storageKey, response.token);
      applyState(response.state);
      setToken(response.token);
      if (!stored) setSyncError('浏览器未允许保存登录状态；刷新后可能需要重新加入。');
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error) && mountedRef.current) {
        setJoinError(carnivalErrorMessage(error));
      }
    } finally {
      releaseController(controller);
      joiningRef.current = false;
      if (mountedRef.current) setJoining(false);
    }
  }

  async function leaveCarnival() {
    if (!token || leaving) return;
    setLeaving(true);
    setLeaveError(null);
    const controller = makeController();
    try {
      await api.deleteSession(token, controller.signal);
      if (!controller.signal.aborted) clearLocalSession();
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error) && mountedRef.current) {
        if (isCarnivalUnauthorized(error)) clearLocalSession();
        else setLeaveError(carnivalErrorMessage(error));
      }
    } finally {
      releaseController(controller);
      if (mountedRef.current) setLeaving(false);
    }
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!token || !room || !content || messageSendingRef.current) return;
    messageSendingRef.current = true;
    setMessageSending(true);
    setMessageError(null);
    setDraft('');
    const controller = makeController();
    try {
      const nextState = await api.sendMessage(token, content, controller.signal);
      if (!controller.signal.aborted) applyState(nextState);
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error) && mountedRef.current) {
        if (isCarnivalUnauthorized(error)) clearLocalSession('登录状态已失效，请重新加入游园会。');
        else {
          setDraft((current) => current || content);
          setMessageError(carnivalErrorMessage(error));
        }
      }
    } finally {
      releaseController(controller);
      messageSendingRef.current = false;
      if (mountedRef.current) setMessageSending(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  const loadPrompt = useCallback(async (
    option: CarnivalGameType,
    seriesId?: CarnivalExclusiveSeriesId,
  ) => {
    if (!token) return;
    if (option.templateId === 'custom' && !seriesId) return;
    invalidateGamePreview();
    promptControllerRef.current?.abort();
    const controller = makeController();
    promptControllerRef.current = controller;
    const version = ++promptVersionRef.current;
    setSelectedTemplateId(option.templateId);
    setSelectedSeriesId(option.templateId === 'custom' ? seriesId ?? null : null);
    setPromptStatus('loading');
    setPromptError(null);
    setPrompt('');
    try {
      const preview = await api.getPrompt(token, option.templateId, controller.signal, seriesId);
      if (controller.signal.aborted || version !== promptVersionRef.current || !mountedRef.current) return;
      setPrompt(preview.prompt);
      setPromptMaxLength(preview.maxLength);
      setPromptStatus('editing');
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error) || version !== promptVersionRef.current || !mountedRef.current) return;
      if (isCarnivalUnauthorized(error)) {
        clearLocalSession('登录状态已失效，请重新加入游园会。');
        return;
      }
      setPrompt(localPrompt(option, room?.messages ?? [], seriesId));
      setPromptMaxLength(1_500);
      setPromptStatus('editing');
      setPromptError(`${carnivalErrorMessage(error)} 已准备本地版本，可重试或直接修改。`);
    } finally {
      releaseController(controller);
      if (promptControllerRef.current === controller) promptControllerRef.current = null;
    }
  }, [api, clearLocalSession, invalidateGamePreview, makeController, releaseController, room?.messages, token]);

  function selectGameType(option: CarnivalGameType) {
    if (!option.available) return;
    if (option.templateId === 'custom') {
      void loadPrompt(option, 'prompt-arcade');
      return;
    }
    void loadPrompt(option);
  }

  function selectExclusiveSeries(seriesId: CarnivalExclusiveSeriesId) {
    const custom = gameTypes.find((option) => option.templateId === 'custom');
    if (!custom?.available) return;
    void loadPrompt(custom, seriesId);
  }

  function openStudio() {
    if (!gameUnlocked || inviteSendingRef.current || !hasAvailableGame) return;
    const firstAvailable = gameTypes.find((option) => option.available);
    if (!firstAvailable) return;
    setStudioOpen(true);
    setInviteError(null);
    setSelectedSeriesId(null);
    invalidateGamePreview();
    void loadPrompt(firstAvailable);
  }

  function closeStudio() {
    promptVersionRef.current += 1;
    promptControllerRef.current?.abort();
    promptControllerRef.current = null;
    invalidateGamePreview();
    setStudioOpen(false);
  }

  async function generateGamePreview() {
    if (
      !token ||
      !selectedGameType?.available ||
      selectedGameType.templateId !== 'custom' ||
      !selectedSeriesId ||
      prompt.trim().length < 20 ||
      gamePreviewStatus === 'generating'
    ) return;
    const contextAtStart = currentRoomContext;
    invalidateGamePreview();
    gamePreviewContextRef.current = contextAtStart;
    const controller = makeController();
    gamePreviewControllerRef.current = controller;
    const version = gamePreviewVersionRef.current;
    setGamePreviewStatus('generating');
    setGamePreviewError(null);
    const startedAt = Date.now();
    try {
      const nextPreview = await api.createGamePreview(token, {
        templateId: 'custom',
        seriesId: selectedSeriesId,
        prompt: prompt.trim(),
      }, controller.signal);
      await waitForVisibleBuildStages(startedAt, controller.signal);
      if (controller.signal.aborted || version !== gamePreviewVersionRef.current || !mountedRef.current) return;
      if (nextPreview.game.seriesId !== selectedSeriesId) {
        gamePreviewContextRef.current = null;
        setGamePreviewStatus('error');
        setGamePreviewError('生成结果与所选系列不一致，请重新生成。');
        return;
      }
      if (contextAtStart !== latestRoomContextRef.current) {
        invalidateGamePreview();
        setGamePreviewStatus('error');
        setGamePreviewError('生成期间聊天有了新内容，请按最新上下文重新生成。');
        return;
      }
      setGamePreview(nextPreview);
      setGamePreviewStage(PROMPT_GAME_STAGES.length);
      setGamePreviewStatus('ready');
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error) || version !== gamePreviewVersionRef.current || !mountedRef.current) return;
      if (error instanceof CarnivalApiError && REGENERABLE_PREVIEW_ERROR_CODES.has(error.code)) {
        gamePreviewContextRef.current = null;
        setGamePreviewStatus('error');
        setGamePreviewError(regenerablePreviewErrorMessage(error));
        return;
      }
      if (isCarnivalUnauthorized(error)) {
        clearLocalSession('登录状态已失效，请重新加入游园会。');
        return;
      }
      gamePreviewContextRef.current = null;
      setGamePreviewStatus('error');
      setGamePreviewError(carnivalErrorMessage(error));
    } finally {
      releaseController(controller);
      if (gamePreviewControllerRef.current === controller) gamePreviewControllerRef.current = null;
    }
  }

  function editPrompt(value: string) {
    invalidateGamePreview();
    setPrompt(value);
    setPromptStatus('editing');
    setPromptError(null);
  }

  const submitInvite = useCallback(async (draftInvite: PendingInviteDraft) => {
    if (!token || inviteSendingRef.current) return;
    inviteSendingRef.current = true;
    setInviteSending(true);
    setInviteError(null);
    setPendingInvite(draftInvite);
    setStudioOpen(false);
    const controller = makeController();
    try {
      const response = await api.createInvite(token, draftInvite, controller.signal);
      if (!controller.signal.aborted) {
        applyState(response.state);
        setPendingInvite(null);
      }
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error) && mountedRef.current) {
        if (error instanceof CarnivalApiError && REGENERABLE_PREVIEW_ERROR_CODES.has(error.code)) {
          const message = regenerablePreviewErrorMessage(error);
          invalidateGamePreview();
          setPendingInvite(null);
          setInviteError(null);
          setGamePreviewStatus('error');
          setGamePreviewError(message);
          setStudioOpen(true);
        } else if (isCarnivalUnauthorized(error)) {
          clearLocalSession('登录状态已失效，请重新加入游园会。');
        } else {
          setInviteError(carnivalErrorMessage(error));
        }
      }
    } finally {
      releaseController(controller);
      inviteSendingRef.current = false;
      if (mountedRef.current) setInviteSending(false);
    }
  }, [api, applyState, clearLocalSession, invalidateGamePreview, makeController, releaseController, token]);

  function handleCarnivalGameComplete(completion: CarnivalGameCompletion) {
    if (completion.invitation.templateId === 'profile-riddle') return;
    const cardKey = completion.invitation.inviteId;
    if (resultCardIdsRef.current.has(cardKey)) return;
    resultCardIdsRef.current.add(cardKey);
    const game: ResultCardRequest['game'] = {
      id: completion.invitation.inviteId,
      matchId: completion.roomId,
      templateId: completion.invitation.templateId as ResultCardRequest['game']['templateId'],
      gameType: completion.invitation.gameLabel,
      title: completion.invitation.title,
      description: completion.invitation.promptPreview || completion.invitation.title,
    };
    const placeholder = buildFallbackResultCard(game, completion.result, completion.players, 'generating');
    setResultCards((current) => [...current, placeholder]);
    void fetch('/api/games/result-card', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game,
        result: completion.result,
        players: completion.players,
        conversation: (room?.messages ?? []).slice(-20).map((message) => ({
          speaker: room?.participants.findIndex((participant) => participant.participantId === message.senderId) === 1 ? 'b' : 'a',
          content: message.content.slice(0, 500),
        })),
      }),
    }).then(async (response) => {
      const payload = (await response.json().catch(() => ({}))) as { card?: GameResultCard };
      if (!response.ok || !payload.card) throw new Error('Result card request failed');
      setResultCards((current) => current.map((card) => card.id === placeholder.id
        ? { ...payload.card!, id: placeholder.id, status: payload.card!.generatedBy === 'ai' ? 'ready' : 'fallback' }
        : card));
    }).catch(() => {
      setResultCards((current) => current.map((card) => card.id === placeholder.id
        ? { ...placeholder, status: 'fallback' }
        : card));
    });
  }

  // Polling can observe a completed invite even when an external renderer owns the modal.
  // Generate the result card from the persisted public game state so the chat timeline does not
  // depend on the user reopening the game at exactly the moment it finishes.
  useEffect(() => {
    if (!room || !self || !partner) return;
    for (const invitation of room.invites) {
      const definition = invitation.game?.definition;
      if (invitation.status !== 'completed' || !definition || typeof definition !== 'object') continue;
      handleCarnivalGameComplete({
        invitation,
        result: definition,
        roomId: room.roomId,
        players: {
          a: { nickname: self.nickname },
          b: { nickname: partner.nickname },
        },
      });
    }
  }, [partner, room, self]);

  function createInvite() {
    const customPreview = selectedGameType?.templateId === 'custom' && gamePreview &&
      gamePreview.game.seriesId === selectedSeriesId &&
      gamePreviewContextRef.current === currentRoomContext &&
      Date.parse(gamePreview.expiresAt) > Date.now()
      ? gamePreview
      : null;
    if (
      !selectedGameType ||
      !selectedGameType.available ||
      prompt.trim().length < 20 ||
      (selectedGameType.templateId === 'custom' && (!selectedSeriesId || !customPreview))
    ) return;
    void submitInvite({
      templateId: selectedGameType.templateId,
      ...(selectedSeriesId ? { seriesId: selectedSeriesId } : {}),
      prompt: prompt.trim(),
      ...(customPreview ? { previewToken: customPreview.previewToken } : {}),
      idempotencyKey: requestId(),
      label: exclusiveSeriesById(selectedSeriesId)?.shortTitle ?? selectedGameType.label,
    });
  }

  const sendGameAction = useCallback(async (
    inviteId: string,
    action: string,
    payload?: unknown,
  ): Promise<CarnivalGameActionResponse> => {
    if (!token) throw new Error('Carnival session is missing');
    const controller = makeController();
    try {
      const response = await api.gameAction(token, { inviteId, action, payload }, controller.signal);
      if (controller.signal.aborted) throw new DOMException('Request aborted', 'AbortError');
      applyState(response.state);
      return response;
    } catch (error) {
      if (isCarnivalUnauthorized(error)) clearLocalSession('登录状态已失效，请重新加入游园会。');
      throw error;
    } finally {
      releaseController(controller);
    }
  }, [api, applyState, clearLocalSession, makeController, releaseController, token]);

  const makeGameContext = useCallback((invitation: CarnivalInvite): CarnivalNetworkGameContext | null => {
    if (!room || !self || !partner) return null;
    return {
      inviteId: invitation.inviteId,
      invitation,
      roomId: room.roomId,
      self,
      partner,
      sendAction: (action, payload) => sendGameAction(invitation.inviteId, action, payload),
      refresh: refreshState,
      close: () => setActiveInviteId(null),
    };
  }, [partner, refreshState, room, self, sendGameAction]);

  async function openInvitation(invitation: CarnivalInvite) {
    setOpenInviteError(null);
    const context = makeGameContext(invitation);
    if (!context) return;
    if (renderNetworkGame || !onOpenNetworkGame) {
      setActiveInviteId(invitation.inviteId);
      return;
    }
    if (openingInviteId) return;
    setOpeningInviteId(invitation.inviteId);
    try {
      await onOpenNetworkGame(context);
    } catch (error) {
      setOpenInviteError(carnivalErrorMessage(error));
    } finally {
      if (mountedRef.current) setOpeningInviteId(null);
    }
  }

  const activeInvite = room?.invites.find((invitation) => invitation.inviteId === activeInviteId) ?? null;
  const activeGameContext = activeInvite ? makeGameContext(activeInvite) : null;
  const modalOpen = studioOpen || Boolean(activeGameContext);
  const gamePreviewExpired = Boolean(gamePreview && (
    !Number.isFinite(Date.parse(gamePreview.expiresAt)) || Date.parse(gamePreview.expiresAt) <= Date.now()
  ));
  const hasCurrentGamePreview = Boolean(
    gamePreview &&
    !gamePreviewExpired &&
    gamePreview.game.seriesId === selectedSeriesId &&
    gamePreviewContextRef.current === currentRoomContext,
  );

  if (restoring) {
    return (
      <main className="carnival-page carnival-page--center">
        <section className="carnival-state-card" role="status" aria-live="polite">
          <span className="carnival-orbit" aria-hidden="true">✦</span>
          <p className="carnival-eyebrow">正在回到游园会</p>
          <h1>恢复上次的匹配与聊天…</h1>
          <p>刷新不会丢掉当前身份，马上就好。</p>
        </section>
      </main>
    );
  }

  if (token && !carnivalState && restoreError) {
    return (
      <main className="carnival-page carnival-page--center">
        <section className="carnival-state-card">
          <span className="carnival-orbit is-error" aria-hidden="true">!</span>
          <p className="carnival-eyebrow">暂时没接上</p>
          <h1>上次的会话还在</h1>
          <p role="alert">{restoreError}</p>
          <div className="carnival-state-card__actions">
            <button className="carnival-primary" type="button" onClick={() => void restoreSession(token)}>重试恢复</button>
            <button className="carnival-secondary" type="button" onClick={() => clearLocalSession()}>换个身份加入</button>
          </div>
        </section>
      </main>
    );
  }

  if (!token || !carnivalState) {
    return (
      <main className="carnival-page carnival-page--register">
        <div className="carnival-lantern carnival-lantern--one" aria-hidden="true" />
        <div className="carnival-lantern carnival-lantern--two" aria-hidden="true" />
        <section className="carnival-register-card">
          <div className="carnival-brand"><span aria-hidden="true">游</span><div><strong>心动游园会</strong></div></div>
          <div className="carnival-register-card__intro">
            <p className="carnival-eyebrow">先遇见，再慢慢聊</p>
            <h1>领一张今晚的入园票</h1>
            <p>填写昵称与性别，系统只会为你匹配一位异性伙伴。聊满十条消息后，你们就能互相发起专属游戏。</p>
          </div>
          <form onSubmit={joinCarnival} noValidate>
            <label className="carnival-field">
              <span>怎么称呼你</span>
              <input
                value={nickname}
                required
                minLength={2}
                maxLength={20}
                autoComplete="nickname"
                placeholder="输入 2–20 个字的昵称"
                onChange={(event) => setNickname(event.target.value)}
                aria-describedby="carnival-nickname-help"
                data-autofocus
              />
              <small id="carnival-nickname-help">只展示给这次匹配到的伙伴</small>
            </label>
            <fieldset className="carnival-gender-field">
              <legend>你的性别</legend>
              <div>
                {(['female', 'male'] as CarnivalGender[]).map((item) => (
                  <label key={item} className={`is-${item} ${gender === item ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      required
                      name="carnival-gender"
                      value={item}
                      checked={gender === item}
                      onChange={() => setGender(item)}
                    />
                    <span aria-hidden="true">{item === 'female' ? '♀' : '♂'}</span>
                    <strong>{genderLabel(item)}</strong>
                  </label>
                ))}
              </div>
            </fieldset>
            {joinError && <p className="carnival-error" role="alert">{joinError}</p>}
            <button
              className="carnival-primary carnival-primary--wide"
              type="submit"
              disabled={joining || nickname.trim().length < 2 || !gender}
            >
              {joining ? '正在领取入园票…' : '进入游园会'} <span aria-hidden="true">→</span>
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (carnivalState.status === 'queued' || !room || !partner || !self) {
    return (
      <main className="carnival-page carnival-page--center">
        <section className="carnival-state-card carnival-waiting-card">
          <div className="carnival-waiting-people" aria-hidden="true">
            <CarnivalAvatar participant={carnivalState.self} />
            <span><i /><i /><i /></span>
            <span className="carnival-avatar is-unknown">?</span>
          </div>
          <p className="carnival-eyebrow">匹配摊位 · 寻找中</p>
          <h1>{carnivalState.self.nickname}，正在为你找一位异性伙伴</h1>
          <div className="carnival-waiting-note" role="status" aria-live="polite"><span aria-hidden="true">◌</span> 等待对方也走进游园会…</div>
          {syncError && <p className="carnival-error" role="alert">{syncError} <button type="button" onClick={() => void retrySync()} disabled={manualSyncing}>{manualSyncing ? '正在重试' : '立即重试'}</button></p>}
          {leaveError && <p className="carnival-error" role="alert">{leaveError}</p>}
          <button className="carnival-text-button" type="button" onClick={() => void leaveCarnival()} disabled={leaving}>
            {leaving ? '正在退出…' : '退出等待'}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={`carnival-page carnival-chat-page ${modalOpen ? 'is-modal-open' : ''}`}>
      <section
        className="carnival-chat-shell"
        aria-label="游园会双人聊天室"
        aria-hidden={modalOpen ? true : undefined}
        inert={modalOpen ? true : undefined}
      >
        <header className="carnival-chat-header">
          <div className="carnival-chat-person">
            <CarnivalAvatar participant={partner} />
            <div><span>今晚的游园伙伴</span><strong>{partner.nickname}</strong><small><i /> 已匹配</small></div>
          </div>
          <div className="carnival-chat-header__actions">
            <button type="button" onClick={() => void retrySync()} disabled={manualSyncing} aria-label={manualSyncing ? '正在同步聊天' : '立即同步聊天'}>↻</button>
            <button type="button" onClick={() => void leaveCarnival()} disabled={leaving} aria-label="退出游园会">⋯</button>
          </div>
        </header>

        <section className={`carnival-gate ${gameUnlocked ? 'is-unlocked' : ''}`} aria-labelledby="carnival-gate-title">
          <div className="carnival-gate__copy">
            <span className="carnival-gate__icon" aria-hidden="true">{gameUnlocked ? '🎟' : '✦'}</span>
            <div>
              <p id="carnival-gate-title">{gameUnlocked ? '游戏摊位已解锁' : '一起聊满 10 条，解锁游戏摊位'}</p>
              <span>{gameUnlocked ? '现在双方都可以发起多局游戏' : `还差 ${Math.max(0, inviteThreshold - messageCount)} 条消息`}</span>
            </div>
          </div>
          <div className="carnival-gate__progress">
            <progress max={inviteThreshold} value={progressValue} aria-label={`聊天进度 ${progressValue}/${inviteThreshold}`} />
            <strong>{progressValue}/{inviteThreshold}</strong>
          </div>
          {gameUnlocked && (
            <button className="carnival-gate__button" type="button" onClick={openStudio} disabled={inviteSending || !hasAvailableGame}>
              {inviteSending ? '邀请生成中' : hasAvailableGame ? '挑一局游戏' : '暂无可用玩法'}
            </button>
          )}
        </section>

        {syncError && (
          <div className="carnival-sync-error" role="alert">
            <span>{syncError}</span><button type="button" onClick={() => void retrySync()} disabled={manualSyncing}>{manualSyncing ? '正在同步' : '重试同步'}</button>
          </div>
        )}
        {leaveError && (
          <div className="carnival-sync-error" role="alert">
            <span>{leaveError}</span><button type="button" onClick={() => void leaveCarnival()} disabled={leaving}>{leaving ? '正在退出' : '重试退出'}</button>
          </div>
        )}

        {partnerEnteredInvite && (
          <div className="carnival-game-waiting" role="status" aria-live="polite">
            <span className="carnival-game-waiting__icon" aria-hidden="true">🎮</span>
            <div>
              <strong>{partner.nickname} 已经进入「{inviteGameLabel(partnerEnteredInvite)}」游戏，在等你了</strong>
              <p>点击进入游戏，和 TA 直接开始这一局。</p>
            </div>
            <button type="button" onClick={() => void openInvitation(partnerEnteredInvite)} disabled={Boolean(openingInviteId)}>
              {openingInviteId === partnerEnteredInvite.inviteId ? '正在进入…' : '进入游戏'}
            </button>
          </div>
        )}

        <section
          className="carnival-timeline"
          ref={timelineRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          onScroll={(event) => {
            const element = event.currentTarget;
            nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
          }}
        >
          <div className="carnival-timeline__date"><span>你们在游园会相遇了</span></div>
          {timeline.length === 0 && (
            <div className="carnival-empty-chat"><span aria-hidden="true">👋</span><p>先打个招呼吧。每一句都在靠近游戏摊位。</p></div>
          )}
          {timeline.map((entry) => {
            if (entry.kind === 'result') {
              return (
                <article className="carnival-result-entry" key={`result-${entry.id}`}>
                  <GameResultCardView
                    card={entry.card}
                    onPrompt={(text) => {
                      setDraft(text);
                      setActiveInviteId(null);
                      window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('.carnival-composer textarea')?.focus(), 50);
                    }}
                  />
                  <time dateTime={entry.createdAt}>{formatClock(entry.createdAt)}</time>
                </article>
              );
            }
            if (entry.kind === 'message') {
              const mine = entry.message.senderId === self.participantId;
              const author = mine ? self : partner;
              return (
                <article className={`carnival-message is-${author.gender} ${mine ? 'is-mine' : ''}`} key={`message-${entry.id}`}>
                  {!mine && <CarnivalAvatar participant={author} small />}
                  <div><p>{entry.message.content}</p><time dateTime={entry.message.createdAt}>{formatClock(entry.message.createdAt)}</time></div>
                </article>
              );
            }
            const mine = entry.invite.creatorId === self.participantId;
            const creator = mine ? self : partner;
            const opening = openingInviteId === entry.invite.inviteId;
            const cardGameLabel = inviteGameLabel(entry.invite);
            return (
              <article className={`carnival-invite ${mine ? 'is-mine' : ''}`} key={`invite-${entry.invite.inviteId}`}>
                <div className="carnival-invite__topline">
                  <span>{creator.nickname} 发起</span>
                  <em className={`is-${entry.invite.status}`}>{inviteStatus(entry.invite.status, mine)}</em>
                </div>
                <div className="carnival-invite__ticket" aria-hidden="true"><span>{entry.invite.seriesId ? 'EXCLUSIVE' : 'GAME'}</span><strong>{cardGameLabel}</strong></div>
                <h2>{entry.invite.title}</h2>
                {entry.invite.promptPreview && <p>{entry.invite.promptPreview}</p>}
                <button
                  type="button"
                  data-invite-id={entry.invite.inviteId}
                  onClick={() => void openInvitation(entry.invite)}
                  disabled={Boolean(openingInviteId)}
                  aria-label={`打开 ${creator.nickname} 发起的 ${cardGameLabel}，邀请 ${entry.invite.inviteId}`}
                >
                  {opening ? '正在打开…' : mine ? '打开我发起的这一局' : '打开对方发起的这一局'} <span aria-hidden="true">→</span>
                </button>
                <small>邀请编号 · {entry.invite.inviteId.slice(-8)}</small>
              </article>
            );
          })}

          {(inviteSending || inviteError) && pendingInvite && (
            <div className={`carnival-pending-invite ${inviteError ? 'is-error' : ''}`} role={inviteError ? 'alert' : 'status'}>
              <span aria-hidden="true">{inviteError ? '!' : '✦'}</span>
              <div className="carnival-pending-invite__copy">
                <strong>{inviteError ? '邀请还没发出去' : `正在生成「${pendingInvite.label}」邀请`}</strong>
                <p>{inviteError ?? '你可以继续聊天；生成完成后卡片会自动出现在时间线。'}</p>
              </div>
              {inviteError && (
                <div className="carnival-pending-invite__actions">
                  <button type="button" onClick={() => void submitInvite(pendingInvite)} disabled={inviteSending}>重试发送</button>
                  <button type="button" onClick={() => { setPendingInvite(null); setInviteError(null); }}>放弃</button>
                </div>
              )}
            </div>
          )}

          {openInviteError && <p className="carnival-error carnival-error--timeline" role="alert">{openInviteError}</p>}
        </section>

        <footer className={`carnival-composer is-${self.gender}`}>
          {gameUnlocked && (
            <button className="carnival-composer__game" type="button" onClick={openStudio} disabled={inviteSending || !hasAvailableGame} aria-label="发起一局游戏">
              {inviteSending ? '…' : '🎲'}
            </button>
          )}
          <textarea
            value={draft}
            maxLength={1_000}
            rows={1}
            placeholder={`和 ${partner.nickname} 说点什么…`}
            aria-label={`给 ${partner.nickname} 发消息`}
            onChange={(event) => { setDraft(event.target.value); setMessageError(null); }}
            onKeyDown={onComposerKeyDown}
          />
          <button className="carnival-composer__send" type="button" onClick={() => void sendMessage()} disabled={!draft.trim() || messageSending}>
            {messageSending ? '发送中' : '发送'}
          </button>
          {messageError && <p role="alert">{messageError}</p>}
        </footer>
      </section>

      <ModalShell open={studioOpen} title="挑一局，发给 TA" onClose={closeStudio} className="carnival-game-studio">
        <div className="carnival-game-types" role="group" aria-label="选择游戏类型">
          {gameTypes.map((option) => (
            <button
              key={option.templateId}
              type="button"
              className={selectedGameType?.templateId === option.templateId ? 'is-selected' : ''}
              aria-pressed={selectedGameType?.templateId === option.templateId}
              disabled={!option.available}
              onClick={() => selectGameType(option)}
            >
              <span aria-hidden="true">{option.templateId === 'profile-riddle' ? '🔎' : option.templateId === 'keyword-wheel' ? '🎡' : option.templateId === 'rapid-choice' ? '🃏' : '✨'}</span>
              <strong>{option.label}</strong>
              <small>{option.available ? option.description : '等待团队模块接入'}</small>
            </button>
          ))}
        </div>

        {selectedGameType?.templateId === 'custom' && (
          <section className="carnival-exclusive-picker" aria-labelledby="carnival-exclusive-picker-title">
            <div className="carnival-exclusive-picker__intro">
              <div>
                <span>专属小游戏 · 从聊天里现做</span>
                <h3 id="carnival-exclusive-picker-title">说一句，现场生成一局真的</h3>
              </div>
            </div>
            <div className="carnival-exclusive-series" role="radiogroup" aria-label="选择专属小游戏系列">
              {exclusiveSeriesOptions.map((series) => (
                <button
                  key={series.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedSeriesId === series.id}
                  tabIndex={selectedSeriesId === series.id || (!selectedSeriesId && series === exclusiveSeriesOptions[0]) ? 0 : -1}
                  className={`is-${series.tone} ${selectedSeriesId === series.id ? 'is-selected' : ''}`}
                  onClick={() => selectExclusiveSeries(series.id)}
                  onKeyDown={moveRadioGroupChoice}
                >
                  <span className="carnival-exclusive-series__icon" aria-hidden="true">{series.icon}</span>
                  <span className="carnival-exclusive-series__copy">
                    <span>{series.eyebrow}<em>现场生成</em></span>
                    <strong>{series.title}</strong>
                    <small>{series.description}</small>
                    <span className="carnival-exclusive-series__foot"><i>{series.duration}</i><b>选这局 →</b></span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <label className="carnival-prompt-field">
          <span>{selectedSeries ? `「${selectedSeries.shortTitle}」Prompt` : '本局 Prompt'} <em>{gamePreview ? '修改后需重新生成预览' : '可以在发出前修改'}</em></span>
          <textarea
            value={prompt}
            maxLength={promptMaxLength}
            rows={9}
            disabled={promptStatus === 'loading' || (selectedGameType?.templateId === 'custom' && !selectedSeries)}
            placeholder={promptStatus === 'loading'
              ? '正在根据你们的聊天生成…'
              : selectedGameType?.templateId === 'custom' && !selectedSeries
                ? '请先从上方选择一种专属系列'
                : '写下希望这局更关注什么'}
            onChange={(event) => editPrompt(event.target.value)}
            data-autofocus
          />
          <small>{prompt.length}/{promptMaxLength}</small>
        </label>
        {promptStatus === 'loading' && <p className="carnival-studio-status" role="status">正在准备游戏内容…</p>}
        {promptError && (
          <div className="carnival-studio-error" role="alert">
            <span>{promptError}</span>
            {selectedGameType && (
              <button type="button" onClick={() => void loadPrompt(selectedGameType, selectedSeries?.id)}>重试生成</button>
            )}
          </div>
        )}
        {selectedGameType?.templateId === 'custom' && gamePreviewStatus === 'generating' && (
          <section className="carnival-prompt-game-building" role="status" aria-live="polite" aria-label={`正在${PROMPT_GAME_STAGES[gamePreviewStage] ?? '生成游戏'}`}>
            <header><span aria-hidden="true">✦</span><div><strong>正在把 Prompt 变成可玩的游戏</strong></div><b className="carnival-prompt-game-building__countdown">{gamePreviewCountdown > 0 ? `预计 ${gamePreviewCountdown} 秒` : '马上就好'}</b></header>
            <ol>
              {PROMPT_GAME_STAGES.map((title, index) => (
                <li key={title} className={index < gamePreviewStage ? 'is-complete' : index === gamePreviewStage ? 'is-current' : ''}>
                  <i aria-hidden="true">{index < gamePreviewStage ? '✓' : index + 1}</i>
                  <span><strong>{title}</strong></span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {selectedGameType?.templateId === 'custom' && gamePreviewError && (
          <div className="carnival-studio-error" role="alert">
            <span>{gamePreviewError}</span>
            <button type="button" onClick={() => void generateGamePreview()}>重试生成预览</button>
          </div>
        )}
        {selectedGameType?.templateId === 'custom' && gamePreview && (
          <PromptGamePreviewCard
            key={gamePreview.previewToken}
            preview={gamePreview}
            expired={gamePreviewExpired}
            onRuntimeError={rejectBrokenGamePreview}
          />
        )}
        <footer className="carnival-game-studio__actions">
          <button className="carnival-secondary" type="button" onClick={closeStudio}>先不发</button>
          <button
            className="carnival-primary"
            type="button"
            disabled={
              promptStatus === 'loading' ||
              gamePreviewStatus === 'generating' ||
              prompt.trim().length < 20 ||
              !selectedGameType?.available ||
              (selectedGameType.templateId === 'custom' && !selectedSeries)
            }
            onClick={() => {
              if (selectedGameType?.templateId === 'custom' && !hasCurrentGamePreview) void generateGamePreview();
              else createInvite();
            }}
          >
            {selectedGameType?.templateId === 'custom'
              ? hasCurrentGamePreview
                ? '用这个版本发邀请'
                : gamePreviewStatus === 'generating'
                  ? `正在${PROMPT_GAME_STAGES[gamePreviewStage] ?? '生成'}`
                  : gamePreviewExpired
                    ? '重新生成可玩预览'
                    : '生成可玩预览'
              : '生成邀请卡片'} <span aria-hidden="true">→</span>
          </button>
        </footer>
      </ModalShell>

      {activeGameContext && !renderNetworkGame && (
        <CarnivalGameBridge
          context={activeGameContext}
          onUseChatPrompt={(text) => {
            setDraft(text);
            setActiveInviteId(null);
            window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('.carnival-composer textarea')?.focus(), 50);
          }}
          onGameComplete={handleCarnivalGameComplete}
        />
      )}
      {renderNetworkGame && (
        <ModalShell
          open={Boolean(activeGameContext)}
          title={activeInvite?.title ?? '打开这一局'}
          onClose={() => setActiveInviteId(null)}
          className="carnival-network-game"
        >
          {activeGameContext ? renderNetworkGame(activeGameContext) : null}
        </ModalShell>
      )}
    </main>
  );
}

export type {
  CarnivalNetworkGameContext,
  CarnivalPageProps,
} from './carnival-types';
