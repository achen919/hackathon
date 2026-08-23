import { useEffect, useMemo, useRef, useState } from 'react';
import { GeneratedGameSandbox, type PairPlayInput } from '../arcade/GeneratedGameSandbox';
import {
  generatedTemplateControls,
  generatedTemplateSeed,
  isProfileSelectValue,
  isProfileSubmitValue,
  isRapidAnswerValue,
  isRapidTimeoutValue,
} from '../generated-template';
import type { GeneratedTemplateRenderer, ParticipantId } from '../types';
import type {
  ActionRunner,
  CarnivalGamePublicState,
  CarnivalProfileRiddlePublicState,
  CarnivalRapidChoicePublicState,
} from './CarnivalGameDialog';

const PROFILE_FALLBACKS = [
  ['睡醒再决定安排', '约好一件事就够', '喜欢把一天排满'],
  ['先看评价再选店', '想吃什么当场定', '会为一家店绕路'],
  ['先列几个选项再定', '听完建议马上决定', '容易当场改变主意'],
] as const;

function profileGroups(state: CarnivalProfileRiddlePublicState) {
  const groups = state.choiceGroups?.slice(0, 3).map((group) => ({
    id: group.id,
    options: [...new Set(group.options.map((option) => option.trim()).filter(Boolean))].slice(0, 3),
  })).filter((group) => group.options.length === 3);
  if (groups?.length === 3) return groups;
  const flat = [...new Set([...state.keywordOptions, ...PROFILE_FALLBACKS.flat()].map((option) => option.trim()).filter(Boolean))];
  return PROFILE_FALLBACKS.map((_, index) => ({
    id: `profile-fallback-${index + 1}`,
    options: flat.slice(index * 3, index * 3 + 3),
  }));
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function RapidDeadlineHost({ state, pending, runAction }: {
  state: CarnivalRapidChoicePublicState;
  pending: boolean;
  runAction: ActionRunner;
}) {
  const timeoutQuestionRef = useRef<string | null>(null);
  const retryAtRef = useRef(0);
  const localDeadlineRef = useRef<{ questionId: string; source: number; value: number } | null>(null);
  const questionId = state.self.currentQuestionId;

  useEffect(() => {
    timeoutQuestionRef.current = null;
    retryAtRef.current = 0;
  }, [questionId]);

  useEffect(() => {
    if (state.phase !== 'answering' || !questionId || !state.self.deadlineAtMs) {
      localDeadlineRef.current = null;
      return undefined;
    }
    const maximumMs = Math.max(3, Math.min(15, state.roundSeconds || 8)) * 1_000;
    const candidate = performance.now() + Math.min(maximumMs, Math.max(0, state.self.deadlineAtMs - state.serverNowMs));
    const previous = localDeadlineRef.current;
    const deadline = previous?.questionId === questionId && previous.source === state.self.deadlineAtMs
      ? Math.min(previous.value, candidate)
      : candidate;
    localDeadlineRef.current = { questionId, source: state.self.deadlineAtMs, value: deadline };
    const tick = () => {
      if (performance.now() < deadline || pending || timeoutQuestionRef.current === questionId || performance.now() < retryAtRef.current) return;
      timeoutQuestionRef.current = questionId;
      void runAction({ type: 'rapid-choice.timeout', questionId }).then((started) => {
        if (!started) {
          timeoutQuestionRef.current = null;
          retryAtRef.current = performance.now() + 1_500;
        }
      });
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [pending, questionId, runAction, state.phase, state.roundSeconds, state.self.deadlineAtMs, state.serverNowMs]);

  return null;
}

function profileStateForRenderer(state: CarnivalProfileRiddlePublicState, participant: ParticipantId, selections: number[]) {
  return {
    templateId: state.templateId,
    title: state.title,
    phase: state.phase,
    me: {
      participantId: participant,
      submitted: state.submitted[participant],
      revealReady: state.revealReady[participant],
    },
    targetParticipantId: state.target.participantId,
    choiceGroups: profileGroups(state).map((group) => ({ id: group.id, options: group.options })),
    selections: state.phase === 'collecting' && !state.submitted[participant] ? selections : [],
    submitted: state.submitted,
    revealReady: state.revealReady,
    ...(state.phase === 'revealed' && state.revealedSubmissions
      ? { revealedSubmissions: state.revealedSubmissions }
      : {}),
  };
}

function stateForRenderer(state: CarnivalGamePublicState, participant: ParticipantId, selections: number[]) {
  if (state.templateId === 'profile-riddle') return profileStateForRenderer(state, participant, selections);
  if (state.templateId === 'keyword-wheel') {
    return {
      templateId: state.templateId,
      title: state.title,
      phase: state.phase,
      serverNowMs: state.serverNowMs,
      me: { participantId: participant },
      segments: state.segments.map((segment) => ({
        id: segment.id,
        keyword: segment.keyword,
        prompt: segment.prompt,
        followUps: segment.followUps,
      })),
      spinSequence: state.spinSequence,
      rotationDeg: state.rotationDeg,
      selectedSegmentId: state.selectedSegmentId,
      revealAtMs: state.revealAtMs,
      followUpIndex: state.followUpIndex,
      canSpin: state.canSpin,
    };
  }
  return {
    templateId: state.templateId,
    title: state.title,
    phase: state.phase,
    serverNowMs: state.serverNowMs,
    roundSeconds: Math.max(3, Math.min(15, state.roundSeconds || 8)),
    me: {
      participantId: state.self.participantId,
      answeredCount: state.self.answeredCount,
      completed: state.self.completed,
      currentQuestionId: state.self.currentQuestionId,
      deadlineAtMs: state.self.deadlineAtMs,
      revealReady: state.revealReady[participant],
    },
    peer: {
      participantId: state.peer.participantId,
      answeredCount: state.peer.answeredCount,
      completed: state.peer.completed,
    },
    questions: state.questions.map((question) => ({ id: question.id, prompt: question.prompt, options: question.options })),
    revealReady: state.revealReady,
    ...(state.phase === 'revealed' && state.results ? { results: state.results } : {}),
  };
}

export function GeneratedCarnivalTemplateStage({
  participant,
  state,
  renderer,
  pending,
  runAction,
  onFallback,
  onExit,
}: {
  participant: ParticipantId;
  state: CarnivalGamePublicState;
  renderer: GeneratedTemplateRenderer;
  pending: boolean;
  runAction: ActionRunner;
  onFallback: () => void;
  onExit: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [profileSelections, setProfileSelections] = useState([-1, -1, -1]);
  const serverClockRef = useRef({ serverNowMs: state.serverNowMs, receivedAt: performance.now() });
  if (serverClockRef.current.serverNowMs !== state.serverNowMs) {
    serverClockRef.current = { serverNowMs: state.serverNowMs, receivedAt: performance.now() };
  }
  const rendererState = useMemo(
    () => stateForRenderer(state, participant, profileSelections),
    [participant, profileSelections, state],
  );

  useEffect(() => {
    setProfileSelections([-1, -1, -1]);
  }, [renderer.artifact.artifactId, state.inviteId]);

  const input = (message: PairPlayInput) => {
    if (pending) return;
    if (state.templateId === 'profile-riddle') {
      if (state.phase !== 'collecting' || state.submitted[participant]) return;
      const groups = profileGroups(state);
      if (message.control === 'profile.select' && isProfileSelectValue(message.value)) {
        if (!groups[message.value.slot]?.options[message.value.optionIndex]) return;
        const selection = message.value;
        setProfileSelections((current) => current.map((value, slot) => slot === selection.slot ? selection.optionIndex : value));
        return;
      }
      if (message.control === 'profile.submit') {
        const indexes = message.value === undefined
          ? profileSelections
          : isProfileSubmitValue(message.value) ? message.value.selections : [];
        if (indexes.length !== 3 || indexes.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 2)) return;
        const keywords = indexes.map((optionIndex, slot) => groups[slot]?.options[optionIndex]);
        if (keywords.some((keyword) => !keyword) || new Set(keywords).size !== 3) return;
        void runAction({ type: 'profile-riddle.submit', keywords: keywords as [string, string, string] });
      }
      return;
    }
    if (state.templateId === 'keyword-wheel') {
      if (message.control === 'wheel.spin' && state.canSpin && state.phase !== 'spinning') {
        void runAction({ type: 'keyword-wheel.spin' });
      } else if (message.control === 'wheel.next' && state.phase === 'selected') {
        void runAction({ type: 'keyword-wheel.next-follow-up' });
      }
      return;
    }
    const questionId = state.self.currentQuestionId;
    if (state.phase !== 'answering' || !questionId || !state.self.deadlineAtMs) return;
    const estimatedServerNow = serverClockRef.current.serverNowMs + Math.max(0, performance.now() - serverClockRef.current.receivedAt);
    const expired = state.self.deadlineAtMs <= estimatedServerNow;
    if (message.control === 'rapid.answer' && !expired && isRapidAnswerValue(message.value) && message.value.questionId === questionId) {
      void runAction({ type: 'rapid-choice.answer', questionId, answer: message.value.answer });
    } else if (message.control === 'rapid.timeout' && isRapidTimeoutValue(message.value) && message.value.questionId === questionId) {
      void runAction({ type: 'rapid-choice.timeout', questionId });
    }
  };

  return (
    <div className="carnival-game-body carnival-generated-template">
      {state.templateId === 'rapid-choice' && <RapidDeadlineHost state={state} pending={pending} runAction={runAction} />}
      <GeneratedGameSandbox
        artifact={renderer.artifact}
        role={participant}
        playMode="network"
        mode={state.templateId}
        seed={generatedTemplateSeed(renderer)}
        state={rendererState}
        allowedControls={generatedTemplateControls(state.templateId)}
        paused={pending || state.phase === 'revealed'}
        reducedMotion={reducedMotion}
        title={`${state.title} AI 定制界面`}
        className="generated-template-sandbox"
        fallback={<p>正在同步这份 AI 定制界面…</p>}
        onInput={input}
        onError={onFallback}
        onEscape={onExit}
      />
      <div className="carnival-generated-template__host-controls" aria-live="polite">
        {state.templateId === 'profile-riddle' && state.phase === 'reveal-ready' && (
          <button className="carnival-game-primary" type="button" disabled={pending || state.revealReady[participant]} onClick={() => void runAction({ type: 'profile-riddle.confirm-reveal' })}>
            {state.revealReady[participant] ? '已确认，等待对方' : '双方准备好了，一起揭晓'}
          </button>
        )}
        {state.templateId === 'rapid-choice' && state.phase === 'reveal-ready' && (
          <button className="carnival-game-primary" type="button" disabled={pending || state.revealReady[participant]} onClick={() => void runAction({ type: 'rapid-choice.confirm-reveal' })}>
            {state.revealReady[participant] ? '已确认，等待对方' : '双方准备好了，一起查看'}
          </button>
        )}
        <button className="carnival-game-secondary" type="button" onClick={onFallback}>使用安全模板界面</button>
      </div>
      <p className="carnival-game-privacy">生成代码只收到本局公开题面、我的进度和服务器结果；聊天、资料与未揭晓答案不会进入沙箱。</p>
    </div>
  );
}
