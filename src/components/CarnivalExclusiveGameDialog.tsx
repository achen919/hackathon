import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CarnivalExclusiveSeriesId } from '../carnival-exclusive';
import { exclusiveSeriesById } from '../carnival-exclusive';
import type { ParticipantId } from '../types';
import type { CarnivalParticipantPublicState } from './CarnivalGameDialog';
import '../carnival-game.css';

export interface CarnivalExclusiveQuestion {
  id: string;
  label: string;
  source: string;
  prompt: string;
  options: string[];
  matchedFollowUp?: string;
  differentFollowUp?: string;
}

export interface CarnivalExclusiveRoundResult {
  questionId: string;
  protagonistId: ParticipantId;
  answer: number;
  guess: number;
  followUp?: string;
}

export interface CarnivalExclusivePublicState {
  inviteId: string;
  revision: number;
  serverNowMs: number;
  templateId: 'custom';
  seriesId: CarnivalExclusiveSeriesId;
  title: string;
  description: string;
  series?: {
    matchedEyebrow?: string;
    matchedTitle?: string;
    differentEyebrow?: string;
    differentTitle?: string;
    resultUnit?: string;
  };
  phase:
    | 'waiting-peer'
    | 'answering'
    | 'waiting-answer'
    | 'guessing'
    | 'waiting-guess'
    | 'round-revealed'
    | 'revealed'
    | 'completed';
  roundIndex: number;
  roundCount?: number;
  totalRounds?: number;
  protagonistId: ParticipantId;
  guesserId: ParticipantId;
  question: CarnivalExclusiveQuestion | null;
  questions?: CarnivalExclusiveQuestion[];
  self: {
    participantId: ParticipantId;
    role: string;
    submitted: boolean;
  };
  revealedRound?: CarnivalExclusiveRoundResult;
  results?: CarnivalExclusiveRoundResult[];
}

export interface CarnivalExclusiveInvitePublicState {
  inviteId: string;
  revision: number;
  status: 'waiting' | 'active' | 'completed' | 'cancelled' | 'expired';
  templateId: 'custom';
  seriesId: CarnivalExclusiveSeriesId;
  createdBy: ParticipantId;
  participants: Record<ParticipantId, CarnivalParticipantPublicState>;
}

export type CarnivalExclusiveAction = (
  | { type: 'exclusive.answer'; questionId: string; answer: number }
  | { type: 'exclusive.guess'; questionId: string; guess: number }
  | { type: 'exclusive.next'; questionId: string }
) & {
  requestId: string;
  expectedRevision: number;
};

function requestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `exclusive-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function other(participant: ParticipantId): ParticipantId {
  return participant === 'a' ? 'b' : 'a';
}

function isAnswerRole(role: string) {
  return ['answerer', 'answering', 'protagonist'].includes(role);
}

function isGuessRole(role: string) {
  return ['guesser', 'guessing'].includes(role);
}

export function CarnivalExclusiveGameDialog({
  open,
  participant,
  invite,
  gameState,
  actionPending = false,
  actionError = null,
  onAction,
  onClose,
  onUseChatPrompt,
}: {
  open: boolean;
  participant: ParticipantId;
  invite: CarnivalExclusiveInvitePublicState;
  gameState: CarnivalExclusivePublicState | null;
  actionPending?: boolean;
  actionError?: string | null;
  onAction: (inviteId: string, action: CarnivalExclusiveAction) => Promise<void>;
  onClose: () => void;
  onUseChatPrompt?: (text: string) => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const actionLockRef = useRef(false);
  const [choice, setChoice] = useState<number | null>(null);
  const [localPending, setLocalPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  closeRef.current = onClose;

  const revision = gameState?.revision ?? invite.revision;
  const dispatchAction = useCallback(async (
    payload:
      | { type: 'exclusive.answer'; questionId: string; answer: number }
      | { type: 'exclusive.guess'; questionId: string; guess: number }
      | { type: 'exclusive.next'; questionId: string },
  ) => {
    if (actionLockRef.current || actionPending) return false;
    actionLockRef.current = true;
    setLocalPending(true);
    setLocalError(null);
    try {
      await onAction(invite.inviteId, {
        ...payload,
        requestId: requestId(),
        expectedRevision: revision,
      } as CarnivalExclusiveAction);
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
    setChoice(null);
    setLocalError(null);
  }, [gameState?.phase, gameState?.question?.id, invite.inviteId]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const bodyWasModalOpen = document.body.classList.contains('is-modal-open');
    const frame = window.requestAnimationFrame(() => {
      (dialog?.querySelector<HTMLElement>('[data-exclusive-focus], button:not(:disabled)') ?? dialog)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
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

  const focusKey = `${gameState?.phase ?? invite.status}-${gameState?.roundIndex ?? -1}-${gameState?.self.submitted ?? false}`;
  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[data-exclusive-focus]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusKey, open]);

  if (!open) return null;

  const pending = actionPending || localPending;
  const peer = other(participant);
  const selfJoined = invite.participants[participant].joined;
  const series = exclusiveSeriesById(gameState?.seriesId ?? invite.seriesId);
  const stateMismatch = Boolean(gameState && (
    gameState.inviteId !== invite.inviteId ||
    gameState.templateId !== 'custom' ||
    gameState.seriesId !== invite.seriesId ||
    gameState.self.participantId !== participant
  ));

  return (
    <div className="carnival-game-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={dialogRef}
        className={`carnival-game-dialog carnival-exclusive-game is-${series?.tone ?? 'violet'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={pending}
        tabIndex={-1}
      >
        <header className="carnival-game-header">
          <div>
            <p className="carnival-game-kicker">专属小游戏 · {series?.shortTitle ?? '双人局'} · {invite.inviteId.slice(-6)}</p>
            <h2 id={titleId}>{gameState?.title ?? series?.title ?? '等待游戏开始'}</h2>
          </div>
          <button className="carnival-game-close" type="button" onClick={onClose} aria-label="关闭专属小游戏">×</button>
        </header>

        <div className="carnival-game-presence" aria-label="双方在线与加入状态">
          <ExclusivePresence person={invite.participants[participant]} label="我" />
          <span className="carnival-game-presence__line" aria-hidden="true" />
          <ExclusivePresence person={invite.participants[peer]} label="对方" peer />
        </div>

        {(localError || actionError) && <div className="carnival-game-error" role="alert">{localError ?? actionError}</div>}

        {stateMismatch ? (
          <ExclusiveNotice title="游戏状态暂时对不上" detail="请关闭后重新打开这张邀请卡，系统会重新同步当前回合。" />
        ) : invite.status === 'cancelled' || invite.status === 'expired' ? (
          <ExclusiveNotice title={invite.status === 'expired' ? '这份邀请已经过期' : '这局已经取消'} detail="未揭晓的选择不会显示，也不会被带到下一局。" />
        ) : invite.status === 'waiting' || !gameState ? (
          <ExclusiveNotice
            title={selfJoined ? `正在等 ${invite.participants[peer].nickname || '对方'} 加入` : '正在加入这局'}
            detail={selfJoined
              ? '可以先回到聊天；对方点进同一张邀请卡后，这一局会从同一个 inviteId 开始。'
              : '正在同步这张邀请卡；加入完成后会直接进入当前回合。'}
            waiting
          />
        ) : (
          <ExclusiveRound
            participant={participant}
            invite={invite}
            state={gameState}
            choice={choice}
            setChoice={setChoice}
            pending={pending}
            runAction={dispatchAction}
            onUseChatPrompt={onUseChatPrompt}
          />
        )}
      </section>
    </div>
  );
}

function ExclusivePresence({ person, label, peer = false }: {
  person: CarnivalParticipantPublicState;
  label: string;
  peer?: boolean;
}) {
  return (
    <div className={`carnival-game-person ${peer ? '' : 'is-me'}`}>
      <span className="carnival-game-avatar" aria-hidden="true">{person.nickname.trim().slice(0, 1) || '?'}</span>
      <span><strong>{person.nickname || label}</strong><small>{label} · {person.joined ? '已加入' : '等待加入'}</small></span>
      <i className={person.online ? 'is-online' : ''} aria-hidden="true" />
    </div>
  );
}

function ExclusiveNotice({ title, detail, waiting = false }: { title: string; detail: string; waiting?: boolean }) {
  return (
    <div className="carnival-game-notice" aria-live="polite">
      <span className={waiting ? 'is-waiting' : ''} aria-hidden="true">{waiting ? '···' : '!'}</span>
      <h3 data-exclusive-focus tabIndex={-1}>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function ExclusiveRound({
  participant,
  invite,
  state,
  choice,
  setChoice,
  pending,
  runAction,
  onUseChatPrompt,
}: {
  participant: ParticipantId;
  invite: CarnivalExclusiveInvitePublicState;
  state: CarnivalExclusivePublicState;
  choice: number | null;
  setChoice: (value: number) => void;
  pending: boolean;
  runAction: (
    payload:
      | { type: 'exclusive.answer'; questionId: string; answer: number }
      | { type: 'exclusive.guess'; questionId: string; guess: number }
      | { type: 'exclusive.next'; questionId: string },
  ) => Promise<boolean>;
  onUseChatPrompt?: (text: string) => void;
}) {
  const question = state.question;
  const roundCount = Math.max(3, state.totalRounds ?? state.roundCount ?? state.results?.length ?? 3);
  const protagonist = invite.participants[state.protagonistId];
  const guesser = invite.participants[state.guesserId];
  const localSeries = exclusiveSeriesById(state.seriesId);
  const matchedEyebrow = state.series?.matchedEyebrow ?? localSeries?.matchedEyebrow ?? '碰巧同频';
  const matchedTitle = state.series?.matchedTitle ?? localSeries?.matchedTitle ?? '你们想到了一起';
  const differentEyebrow = state.series?.differentEyebrow ?? localSeries?.differentEyebrow ?? '发现新线索';
  const differentTitle = state.series?.differentTitle ?? localSeries?.differentTitle ?? '两个答案都值得继续聊';
  const resultUnit = state.series?.resultUnit ?? localSeries?.resultUnit ?? '条新线索';
  const mineToAnswer = state.phase === 'answering' && isAnswerRole(state.self.role) && !state.self.submitted;
  const mineToGuess = state.phase === 'guessing' && isGuessRole(state.self.role) && !state.self.submitted;
  const myTurn = mineToAnswer || mineToGuess;

  if (state.phase === 'completed') {
    const results = state.results ?? [];
    const sameCount = results.filter((result) => result.answer === result.guess).length;
    const finalPrompt = results.at(-1)?.followUp;
    return (
      <div className="carnival-game-body carnival-exclusive-complete" aria-live="polite">
        <span className="carnival-exclusive-complete__spark" aria-hidden="true">✦</span>
        <p className="carnival-game-eyebrow">三轮专属小游戏完成</p>
        <h3 data-exclusive-focus tabIndex={-1}>收下 {results.length || 3} {resultUnit}</h3>
        <p>{sameCount} 次碰巧同频，{Math.max(0, results.length - sameCount)} 次发现不同角度。差异不是扣分，是下一段聊天的入口。</p>
        <div className="carnival-exclusive-result-list">
          {results.map((result, index) => {
            const resultQuestion = state.questions?.find((item) => item.id === result.questionId)
              ?? (state.question?.id === result.questionId ? state.question : null);
            return (
              <article key={`${result.questionId}-${index}`} className={result.answer === result.guess ? 'is-matched' : ''}>
                <span><i>{index + 1}</i>{result.answer === result.guess ? '刚好同频' : '发现新线索'}</span>
                {resultQuestion && (
                  <p>{resultQuestion.options[result.answer] ?? '已作答'} <b>×</b> {resultQuestion.options[result.guess] ?? '已猜测'}</p>
                )}
              </article>
            );
          })}
        </div>
        {finalPrompt && onUseChatPrompt && (
          <button className="carnival-game-primary" type="button" onClick={() => onUseChatPrompt(finalPrompt)}>把最后一条追问放进输入框</button>
        )}
      </div>
    );
  }

  if ((state.phase === 'round-revealed' || state.phase === 'revealed') && state.revealedRound && question) {
    const result = state.revealedRound;
    const matched = result.answer === result.guess;
    const answerText = question.options[result.answer] ?? '已作答';
    const guessText = question.options[result.guess] ?? '已猜测';
    const followUp = result.followUp
      ?? (matched ? question.matchedFollowUp : question.differentFollowUp)
      ?? '可以聊聊：为什么你们会做出这样的选择？';
    return (
      <div className="carnival-game-body carnival-exclusive-reveal" aria-live="polite">
        <div className={`carnival-exclusive-reveal__burst ${matched ? 'is-matched' : ''}`} aria-hidden="true">{matched ? '✦' : '↗'}</div>
        <p className="carnival-game-eyebrow">第 {state.roundIndex + 1} 轮 · {matched ? matchedEyebrow : differentEyebrow}</p>
        <h3 data-exclusive-focus tabIndex={-1}>{matched ? matchedTitle : differentTitle}</h3>
        <div className="carnival-exclusive-compare">
          <article><span>{protagonist.nickname} 的答案</span><strong>{answerText}</strong></article>
          <b>{matched ? '刚好一样' : '猜出了另一种可能'}</b>
          <article><span>{guesser.nickname} 的猜测</span><strong>{guessText}</strong></article>
        </div>
        <div className="carnival-discussion-card"><span>顺着聊一句</span><p>{followUp}</p></div>
        <div className="carnival-game-actions">
          {onUseChatPrompt && <button className="carnival-game-secondary" type="button" onClick={() => onUseChatPrompt(followUp)}>放进输入框，我自己改</button>}
          <button className="carnival-game-primary" type="button" disabled={pending} onClick={() => void runAction({ type: 'exclusive.next', questionId: question.id })}>
            {state.roundIndex + 1 >= roundCount ? '收下这局结果' : '下一轮，交换角色'}
          </button>
        </div>
      </div>
    );
  }

  if (!question) {
    return <ExclusiveNotice title="正在同步下一轮" detail="题面会从同一个 inviteId 恢复，请稍等片刻。" waiting />;
  }

  if (!myTurn || state.self.submitted) {
    const waitingFor = state.phase === 'waiting-answer' || state.phase === 'answering'
      ? protagonist.nickname
      : guesser.nickname;
    return (
      <div className="carnival-game-body carnival-game-wait" aria-live="polite">
        <span className="carnival-game-state-icon" aria-hidden="true">🔐</span>
        <p className="carnival-game-eyebrow">第 {state.roundIndex + 1}/{roundCount} 轮 · 选择已保密</p>
        <h3 data-exclusive-focus tabIndex={-1}>等待 {waitingFor} 完成这一小步</h3>
        <p>{state.phase === 'answering' ? '对方的答案不会提前出现在你的接口里。' : '猜测锁定后，两端才会一起看到这一轮结果。'}</p>
      </div>
    );
  }

  const actionLabel = mineToAnswer ? '保密锁定我的答案' : `锁定我对 ${protagonist.nickname} 的猜测`;
  return (
    <div className="carnival-game-body carnival-exclusive-round">
      <div className="carnival-exclusive-progress" aria-label={`游戏进度，第 ${state.roundIndex + 1} 轮，共 ${roundCount} 轮`}>
        {Array.from({ length: roundCount }, (_, index) => <i key={index} className={index <= state.roundIndex ? 'is-active' : ''} />)}
      </div>
      <div className="carnival-game-turn">
        <span className="carnival-game-avatar" aria-hidden="true">{invite.participants[participant].nickname.trim().slice(0, 1)}</span>
        <span><strong>{invite.participants[participant].nickname}</strong><small>{mineToAnswer ? '正在私密作答' : `正在猜 ${protagonist.nickname} 会怎么选`}</small></span>
        <em>仅自己可见</em>
      </div>
      <div>
        <p className="carnival-game-eyebrow">{question.label} · 第 {state.roundIndex + 1}/{roundCount} 轮</p>
        <p className="carnival-exclusive-source">{question.source}</p>
        <h3 data-exclusive-focus tabIndex={-1}>{mineToGuess ? `${protagonist.nickname} 会怎么选？` : question.prompt}</h3>
        {mineToGuess && <p className="carnival-exclusive-question-copy">原题：{question.prompt}</p>}
      </div>
      <div className="carnival-exclusive-options" role="radiogroup" aria-label={mineToAnswer ? '选择你的答案' : '猜猜对方的答案'}>
        {question.options.map((option, index) => (
          <button
            key={`${question.id}-${index}`}
            type="button"
            role="radio"
            aria-checked={choice === index}
            className={choice === index ? 'is-selected' : ''}
            onClick={() => setChoice(index)}
          >
            <span>{String.fromCharCode(65 + index)}</span><strong>{option}</strong>
          </button>
        ))}
      </div>
      <button
        className="carnival-game-primary carnival-exclusive-submit"
        type="button"
        disabled={choice === null || pending}
        onClick={() => {
          if (choice === null) return;
          void runAction(mineToAnswer
            ? { type: 'exclusive.answer', questionId: question.id, answer: choice }
            : { type: 'exclusive.guess', questionId: question.id, guess: choice });
        }}
      >
        {actionLabel}
      </button>
      <p className="carnival-game-privacy">答案保存在服务端；另一方完成猜测前，只能看到“已提交”。</p>
    </div>
  );
}
