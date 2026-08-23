import { useEffect, useRef } from 'react';
import { Avatar } from './Avatar';
import { getUser, otherParticipant, perspectiveLabel, toneFor } from '../lib/participants';
import type {
  GameDefinition,
  GamePhase,
  MatchPayload,
  ParticipantId,
  RoundResult,
} from '../types';

interface IcebreakerGameProps {
  open: boolean;
  match: MatchPayload;
  game: GameDefinition;
  phase: GamePhase;
  roundIndex: number;
  answer: number | null;
  guess: number | null;
  results: RoundResult[];
  viewer: ParticipantId;
  starter: ParticipantId;
  onAnswerChange: (answer: number) => void;
  onGuessChange: (guess: number) => void;
  onLockAnswer: () => void;
  onHandoff: () => void;
  onReveal: () => void;
  onNextRound: () => void;
  onClose: () => void;
  onFollowUp: (text: string) => void;
  onRestart: () => void;
  onViewerChange: (participant: ParticipantId) => void;
}

export function IcebreakerGame({
  open,
  match,
  game,
  phase,
  roundIndex,
  answer,
  guess,
  results,
  viewer,
  starter,
  onAnswerChange,
  onGuessChange,
  onLockAnswer,
  onHandoff,
  onReveal,
  onNextRound,
  onClose,
  onFollowUp,
  onRestart,
  onViewerChange,
}: IcebreakerGameProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const frame = window.requestAnimationFrame(() => {
      const firstButton = dialog?.querySelector<HTMLElement>('button:not(:disabled)');
      (firstButton ?? dialog)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
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

  if (!open) return null;

  const questions = game.questions;
  const question = questions[roundIndex] ?? questions[questions.length - 1];
  const protagonist = roundIndex % 2 === 0 ? starter : otherParticipant(starter);
  const guesser = otherParticipant(protagonist);
  const protagonistUser = getUser(match, protagonist);
  const guesserUser = getUser(match, guesser);
  const currentResult = results[results.length - 1];
  const isMatched = currentResult?.answer === currentResult?.guess;
  const matchedCount = results.filter((result) => result.answer === result.guess).length;
  const requiredViewer = phase === 'answering' ? protagonist : phase === 'guessing' ? guesser : null;
  const roleBlocked = requiredViewer !== null && viewer !== requiredViewer;

  return (
    <div
      className="game-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="game-sheet"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="game-title"
      >
        <header className="game-sheet__header">
          <div>
            <p className="eyebrow">{game.eyebrow} · {game.gameType}</p>
            <h2 id="game-title">{game.title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="收起游戏">
            ×
          </button>
        </header>

        <div
          className="game-progress"
          style={{ gridTemplateColumns: `repeat(${questions.length}, minmax(0, 1fr))` }}
          aria-label={`游戏进度，第 ${Math.min(roundIndex + 1, questions.length)} 轮，共 ${questions.length} 轮`}
        >
          {questions.map((item, index) => (
            <span
              key={item.id}
              className={`game-progress__step ${index <= roundIndex ? 'is-active' : ''}`}
            />
          ))}
        </div>

        {phase === 'complete' ? (
          <div className="game-complete">
            <div className="game-complete__spark" aria-hidden="true">✦</div>
            <p className="eyebrow">这一局完成了</p>
            <h3>收下 {results.length} 颗话题种子</h3>
            <p>
              其中 {matchedCount} 次碰巧同频，{results.length - matchedCount} 次发现新线索。
              差异不是扣分，是下一段对话的入口。
            </p>
            {game.templateId !== 'profile-riddle' && (
              <p className="game-complete__reason">这局为什么适合你们：{game.whyItFits}</p>
            )}
            <div className="game-complete__people">
              <Avatar name={match.user_a.nickname} tone={toneFor('a')} size="large" />
              <span className="game-complete__line">一起完成</span>
              <Avatar name={match.user_b.nickname} tone={toneFor('b')} size="large" />
            </div>
            <button className="primary-button primary-button--wide" type="button" onClick={onRestart}>
              重玩本局
            </button>
            <button className="text-button" type="button" onClick={onClose}>
              回到聊天
            </button>
          </div>
        ) : (
          <>
            <div className="question-meta">
              <span>{question.label}</span>
              <span>第 {roundIndex + 1}/{questions.length} 轮</span>
            </div>

            {roleBlocked && requiredViewer && (
              <div className="perspective-gate" aria-live="polite">
                <div className="perspective-gate__avatars" aria-hidden="true">
                  <Avatar name={getUser(match, viewer).nickname} tone={toneFor(viewer)} size="large" />
                  <span>→</span>
                  <Avatar name={getUser(match, requiredViewer).nickname} tone={toneFor(requiredViewer)} size="large" />
                </div>
                <p className="eyebrow">双端隐私演示</p>
                <h3>这一页只在 {getUser(match, requiredViewer).nickname} 的视角可见</h3>
                <p>
                  当前是 {perspectiveLabel(match, viewer)}。切换后才能继续，另一方不会看到未揭晓的选择。
                </p>
                <button
                  className="primary-button primary-button--wide"
                  type="button"
                  onClick={() => onViewerChange(requiredViewer)}
                >
                  切换到 {perspectiveLabel(match, requiredViewer)}
                </button>
              </div>
            )}

            {phase === 'answering' && !roleBlocked && (
              <div className="game-stage">
                <div className="role-strip">
                  <Avatar name={protagonistUser.nickname} tone={toneFor(protagonist)} size="small" />
                  <span>现在由 {protagonistUser.nickname} 私密作答</span>
                  <span className="privacy-chip">另一方暂时看不到</span>
                </div>
                {game.templateId !== 'profile-riddle' && <p className="question-source">{question.source}</p>}
                <h3 className="question-title">{question.prompt}</h3>
                <div className="choice-grid" role="radiogroup" aria-label="选择你的答案">
                  {question.options.map((option, index) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={answer === index}
                      className={`choice-button ${answer === index ? 'is-selected' : ''}`}
                      onClick={() => onAnswerChange(index)}
                    >
                      <span className="choice-button__index">{String.fromCharCode(65 + index)}</span>
                      <span>{option}</span>
                    </button>
                  ))}
                </div>
                <button
                  className="primary-button primary-button--wide"
                  type="button"
                  disabled={answer === null}
                  onClick={onLockAnswer}
                >
                  锁定我的答案
                </button>
              </div>
            )}

            {phase === 'handoff' && (
              <div className="game-handoff">
                <div className="lock-orbit" aria-hidden="true">⌁</div>
                <p className="eyebrow">答案已经藏好</p>
                <h3>把这一轮交给 {guesserUser.nickname}</h3>
                <p>{protagonistUser.nickname} 的选择会一直保密，直到猜测也锁定。</p>
                <button
                  className="primary-button primary-button--wide"
                  type="button"
                  onClick={() => {
                    onViewerChange(guesser);
                    onHandoff();
                  }}
                >
                  切换到 {guesserUser.nickname}
                </button>
              </div>
            )}

            {phase === 'guessing' && !roleBlocked && (
              <div className="game-stage">
                <div className="role-strip">
                  <Avatar name={guesserUser.nickname} tone={toneFor(guesser)} size="small" />
                  <span>{guesserUser.nickname} 来猜一猜</span>
                  <span className="privacy-chip">不算默契考试</span>
                </div>
                {game.templateId !== 'profile-riddle' && <p className="question-source">{question.source}</p>}
                <h3 className="question-title">{protagonistUser.nickname} 会怎么选？</h3>
                <div className="choice-grid" role="radiogroup" aria-label="猜猜对方的答案">
                  {question.options.map((option, index) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={guess === index}
                      className={`choice-button ${guess === index ? 'is-selected' : ''}`}
                      onClick={() => onGuessChange(index)}
                    >
                      <span className="choice-button__index">{String.fromCharCode(65 + index)}</span>
                      <span>{option}</span>
                    </button>
                  ))}
                </div>
                <button
                  className="primary-button primary-button--wide"
                  type="button"
                  disabled={guess === null}
                  onClick={onReveal}
                >
                  一起揭晓
                </button>
              </div>
            )}

            {phase === 'revealed' && currentResult && (
              <div className="game-reveal" aria-live="polite">
                <div className={`reveal-burst ${isMatched ? 'is-matched' : ''}`} aria-hidden="true">
                  {isMatched ? '✦' : '↗'}
                </div>
                <p className="eyebrow">{isMatched ? '碰巧同频' : '发现一条新线索'}</p>
                <h3>{isMatched ? '你读懂了 TA' : '原来还有这一面'}</h3>
                <div className="answer-compare">
                  <div className="answer-compare__item">
                    <span>{protagonistUser.nickname} 的选择</span>
                    <strong>{question.options[currentResult.answer]}</strong>
                  </div>
                  <div className="answer-compare__divider">{isMatched ? '刚好一样' : '不一样也很好'}</div>
                  <div className="answer-compare__item">
                    <span>{guesserUser.nickname} 的猜测</span>
                    <strong>{question.options[currentResult.guess]}</strong>
                  </div>
                </div>
                <div className="follow-up-card">
                  <span>顺着聊一句</span>
                  <p>{isMatched ? question.matchedFollowUp : question.differentFollowUp}</p>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => onFollowUp(isMatched ? question.matchedFollowUp : question.differentFollowUp)}
                  >
                    放进输入框，我自己改
                  </button>
                </div>
                <button className="primary-button primary-button--wide" type="button" onClick={onNextRound}>
                  {roundIndex === questions.length - 1 ? '收下这局结果' : '下一轮，交换角色'}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
