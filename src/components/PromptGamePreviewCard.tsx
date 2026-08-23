import { useEffect, useRef, useState } from 'react';
import type { CarnivalGamePreview } from '../carnival-types';
import { CarnivalExclusiveChoiceRenderer } from './CarnivalExclusiveGameDialog';

interface PromptGamePreviewCardProps {
  preview: CarnivalGamePreview;
  expired: boolean;
  footerNote?: string;
  onComplete?: () => void;
  onRestart?: () => void;
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function PromptGamePreviewCard({
  preview,
  expired,
  footerNote,
  onComplete,
  onRestart,
}: PromptGamePreviewCardProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const completionReportedRef = useRef(false);
  const [roundIndex, setRoundIndex] = useState(0);
  const [choices, setChoices] = useState<Array<number | null>>(() => preview.game.questions.map(() => null));
  const completed = roundIndex >= preview.game.questions.length;
  const question = preview.game.questions[Math.min(roundIndex, preview.game.questions.length - 1)];
  const choice = choices[roundIndex] ?? null;
  const visual = preview.game.presentation;

  useEffect(() => {
    titleRef.current?.focus();
  }, [completed, preview.previewToken]);
  useEffect(() => {
    completionReportedRef.current = false;
  }, [preview.previewToken]);
  useEffect(() => {
    if (!completed || completionReportedRef.current) return;
    completionReportedRef.current = true;
    onComplete?.();
  }, [completed, onComplete]);

  const interactionLabel = question.interaction.kind === 'swipe-deck'
    ? '滑动牌组'
    : question.interaction.kind === 'mood-dial'
      ? '情绪转盘'
      : question.interaction.kind === 'orbit-pick'
        ? '星轨选择'
        : '互动卡片';
  const hasUnplayedOtherRound = choices.some((item, index) => index !== roundIndex && item === null);
  const choose = (value: number) => {
    setChoices((current) => current.map((item, index) => index === roundIndex ? value : item));
  };
  const advance = () => {
    const nextUnplayed = choices.findIndex((item, index) => index > roundIndex && item === null);
    if (nextUnplayed >= 0) {
      setRoundIndex(nextUnplayed);
      return;
    }
    const firstUnplayed = choices.findIndex((item) => item === null);
    setRoundIndex(firstUnplayed >= 0 ? firstUnplayed : preview.game.questions.length);
  };
  const restart = () => {
    onRestart?.();
    setChoices(preview.game.questions.map(() => null));
    setRoundIndex(0);
  };
  const openRound = (index: number) => {
    if (completed) onRestart?.();
    setRoundIndex(index);
  };

  return (
    <section
      className={`carnival-prompt-game-preview is-${visual.tone} scene-${visual.scene} motion-${visual.motion} ${expired ? 'is-expired' : ''}`}
      aria-labelledby="carnival-prompt-game-preview-title"
      aria-disabled={expired}
    >
      <header>
        <div className="carnival-prompt-game-preview__badges">
          <b>{completed ? '试玩结尾' : interactionLabel}</b>
        </div>
      </header>
      <div className="carnival-prompt-game-preview__scene" aria-hidden="true"><i /><i /><i /></div>
      <nav className="carnival-prompt-game-preview__rounds" aria-label="切换试玩回合">
        {preview.game.questions.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-current={!completed && roundIndex === index ? 'step' : undefined}
            className={!completed && roundIndex === index ? 'is-current' : choices[index] !== null ? 'is-played' : ''}
            disabled={expired}
            onClick={() => openRound(index)}
          >
            <i aria-hidden="true">{choices[index] !== null ? '✓' : index + 1}</i>{item.label}
          </button>
        ))}
      </nav>
      {completed ? (
        <div className={`carnival-prompt-game-preview__ending effect-${visual.revealEffect}`} aria-live="polite">
          <span aria-hidden="true">✦</span>
          <h3 ref={titleRef} id="carnival-prompt-game-preview-title" tabIndex={-1}>{preview.game.ending.headline}</h3>
          <strong>{preview.game.ending.summary}</strong>
          <ol>
            {preview.game.questions.map((item, index) => {
              const selectedIndex = choices[index];
              return <li key={item.id}><i>{index + 1}</i>{selectedIndex === null ? '未试玩' : item.options[selectedIndex]}</li>;
            })}
          </ol>
          <button type="button" disabled={expired} onClick={restart}>从头再试玩</button>
        </div>
      ) : (
        <>
          <div className="carnival-prompt-game-preview__copy">
            <p>{question.label} · 第 {roundIndex + 1}/3 轮试玩</p>
            <h3 ref={titleRef} id="carnival-prompt-game-preview-title" tabIndex={-1}>{preview.game.title}</h3>
            <span>{question.prompt}</span>
          </div>
          <CarnivalExclusiveChoiceRenderer
            question={question}
            choice={choice}
            onChange={choose}
            disabled={expired}
            ariaLabel={`试玩第 ${roundIndex + 1} 轮，选择一个答案`}
            preview
          />
          <div className="carnival-prompt-game-preview__actions">
            <button type="button" disabled={expired || roundIndex === 0} onClick={() => setRoundIndex((current) => Math.max(0, current - 1))}>上一轮</button>
            <button type="button" disabled={expired || choice === null} onClick={advance}>
              {roundIndex === 2 ? hasUnplayedOtherRound ? '补完其他回合' : '完成三轮试玩' : '下一轮'}
            </button>
          </div>
        </>
      )}
      <footer aria-live="polite">
        <span>{completed ? `聊聊看：${preview.game.ending.chatPrompt}` : choice === null ? '点一个选项试试手感' : `已试玩：${question.options[choice] ?? '已选择'}（未提交）`}</span>
        <small>{footerNote ?? (expired ? '这个邀请版本已过期，请重新生成' : `邀请版本保留至 ${formatClock(preview.expiresAt)}`)}</small>
      </footer>
    </section>
  );
}
