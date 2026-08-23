import { useEffect, useRef, useState } from 'react';
import { ArcadePromptPreview } from '../arcade';
import type { CarnivalExclusiveGameDefinition, CarnivalGamePreview, CarnivalPromptGameDefinition } from '../carnival-types';
import type { ProfileRiddleChoiceGroup } from '../types';
import { CarnivalExclusiveChoiceRenderer } from './CarnivalExclusiveGameDialog';
import { TemplateGameStage, type DeepDiveTopic, type TwoChoiceQuestion } from './TemplateGameStage';

interface PromptGamePreviewCardProps {
  preview: CarnivalGamePreview;
  expired: boolean;
  footerNote?: string;
  onComplete?: () => void;
  onRestart?: () => void;
  onRuntimeError?: (message: string) => void;
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

type ExclusivePreview = CarnivalGamePreview & { game: CarnivalExclusiveGameDefinition };
type StablePreviewGame = Extract<CarnivalPromptGameDefinition, { schemaVersion: 2 }>;
type StablePreview = CarnivalGamePreview & { game: StablePreviewGame };

export function PromptGamePreviewCard(props: PromptGamePreviewCardProps) {
  if (props.preview.game.schemaVersion === 2) {
    return <StablePromptGamePreviewCard {...props} preview={{ ...props.preview, game: props.preview.game }} />;
  }
  if ('engine' in props.preview.game && props.preview.game.engine === 'arcade-v1') {
    return <ArcadePromptPreview {...props} preview={{ ...props.preview, game: props.preview.game }} />;
  }
  return <ExclusivePromptGamePreviewCard {...props} preview={{ ...props.preview, game: props.preview.game }} />;
}

function StablePromptGamePreviewCard({
  preview,
  expired,
  footerNote,
  onComplete,
  onRestart,
  onRuntimeError,
}: Omit<PromptGamePreviewCardProps, 'preview'> & { preview: StablePreview }) {
  const game = preview.game;
  const [viewer, setViewer] = useState<'a' | 'b'>('a');
  const generatedGroups: ProfileRiddleChoiceGroup[] = game.mechanics.kind === 'profile-riddle'
    ? game.mechanics.choiceGroups ?? game.questions.slice(0, 3).map((question) => ({
        id: question.id,
        options: question.options.slice(0, 3) as [string, string, string],
      }))
    : [];
  const groupsByTarget = game.mechanics.kind === 'profile-riddle'
    ? game.mechanics.choiceGroupsByTarget ?? { a: generatedGroups, b: generatedGroups }
    : { a: generatedGroups, b: generatedGroups };
  const topics: DeepDiveTopic[] = game.mechanics.kind === 'keyword-wheel'
    ? game.mechanics.segments.map((segment) => ({ id: segment.id, label: segment.keyword, followUps: segment.followUps ?? [segment.prompt, segment.followUp] }))
    : [];
  const questions: TwoChoiceQuestion[] = game.templateId === 'rapid-choice'
    ? game.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        optionA: question.options[0],
        optionB: question.options[1],
        matchedDiscussionPrompt: question.matchedFollowUp,
        differentDiscussionPrompt: question.differentFollowUp,
      }))
    : [];
  return (
    <section className="generated-template-prompt-preview" aria-label={`${game.gameType} 可玩预览`} aria-disabled={expired}>
      <TemplateGameStage
        key={preview.previewToken}
        template={game.templateId}
        label={game.gameType}
        gameTitle={game.title}
        viewer={viewer}
        players={{
          a: { nickname: '玩家 A', profileKeywords: groupsByTarget.a.flatMap((group) => group.options), profileChoiceGroups: groupsByTarget.a },
          b: { nickname: '玩家 B', profileKeywords: groupsByTarget.b.flatMap((group) => group.options), profileChoiceGroups: groupsByTarget.b },
        }}
        deepDiveTopics={topics}
        twoChoiceQuestions={questions}
        renderer={game.renderer}
        roundSeconds={game.mechanics.kind === 'rapid-choice' ? game.mechanics.roundSeconds : 8}
        sessionKey={preview.previewToken}
        paused={expired}
        onViewerChange={setViewer}
        onComplete={() => onComplete?.()}
        onRestart={onRestart}
        onRendererError={onRuntimeError}
      />
      <footer>
        <span>{expired ? '这个邀请版本已过期，请重新生成' : '试玩操作不会提交给对方'}</span>
        <small>{footerNote ?? `邀请版本保留至 ${formatClock(preview.expiresAt)}`}</small>
      </footer>
    </section>
  );
}

function ExclusivePromptGamePreviewCard({
  preview,
  expired,
  footerNote,
  onComplete,
  onRestart,
}: Omit<PromptGamePreviewCardProps, 'preview'> & { preview: ExclusivePreview }) {
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
