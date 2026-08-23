import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { GameTemplateId, ParticipantId } from '../types';
import '../carnival-game.css';

export type CarnivalStableTemplateId = Exclude<GameTemplateId, 'custom'>;

export interface CarnivalParticipantPublicState {
  nickname: string;
  joined: boolean;
  online: boolean;
}

/**
 * Public invite projection. `revision` must increase after every accepted action.
 * The server should reject actions whose expectedRevision is stale.
 */
export interface CarnivalInvitePublicState {
  inviteId: string;
  revision: number;
  status: 'waiting' | 'active' | 'completed' | 'cancelled' | 'expired';
  templateId: CarnivalStableTemplateId;
  createdBy: ParticipantId;
  participants: Record<ParticipantId, CarnivalParticipantPublicState>;
}

interface CarnivalGamePublicBase {
  inviteId: string;
  revision: number;
  serverNowMs: number;
  templateId: CarnivalStableTemplateId;
  title: string;
  description: string;
}

export interface CarnivalProfileSubmission {
  author: ParticipantId;
  target: ParticipantId;
  keywords: [string, string, string];
  sentence: string;
}

export interface CarnivalProfileChoiceGroup {
  id: string;
  options: [string, string, string];
}

/**
 * Participant-scoped projection: before `phase === 'revealed'`, the server MUST
 * omit the peer's keywords and sentence. Only booleans are shared pre-reveal.
 */
export interface CarnivalProfileRiddlePublicState extends CarnivalGamePublicBase {
  templateId: 'profile-riddle';
  phase: 'collecting' | 'reveal-ready' | 'revealed';
  target: { participantId: ParticipantId; nickname: string };
  choiceGroups: [CarnivalProfileChoiceGroup, CarnivalProfileChoiceGroup, CarnivalProfileChoiceGroup];
  /** Legacy flat list retained while previously persisted invites age out. */
  keywordOptions: string[];
  submitted: Record<ParticipantId, boolean>;
  revealReady: Record<ParticipantId, boolean>;
  mySubmission?: CarnivalProfileSubmission;
  revealedSubmissions?: Record<ParticipantId, CarnivalProfileSubmission>;
}

export interface CarnivalWheelSegment {
  id: string;
  keyword: string;
  prompt: string;
  followUps: string[];
}

/** The server chooses the segment and the final absolute rotation. */
export interface CarnivalKeywordWheelPublicState extends CarnivalGamePublicBase {
  templateId: 'keyword-wheel';
  phase: 'ready' | 'spinning' | 'selected';
  segments: CarnivalWheelSegment[];
  spinSequence: number;
  rotationDeg: number;
  selectedSegmentId?: string;
  revealAtMs?: number;
  followUpIndex: number;
  lastSpunBy?: ParticipantId;
  canSpin: boolean;
}

export interface CarnivalRapidQuestion {
  id: string;
  prompt: string;
  options: [string, string];
  matchedDiscussionPrompt: string;
  differentDiscussionPrompt: string;
}

export type CarnivalRapidAnswer = 0 | 1 | 'timeout';

export interface CarnivalRapidResult {
  questionId: string;
  answers: Record<ParticipantId, CarnivalRapidAnswer>;
}

/**
 * Participant-scoped projection: `self` is the authenticated participant.
 * Peer answers MUST only be present in `results` when phase is `revealed`.
 * Deadlines are server epoch milliseconds and must also be enforced server-side.
 */
export interface CarnivalRapidChoicePublicState extends CarnivalGamePublicBase {
  templateId: 'rapid-choice';
  phase: 'answering' | 'waiting-peer' | 'reveal-ready' | 'revealed';
  roundSeconds: 5;
  questions: CarnivalRapidQuestion[];
  self: {
    participantId: ParticipantId;
    answeredCount: number;
    completed: boolean;
    currentQuestionId?: string;
    deadlineAtMs?: number;
  };
  peer: {
    participantId: ParticipantId;
    answeredCount: number;
    completed: boolean;
  };
  revealReady: Record<ParticipantId, boolean>;
  results?: CarnivalRapidResult[];
}

export type CarnivalGamePublicState =
  | CarnivalProfileRiddlePublicState
  | CarnivalKeywordWheelPublicState
  | CarnivalRapidChoicePublicState;

export type CarnivalGameActionPayload =
  | {
      type: 'profile-riddle.submit';
      keywords: [string, string, string];
    }
  | { type: 'profile-riddle.confirm-reveal' }
  | { type: 'keyword-wheel.spin' }
  | { type: 'keyword-wheel.next-follow-up' }
  | {
      type: 'rapid-choice.answer';
      questionId: string;
      answer: 0 | 1;
    }
  | {
      type: 'rapid-choice.timeout';
      questionId: string;
    }
  | { type: 'rapid-choice.confirm-reveal' };

export type CarnivalGameAction = CarnivalGameActionPayload & {
  requestId: string;
  expectedRevision: number;
};

export interface CarnivalGameDialogProps {
  open: boolean;
  participant: ParticipantId;
  invite: CarnivalInvitePublicState;
  /** Null while waiting for the second participant or initial game state. */
  gameState: CarnivalGamePublicState | null;
  actionPending?: boolean;
  actionError?: string | null;
  onAction: (inviteId: string, action: CarnivalGameAction) => Promise<void>;
  onClose: () => void;
  onUseChatPrompt?: (text: string) => void;
}

type ActionRunner = (payload: CarnivalGameActionPayload) => Promise<boolean>;

const OTHER: Record<ParticipantId, ParticipantId> = { a: 'b', b: 'a' };

function requestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `game-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cleanOptions(options: string[]) {
  return [...new Set(options.map((option) => option.trim()).filter((option) => option.length > 0))].slice(0, 16);
}

const FALLBACK_PROFILE_GROUPS: [CarnivalProfileChoiceGroup, CarnivalProfileChoiceGroup, CarnivalProfileChoiceGroup] = [
  { id: 'profile-weekend', options: ['睡醒再决定安排', '约好一件事就够', '喜欢把一天排满'] },
  { id: 'profile-food', options: ['先看评价再选店', '想吃什么当场定', '会为一家店绕路'] },
  { id: 'profile-decision', options: ['先列几个选项再定', '听完建议马上决定', '容易当场改变主意'] },
];

function normalizedProfileGroups(state: CarnivalProfileRiddlePublicState): CarnivalProfileChoiceGroup[] {
  const groups = state.choiceGroups?.slice(0, 3).map((group) => ({
    id: group.id,
    options: cleanOptions(group.options).slice(0, 3),
  })).filter((group) => group.options.length === 3);
  if (groups?.length === 3) return groups as CarnivalProfileChoiceGroup[];
  const flat = cleanOptions([...state.keywordOptions, ...FALLBACK_PROFILE_GROUPS.flatMap((group) => group.options)]);
  return FALLBACK_PROFILE_GROUPS.map((fallback, index) => ({
    id: fallback.id,
    options: flat.slice(index * 3, index * 3 + 3) as [string, string, string],
  }));
}

function profileSentence(target: string, keywords: string[]) {
  if (keywords.length !== 3 || keywords.some((keyword) => !keyword)) return '';
  return `我觉得${target}是一个${keywords[0]}、${keywords[1]}，而且${keywords[2]}的人。`;
}

function answerLabel(question: CarnivalRapidQuestion, answer: CarnivalRapidAnswer) {
  if (answer === 'timeout') return '超时未选';
  return `${answer === 0 ? 'A' : 'B'} · ${question.options[answer]}`;
}

function gameFocusKey(
  gameState: CarnivalGamePublicState | null,
  inviteStatus: CarnivalInvitePublicState['status'],
  participant: ParticipantId,
) {
  if (!gameState) return `invite-${inviteStatus}`;
  if (gameState.templateId === 'profile-riddle') {
    return `${gameState.templateId}-${gameState.phase}-${gameState.submitted[participant]}`;
  }
  if (gameState.templateId === 'keyword-wheel') {
    return `${gameState.templateId}-${gameState.phase}-${gameState.spinSequence}-${gameState.followUpIndex}`;
  }
  return `${gameState.templateId}-${gameState.phase}-${gameState.self.currentQuestionId ?? 'none'}`;
}

export function CarnivalGameDialog({
  open,
  participant,
  invite,
  gameState,
  actionPending = false,
  actionError = null,
  onAction,
  onClose,
  onUseChatPrompt,
}: CarnivalGameDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const actionLockRef = useRef(false);
  const [localPending, setLocalPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  closeRef.current = onClose;

  const revision = gameState?.revision ?? invite.revision;
  const dispatchAction = useCallback<ActionRunner>(async (payload) => {
    if (actionLockRef.current || actionPending) return false;
    actionLockRef.current = true;
    setLocalPending(true);
    setLocalError(null);
    try {
      const action = {
        ...payload,
        requestId: requestId(),
        expectedRevision: revision,
      } as CarnivalGameAction;
      await onAction(invite.inviteId, action);
      return true;
    } catch {
      setLocalError('这次操作还没有同步到对方，请检查网络后重试。');
      return false;
    } finally {
      actionLockRef.current = false;
      setLocalPending(false);
    }
  }, [actionPending, invite.inviteId, onAction, revision]);

  useEffect(() => {
    setLocalError(null);
  }, [invite.inviteId, revision]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyWasModalOpen = document.body.classList.contains('is-modal-open');
    const dialog = dialogRef.current;
    const frame = window.requestAnimationFrame(() => {
      (dialog?.querySelector<HTMLElement>('[data-carnival-focus], button:not(:disabled), select:not(:disabled)') ?? dialog)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), textarea:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
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
  }, [open]);

  const stageFocusKey = gameFocusKey(gameState, invite.status, participant);
  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[data-carnival-focus]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, stageFocusKey]);

  if (!open) return null;

  const pending = localPending || actionPending;
  const peerId = OTHER[participant];
  const participantState = invite.participants[participant];
  const peerState = invite.participants[peerId];
  const stateMismatch = Boolean(gameState && (
    gameState.inviteId !== invite.inviteId ||
    gameState.templateId !== invite.templateId ||
    (gameState.templateId === 'profile-riddle' && gameState.target.participantId !== peerId) ||
    (gameState.templateId === 'rapid-choice' && (
      gameState.self.participantId !== participant ||
      gameState.peer.participantId !== peerId
    ))
  ));

  return (
    <div
      className="carnival-game-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialogRef}
        className="carnival-game-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={pending}
        tabIndex={-1}
      >
        <header className="carnival-game-header">
          <div>
            <h2 id={titleId}>{gameState?.title ?? '等待游戏开始'}</h2>
          </div>
          <button className="carnival-game-close" type="button" onClick={onClose} aria-label="关闭游戏">
            ×
          </button>
        </header>

        <div className="carnival-game-presence" aria-label="双方在线与加入状态">
          <Presence person={participantState} label="我" active />
          <span className="carnival-game-presence__line" aria-hidden="true" />
          <Presence person={peerState} label="对方" />
        </div>

        {(localError || actionError) && (
          <div className="carnival-game-error" role="alert">{localError ?? actionError}</div>
        )}

        {stateMismatch ? (
          <GameNotice title="游戏状态暂时对不上" detail="请关闭后重新进入这份邀请，系统会重新同步当前局。" />
        ) : invite.status === 'cancelled' || invite.status === 'expired' ? (
          <GameNotice
            title={invite.status === 'expired' ? '这份邀请已经过期' : '这局已经取消'}
            detail="未揭晓的选择不会显示，也不会被带到下一局。"
          />
        ) : invite.status === 'waiting' || !gameState ? (
          <GameNotice
            title={`正在等 ${peerState.nickname || '对方'} 加入`}
            detail="邀请页可以暂时关闭；对方加入后，服务端会从同一个 inviteId 恢复。"
            waiting
          />
        ) : gameState.templateId === 'profile-riddle' ? (
          <ProfileRiddleGame
            participant={participant}
            invite={invite}
            state={gameState}
            pending={pending}
            runAction={dispatchAction}
            onUseChatPrompt={onUseChatPrompt}
          />
        ) : gameState.templateId === 'keyword-wheel' ? (
          <KeywordWheelGame
            participant={participant}
            invite={invite}
            state={gameState}
            pending={pending}
            runAction={dispatchAction}
            onUseChatPrompt={onUseChatPrompt}
          />
        ) : (
          <RapidChoiceGame
            participant={participant}
            invite={invite}
            state={gameState}
            pending={pending}
            runAction={dispatchAction}
            onUseChatPrompt={onUseChatPrompt}
          />
        )}
      </section>
    </div>
  );
}

function Presence({ person, label, active = false }: {
  person: CarnivalParticipantPublicState;
  label: string;
  active?: boolean;
}) {
  const stateLabel = !person.joined ? '等待加入' : person.online ? '在线' : '暂时离线';
  return (
    <div className={`carnival-game-person ${active ? 'is-me' : ''}`}>
      <span className="carnival-game-avatar" aria-hidden="true">{person.nickname.trim().slice(0, 1) || '?'}</span>
      <span>
        <strong>{person.nickname || label}</strong>
        <small>{label} · {stateLabel}</small>
      </span>
      <i className={person.online ? 'is-online' : ''} aria-hidden="true" />
    </div>
  );
}

function GameNotice({ title, detail, waiting = false }: { title: string; detail: string; waiting?: boolean }) {
  return (
    <div className="carnival-game-notice" aria-live="polite">
      <span className={waiting ? 'is-waiting' : ''} aria-hidden="true">{waiting ? '···' : '!'}</span>
      <h3 data-carnival-focus tabIndex={-1}>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function ProfileRiddleGame({ participant, invite, state, pending, runAction, onUseChatPrompt }: {
  participant: ParticipantId;
  invite: CarnivalInvitePublicState;
  state: CarnivalProfileRiddlePublicState;
  pending: boolean;
  runAction: ActionRunner;
  onUseChatPrompt?: (text: string) => void;
}) {
  const [keywords, setKeywords] = useState(['', '', '']);
  const choiceGroups = useMemo(() => normalizedProfileGroups(state), [state]);
  const peer = OTHER[participant];
  const myName = invite.participants[participant].nickname;
  const peerName = invite.participants[peer].nickname;

  useEffect(() => {
    setKeywords(['', '', '']);
  }, [invite.inviteId]);

  const changeKeyword = (slot: number, value: string) => {
    const next = [...keywords];
    next[slot] = value;
    setKeywords(next);
  };

  const sentence = keywords.every(Boolean)
    ? profileSentence(state.target.nickname, keywords)
    : '选满三个小猜测后，这里会自动组成一句话。';
  const canSubmit = keywords.every(Boolean) && new Set(keywords).size === 3;
  const submit = () => {
    if (!canSubmit) return;
    void runAction({
      type: 'profile-riddle.submit',
      keywords: keywords as [string, string, string],
    });
  };

  if (state.phase === 'revealed' && state.revealedSubmissions) {
    return (
      <div className="carnival-game-body carnival-profile-result" aria-live="polite">
        <p className="carnival-game-eyebrow">双方印象 · 已共同揭晓</p>
        <h3 data-carnival-focus tabIndex={-1}>你们眼中的彼此</h3>
        <div className="carnival-profile-result__grid">
          {(['a', 'b'] as ParticipantId[]).map((author) => {
            const submission = state.revealedSubmissions?.[author];
            if (!submission) return null;
            return (
              <article key={author}>
                <span>{invite.participants[author].nickname} 写给 {invite.participants[submission.target].nickname}</span>
                <div className="carnival-keyword-pills">
                  {submission.keywords.map((keyword) => <em key={keyword}>{keyword}</em>)}
                </div>
                <p>{submission.sentence}</p>
                {onUseChatPrompt && (
                  <button type="button" className="carnival-game-text-button" onClick={() => onUseChatPrompt(submission.sentence)}>
                    放进我的聊天输入框
                  </button>
                )}
              </article>
            );
          })}
        </div>
        <div className="carnival-discussion-card">
          想回哪句都可以：“这个挺准”“你猜反了”“我其实只有出去玩时会这样”。
        </div>
      </div>
    );
  }

  if (state.phase === 'reveal-ready') {
    const mineReady = state.revealReady[participant];
    return (
      <div className="carnival-game-body carnival-game-wait" aria-live="polite">
        <span className="carnival-game-state-icon" aria-hidden="true">🤝</span>
        <p className="carnival-game-eyebrow">两份内容都已保密保存</p>
        <h3 data-carnival-focus tabIndex={-1}>双方确认后一起揭晓</h3>
        <p>现在仍然只看得到提交状态。你们各自在自己的设备上确认，服务端才会同时公开两份印象。</p>
        <ReadyStatus invite={invite} ready={state.revealReady} />
        <button
          className="carnival-game-primary"
          type="button"
          disabled={mineReady || pending}
          onClick={() => void runAction({ type: 'profile-riddle.confirm-reveal' })}
        >
          {mineReady ? '我已确认，等待对方' : '我准备好了，一起揭晓'}
        </button>
      </div>
    );
  }

  if (state.submitted[participant]) {
    return (
      <div className="carnival-game-body carnival-game-wait" aria-live="polite">
        <span className="carnival-game-state-icon" aria-hidden="true">🔐</span>
        <p className="carnival-game-eyebrow">你的印象已保密提交</p>
        <h3 data-carnival-focus tabIndex={-1}>{state.submitted[peer] ? '双方都提交了，正在同步揭晓阶段' : `等待 ${peerName} 完成`}</h3>
        <p>对方现在只能看到“已提交”，看不到你的三个小猜测和句子。</p>
        <SubmitStatus invite={invite} submitted={state.submitted} />
      </div>
    );
  }

  return (
    <div className="carnival-game-body carnival-profile-form">
      <div className="carnival-game-turn">
        <span className="carnival-game-avatar" aria-hidden="true">{myName.trim().slice(0, 1)}</span>
        <span><strong>{myName}</strong><small>正在描述 {peerName}</small></span>
        <em>仅自己可见</em>
      </div>
      <div>
        <p className="carnival-game-eyebrow">凭第一感觉 · 完成三个小猜测</p>
        <h3 data-carnival-focus tabIndex={-1}>你觉得 {state.target.nickname} 更像哪一种？</h3>
        <p className="carnival-profile-helper">每一框都是不同生活场景。没有标准答案，选你最想猜的就好。</p>
      </div>
      <div className="carnival-profile-selects">
        {choiceGroups.map((group, slot) => (
          <label key={group.id}>
            <span>小猜测 {slot + 1}</span>
            <select value={keywords[slot]} onChange={(event) => changeKeyword(slot, event.target.value)}>
              <option value="">请选择</option>
              {group.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="carnival-profile-sentence" aria-live="polite">
        <span>自动生成的一句话</span>
        <p>{sentence}</p>
      </div>
      <button className="carnival-game-primary" type="button" disabled={!canSubmit || pending} onClick={submit}>
        保密提交给服务器
      </button>
      <p className="carnival-game-privacy">提交后不能修改；对方完成前，接口也不会返回你的具体内容。</p>
    </div>
  );
}

function KeywordWheelGame({ participant, invite, state, pending, runAction, onUseChatPrompt }: {
  participant: ParticipantId;
  invite: CarnivalInvitePublicState;
  state: CarnivalKeywordWheelPublicState;
  pending: boolean;
  runAction: ActionRunner;
  onUseChatPrompt?: (text: string) => void;
}) {
  const [rotation, setRotation] = useState(state.rotationDeg);
  const [visualReady, setVisualReady] = useState(state.phase === 'selected');
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setRotation(state.rotationDeg);
    if (state.phase === 'selected') {
      setVisualReady(true);
      return undefined;
    }
    if (state.phase !== 'spinning') {
      setVisualReady(false);
      return undefined;
    }
    setVisualReady(false);
    const remaining = Math.max(0, (state.revealAtMs ?? state.serverNowMs) - state.serverNowMs);
    timerRef.current = window.setTimeout(() => setVisualReady(true), remaining);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [state.phase, state.revealAtMs, state.rotationDeg, state.serverNowMs, state.spinSequence]);

  const selectedSegment = state.selectedSegmentId
    ? state.segments.find((segment) => segment.id === state.selectedSegmentId) ?? null
    : null;
  const followUp = selectedSegment
    ? selectedSegment.followUps[state.followUpIndex % Math.max(1, selectedSegment.followUps.length)] ?? selectedSegment.prompt
    : null;
  const segmentAngle = 360 / Math.max(1, state.segments.length);
  const gradient = `conic-gradient(${state.segments.map((_, index) => {
    const start = index * segmentAngle;
    const end = (index + 1) * segmentAngle;
    return `${index % 2 === 0 ? '#A3DAFF' : '#FD999A'} ${start}deg ${end}deg`;
  }).join(', ')})`;
  const spinnerName = state.lastSpunBy ? invite.participants[state.lastSpunBy].nickname : '';

  return (
    <div className="carnival-game-body carnival-wheel-game">
      <div className="carnival-wheel-wrap">
        <span className="carnival-wheel-pointer" aria-hidden="true" />
        <div
          className={`carnival-wheel ${state.phase === 'spinning' ? 'is-spinning' : ''}`}
          style={{ background: gradient, transform: `rotate(${rotation}deg)` }}
          role="img"
          aria-label={`共享话题转盘：${state.segments.map((segment) => segment.keyword).join('、')}`}
        >
          {state.segments.map((segment, index) => {
            const angle = (index + 0.5) * segmentAngle;
            return (
              <span
                className="carnival-wheel-label"
                key={segment.id}
                style={{
                  '--segment-angle': `${angle}deg`,
                  '--label-counter': `${-angle - rotation}deg`,
                } as CSSProperties}
              >
                <span>{segment.keyword}</span>
              </span>
            );
          })}
          <span className="carnival-wheel-hub" aria-hidden="true">✦</span>
        </div>
      </div>

      <button
        className="carnival-game-primary carnival-wheel-button"
        type="button"
        disabled={pending || !state.canSpin || state.phase === 'spinning'}
        onClick={() => void runAction({ type: 'keyword-wheel.spin' })}
      >
        {state.phase === 'spinning'
          ? `${spinnerName || '对方'} 正在转动…`
          : selectedSegment ? '再转一次共享转盘' : '转动共享转盘'}
      </button>

      <div className="carnival-wheel-result" aria-live="polite" aria-busy={state.phase === 'spinning' && !visualReady}>
        {visualReady && selectedSegment && followUp ? (
          <>
            <p className="carnival-game-eyebrow">共同抽到 · {selectedSegment.keyword}</p>
            <h3 data-carnival-focus tabIndex={-1}>{followUp}</h3>
            <p>{selectedSegment.prompt}</p>
            <div className="carnival-game-actions">
              {selectedSegment.followUps.length > 1 && (
                <button
                  type="button"
                  className="carnival-game-secondary"
                  disabled={pending}
                  onClick={() => void runAction({ type: 'keyword-wheel.next-follow-up' })}
                >
                  共同换一个追问
                </button>
              )}
              {onUseChatPrompt && (
                <button type="button" className="carnival-game-primary" onClick={() => onUseChatPrompt(followUp)}>
                  放进我的聊天输入框
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="carnival-game-eyebrow">{state.phase === 'spinning' ? '两端正在同步同一个结果' : '共享转盘已就位'}</p>
            <h3 data-carnival-focus tabIndex={-1}>{state.phase === 'spinning' ? '转盘停下后，两个人会看到同一条追问' : '由任意一方发起，结果以服务器为准'}</h3>
          </>
        )}
      </div>
      <p className="carnival-game-privacy">你们看到的落点来自同一个 inviteId，不在各自浏览器里随机。</p>
    </div>
  );
}

function RapidChoiceGame({ participant, invite, state, pending, runAction, onUseChatPrompt }: {
  participant: ParticipantId;
  invite: CarnivalInvitePublicState;
  state: CarnivalRapidChoicePublicState;
  pending: boolean;
  runAction: ActionRunner;
  onUseChatPrompt?: (text: string) => void;
}) {
  const [remainingMs, setRemainingMs] = useState(0);
  const timeoutQuestionRef = useRef<string | null>(null);
  const timeoutRetryAtRef = useRef(0);
  const localDeadlineRef = useRef<{ questionId: string; deadlineAtMs: number; value: number } | null>(null);
  const currentQuestion = state.self.currentQuestionId
    ? state.questions.find((question) => question.id === state.self.currentQuestionId) ?? null
    : null;

  useEffect(() => {
    timeoutQuestionRef.current = null;
    timeoutRetryAtRef.current = 0;
  }, [state.self.currentQuestionId]);

  useEffect(() => {
    if (state.phase !== 'answering' || !currentQuestion || !state.self.deadlineAtMs) {
      localDeadlineRef.current = null;
      setRemainingMs(0);
      return undefined;
    }
    const now = performance.now();
    const serverRemaining = Math.min(5_000, Math.max(0, state.self.deadlineAtMs - state.serverNowMs));
    const candidateDeadline = now + serverRemaining;
    const previousDeadline = localDeadlineRef.current;
    const localDeadline = previousDeadline &&
      previousDeadline.questionId === currentQuestion.id &&
      previousDeadline.deadlineAtMs === state.self.deadlineAtMs
      ? Math.min(previousDeadline.value, candidateDeadline)
      : candidateDeadline;
    localDeadlineRef.current = {
      questionId: currentQuestion.id,
      deadlineAtMs: state.self.deadlineAtMs,
      value: localDeadline,
    };
    const tick = () => {
      const remaining = Math.max(0, localDeadline - performance.now());
      setRemainingMs(remaining);
      if (
        remaining === 0 &&
        timeoutQuestionRef.current !== currentQuestion.id &&
        performance.now() >= timeoutRetryAtRef.current
      ) {
        timeoutQuestionRef.current = currentQuestion.id;
        void runAction({ type: 'rapid-choice.timeout', questionId: currentQuestion.id }).then((started) => {
          if (!started) {
            timeoutQuestionRef.current = null;
            timeoutRetryAtRef.current = performance.now() + 1_500;
          }
        });
      }
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [currentQuestion, runAction, state.phase, state.self.deadlineAtMs, state.serverNowMs]);

  if (state.phase === 'revealed' && state.results) {
    return (
      <div className="carnival-game-body carnival-rapid-result" aria-live="polite">
        <p className="carnival-game-eyebrow">双方答案 · 已共同揭晓</p>
        <h3 data-carnival-focus tabIndex={-1}>一样是默契，不一样是话题</h3>
        <div className="carnival-rapid-result__list">
          {state.questions.map((question, index) => {
            const result = state.results?.find((item) => item.questionId === question.id);
            if (!result) return null;
            const answerA = result.answers.a;
            const answerB = result.answers.b;
            const bothAnswered = answerA !== 'timeout' && answerB !== 'timeout';
            const same = bothAnswered && answerA === answerB;
            const prompt = !bothAnswered
              ? '这一题有人没来得及选。可以聊聊：看到题目时，你的第一反应是什么？'
              : same
                ? `你们都选了「${answerLabel(question, answerA)}」。可以聊聊：为什么你会选这个答案？${question.matchedDiscussionPrompt}`
                : `${invite.participants.a.nickname} 选了「${answerLabel(question, answerA)}」，${invite.participants.b.nickname} 选了「${answerLabel(question, answerB)}」。可以聊聊：为什么我会选 A/B，也想听听你为什么这样选。${question.differentDiscussionPrompt}`;
            return (
              <article key={question.id}>
                <span className="carnival-result-index">{index + 1}</span>
                <div>
                  <h4>{question.prompt}</h4>
                  <div className="carnival-answer-pills">
                    <span>{invite.participants.a.nickname}：{answerLabel(question, answerA)}</span>
                    <span>{invite.participants.b.nickname}：{answerLabel(question, answerB)}</span>
                  </div>
                  <p>{prompt}</p>
                  {onUseChatPrompt && (
                    <button type="button" className="carnival-game-text-button" onClick={() => onUseChatPrompt(prompt)}>
                      用这句话继续聊
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    );
  }

  if (state.phase === 'reveal-ready') {
    const mineReady = state.revealReady[participant];
    return (
      <div className="carnival-game-body carnival-game-wait" aria-live="polite">
        <span className="carnival-game-state-icon" aria-hidden="true">🤝</span>
        <p className="carnival-game-eyebrow">双方已完成 · 答案仍保密</p>
        <h3 data-carnival-focus tabIndex={-1}>两端都确认后再一起查看</h3>
        <p>确认前，当前接口投影只包含完成状态，不包含对方选择。</p>
        <ReadyStatus invite={invite} ready={state.revealReady} />
        <button
          className="carnival-game-primary"
          type="button"
          disabled={mineReady || pending}
          onClick={() => void runAction({ type: 'rapid-choice.confirm-reveal' })}
        >
          {mineReady ? '我已确认，等待对方' : '我准备好了，一起查看答案'}
        </button>
      </div>
    );
  }

  if (state.phase === 'waiting-peer' || state.self.completed) {
    return (
      <div className="carnival-game-body carnival-game-wait" aria-live="polite">
        <span className="carnival-game-state-icon" aria-hidden="true">⏳</span>
        <p className="carnival-game-eyebrow">我的 {state.questions.length} 道题已完成</p>
        <h3 data-carnival-focus tabIndex={-1}>{state.peer.completed ? '对方已完成，正在同步共同揭晓' : `等待 ${invite.participants[state.peer.participantId].nickname} 完成`}</h3>
        <p>现在只共享双方进度；每道具体选择仍然只有自己和服务器知道。</p>
        <div className="carnival-progress-pair">
          <ProgressPerson name={invite.participants[participant].nickname} count={state.self.answeredCount} total={state.questions.length} />
          <ProgressPerson name={invite.participants[state.peer.participantId].nickname} count={state.peer.answeredCount} total={state.questions.length} />
        </div>
      </div>
    );
  }

  if (!currentQuestion || !state.self.deadlineAtMs) {
    return <GameNotice title="正在同步下一题" detail="服务器会继续返回你的当前题目和独立截止时间。" waiting />;
  }

  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const expired = remainingMs <= 0;
  const timerFraction = Math.min(1, Math.max(0, remainingMs / 5_000));
  return (
    <div className="carnival-game-body carnival-rapid-play">
      <div className="carnival-rapid-meta">
        <div>
          <p className="carnival-game-eyebrow">独立作答 · 对方看不到</p>
          <strong>第 {Math.min(state.self.answeredCount + 1, state.questions.length)}/{state.questions.length} 题</strong>
        </div>
        <div className={`carnival-rapid-timer ${seconds <= 2 ? 'is-urgent' : ''}`} role="timer" aria-label={`还剩 ${seconds} 秒`}>
          <svg viewBox="0 0 44 44" aria-hidden="true">
            <circle cx="22" cy="22" r="18" pathLength="100" />
            <circle className="value" cx="22" cy="22" r="18" pathLength="100" style={{ strokeDashoffset: 100 - timerFraction * 100 }} />
          </svg>
          <b>{seconds}</b>
        </div>
      </div>
      <div
        className="carnival-rapid-progress"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={state.questions.length}
        aria-valuenow={Math.min(state.questions.length, state.self.answeredCount + 1)}
        style={{ gridTemplateColumns: `repeat(${state.questions.length}, minmax(0, 1fr))` }}
      >
        {state.questions.map((question, index) => <span key={question.id} className={index <= state.self.answeredCount ? 'is-active' : ''} />)}
      </div>
      <h3 data-carnival-focus tabIndex={-1} id={`carnival-question-${currentQuestion.id}`}>{currentQuestion.prompt}</h3>
      <div className="carnival-rapid-options" role="group" aria-labelledby={`carnival-question-${currentQuestion.id}`}>
        {currentQuestion.options.map((option, index) => (
          <button
            type="button"
            key={option}
            disabled={pending || expired}
            onClick={() => void runAction({
              type: 'rapid-choice.answer',
              questionId: currentQuestion.id,
              answer: index as 0 | 1,
            })}
          >
            <span>{index === 0 ? 'A' : 'B'}</span>
            <strong>{option}</strong>
          </button>
        ))}
        <i aria-hidden="true">VS</i>
      </div>
      <p className="carnival-game-privacy">{expired ? '时间到，正在让服务器记录本题超时。' : '服务端会校验 5 秒截止时间；网络延迟不会延长作答窗口。'}</p>
    </div>
  );
}

function ReadyStatus({ invite, ready }: {
  invite: CarnivalInvitePublicState;
  ready: Record<ParticipantId, boolean>;
}) {
  return (
    <div className="carnival-ready-status">
      {(['a', 'b'] as ParticipantId[]).map((id) => (
        <span key={id} className={ready[id] ? 'is-ready' : ''}>
          {invite.participants[id].nickname} · {ready[id] ? '已确认' : '待确认'}
        </span>
      ))}
    </div>
  );
}

function SubmitStatus({ invite, submitted }: {
  invite: CarnivalInvitePublicState;
  submitted: Record<ParticipantId, boolean>;
}) {
  return (
    <div className="carnival-ready-status">
      {(['a', 'b'] as ParticipantId[]).map((id) => (
        <span key={id} className={submitted[id] ? 'is-ready' : ''}>
          {invite.participants[id].nickname} · {submitted[id] ? '已提交' : '作答中'}
        </span>
      ))}
    </div>
  );
}

function ProgressPerson({ name, count, total }: { name: string; count: number; total: number }) {
  return (
    <div>
      <span><strong>{name}</strong><small>{Math.min(count, total)}/{total}</small></span>
      <i><b style={{ width: `${Math.min(100, Math.max(0, (count / Math.max(1, total)) * 100))}%` }} /></i>
    </div>
  );
}
