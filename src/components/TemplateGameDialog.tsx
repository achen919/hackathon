import { useEffect, useRef } from 'react';
import { TemplateGameStage, type DeepDiveTopic, type TemplateGameResult, type TwoChoiceQuestion } from './TemplateGameStage';
import type { GameDefinition, MatchPayload, ParticipantId, ProfileRiddleChoiceGroup } from '../types';
import { normalizeGeneratedTemplateRenderer } from '../generated-template';

interface TemplateGameDialogProps {
  open: boolean;
  game: GameDefinition;
  match: MatchPayload;
  viewer: ParticipantId;
  sessionKey: string;
  onViewerChange: (viewer: ParticipantId) => void;
  onFollowUp: (text: string) => void;
  onComplete: (result: TemplateGameResult) => void;
  onRestart: () => void;
  onClose: () => void;
}

export function TemplateGameDialog({
  open,
  game,
  match,
  viewer,
  sessionKey,
  onViewerChange,
  onFollowUp,
  onComplete,
  onRestart,
  onClose,
}: TemplateGameDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const frame = window.requestAnimationFrame(() => dialog?.querySelector<HTMLElement>('button:not(:disabled), select:not(:disabled)')?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), textarea:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (game.templateId === 'custom') return null;
  const generatedChoiceGroups: ProfileRiddleChoiceGroup[] = game.mechanics.kind === 'profile-riddle'
    ? game.mechanics.choiceGroups ?? game.questions.slice(0, 3).map((question) => ({
        id: question.id,
        options: question.options.slice(0, 3) as [string, string, string],
      }))
    : [];
  const generatedChoiceGroupsByTarget = game.mechanics.kind === 'profile-riddle'
    ? game.mechanics.choiceGroupsByTarget ?? { a: generatedChoiceGroups, b: generatedChoiceGroups }
    : { a: generatedChoiceGroups, b: generatedChoiceGroups };
  const deepDiveTopics: DeepDiveTopic[] = game.mechanics.kind === 'keyword-wheel'
    ? game.mechanics.segments.map((segment) => ({
      id: segment.id,
      label: segment.keyword,
        followUps: segment.followUps ?? [segment.prompt, segment.followUp],
      }))
    : [];
  const twoChoiceQuestions: TwoChoiceQuestion[] = game.templateId === 'rapid-choice'
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
    <div
      className="game-backdrop template-game-backdrop"
      role="presentation"
      hidden={!open}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section ref={dialogRef} className="template-game-dialog" role="dialog" aria-modal="true" aria-label={game.title} tabIndex={-1}>
        <TemplateGameStage
          key={sessionKey}
          template={game.templateId}
          label={game.gameType}
          gameTitle={game.title}
          viewer={viewer}
          players={{
            a: { nickname: match.user_a.nickname, profileKeywords: generatedChoiceGroupsByTarget.a.flatMap((group) => group.options), profileChoiceGroups: generatedChoiceGroupsByTarget.a },
            b: { nickname: match.user_b.nickname, profileKeywords: generatedChoiceGroupsByTarget.b.flatMap((group) => group.options), profileChoiceGroups: generatedChoiceGroupsByTarget.b },
          }}
          deepDiveTopics={deepDiveTopics}
          twoChoiceQuestions={twoChoiceQuestions}
          renderer={normalizeGeneratedTemplateRenderer(game.renderer) ?? undefined}
          roundSeconds={game.mechanics.kind === 'rapid-choice' ? game.mechanics.roundSeconds : 8}
          sessionKey={sessionKey}
          paused={!open}
          onViewerChange={onViewerChange}
          onSendToChat={onFollowUp}
          onComplete={onComplete}
          onRestart={onRestart}
          onExit={onClose}
        />
      </section>
    </div>
  );
}
