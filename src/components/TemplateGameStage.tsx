import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { GameTemplateId, ParticipantId, ProfileRiddleChoiceGroup } from '../types';
import '../template-games.css';

export type TemplateGameType = Exclude<GameTemplateId, 'custom'>;

export interface TemplateGamePlayer {
  nickname: string;
  /** Three hidden-dimension groups; the UI deliberately shows only their order. */
  profileChoiceGroups?: ProfileRiddleChoiceGroup[];
  /** Legacy flat candidates for persisted games created before grouped choices. */
  profileKeywords: string[];
}

export interface DeepDiveTopic {
  id: string;
  label: string;
  /** 转到该主题后按顺序轮换的追问。 */
  followUps: string[];
}

export interface TwoChoiceQuestion {
  id: string;
  prompt: string;
  optionA: string;
  optionB: string;
  /** 同选和异选分别使用的中性追问，不应评价某个选项更好。 */
  matchedDiscussionPrompt: string;
  differentDiscussionPrompt: string;
}

export type TwoChoiceAnswer = 0 | 1 | 'timeout';

export type TemplateGameResult =
  | {
      type: 'profile-riddle';
      guesses: Record<ParticipantId, string[]>;
    }
  | {
      type: 'keyword-wheel';
      topic: DeepDiveTopic;
      followUp: string;
    }
  | {
      type: 'rapid-choice';
      questions: TwoChoiceQuestion[];
      answers: Record<ParticipantId, TwoChoiceAnswer[]>;
    };

export interface TemplateGameStageProps {
  template: TemplateGameType;
  label: string;
  viewer: ParticipantId;
  players: Record<ParticipantId, TemplateGamePlayer>;
  deepDiveTopics?: DeepDiveTopic[];
  twoChoiceQuestions?: TwoChoiceQuestion[];
  /** 同一模板开新局时修改此值，组件会重置内部进度。 */
  sessionKey?: string;
  /** 对话框暂时关闭时暂停倒计时，同时保留双方尚未揭晓的进度。 */
  paused?: boolean;
  onViewerChange?: (viewer: ParticipantId) => void;
  onSendToChat?: (text: string) => void;
  onComplete?: (result: TemplateGameResult) => void;
  onRestart?: () => void;
  onExit?: () => void;
}

const DEFAULT_PROFILE_CHOICE_GROUPS: ProfileRiddleChoiceGroup[] = [
  {
    id: 'profile-weekend',
    options: ['睡醒再决定安排', '约好一件事就够', '喜欢把一天排满'],
  },
  {
    id: 'profile-food',
    options: ['先看评价再选店', '想吃什么当场定', '会为一家店绕路'],
  },
  {
    id: 'profile-decision',
    options: ['先列几个选项再定', '听完建议马上决定', '容易当场改变主意'],
  },
];

const DEFAULT_PROFILE_KEYWORDS = DEFAULT_PROFILE_CHOICE_GROUPS.flatMap((group) => group.options);

const DEFAULT_DEEP_DIVE_TOPICS: DeepDiveTopic[] = [
  {
    id: 'weekend',
    label: '周末',
    followUps: ['你理想的周末，是充满安排还是随心一点？', '最近哪个周末让你觉得过得很值？'],
  },
  {
    id: 'food',
    label: '美食',
    followUps: ['有没有一道食物，能立刻让你心情变好？', '如果一起吃顿饭，你会选熟悉的店还是去探店？'],
  },
  {
    id: 'travel',
    label: '旅行',
    followUps: ['你在旅行中最在意风景、美食，还是同行的人？', '哪次出发让你发现了自己的新一面？'],
  },
  {
    id: 'tiny-happiness',
    label: '小确幸',
    followUps: ['最近一件很小、但让你开心很久的事是什么？', '忙碌的一天结束后，什么仪式最能让你放松？'],
  },
  {
    id: 'relationship',
    label: '相处',
    followUps: ['你觉得两个人变熟的标志是什么？', '什么样的小细节会让你觉得被在意？'],
  },
  {
    id: 'curiosity',
    label: '好奇心',
    followUps: ['最近你在主动了解什么新东西？', '有什么事你一直想尝试，还没有开始？'],
  },
];

const DEFAULT_TWO_CHOICE_QUESTIONS: TwoChoiceQuestion[] = [
  {
    id: 'plan-or-go',
    prompt: '周末出去玩，你更偏向……',
    optionA: '提前把攻略做好',
    optionB: '当天醒来再决定',
    matchedDiscussionPrompt: '这种方式最吸引你的是什么？',
    differentDiscussionPrompt: '各自最看重的是安心感还是自由感？',
  },
  {
    id: 'talk-or-space',
    prompt: '心情不好的时候，你更希望对方……',
    optionA: '马上来聊聊',
    optionB: '先给我一点空间',
    matchedDiscussionPrompt: '你平时会怎么把这个需要告诉对方？',
    differentDiscussionPrompt: '怎样表达，才能让对方不需要猜？',
  },
  {
    id: 'photo-or-moment',
    prompt: '遇到很好看的日落，你更可能……',
    optionA: '先拍下来分享',
    optionB: '先安静地看一会儿',
    matchedDiscussionPrompt: '最近保存了哪个让你印象很深的瞬间？',
    differentDiscussionPrompt: '你们分别更习惯用什么方式记住一个好瞬间？',
  },
];

const OTHER_PLAYER: Record<ParticipantId, ParticipantId> = { a: 'b', b: 'a' };

function uniqueText(items: string[], fallback: string[], maximum = 12) {
  const clean = items
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 24);
  return [...new Set([...clean, ...fallback])].slice(0, maximum);
}

function normalizeTopics(topics?: DeepDiveTopic[]) {
  const clean = (topics ?? []).filter((topic) => (
    topic.id.trim() &&
    topic.label.trim() &&
    topic.followUps.some((followUp) => followUp.trim())
  ));
  return (clean.length >= 3 ? clean : DEFAULT_DEEP_DIVE_TOPICS).slice(0, 8).map((topic) => ({
    ...topic,
    label: topic.label.trim().slice(0, 8),
    followUps: topic.followUps.map((item) => item.trim()).filter(Boolean).slice(0, 4),
  }));
}

function normalizeTwoChoiceQuestions(questions?: TwoChoiceQuestion[]) {
  const clean = (questions ?? []).filter((question) => (
    question.id.trim() &&
    question.prompt.trim() &&
    question.optionA.trim() &&
    question.optionB.trim() &&
    question.matchedDiscussionPrompt.trim() &&
    question.differentDiscussionPrompt.trim()
  ));
  return (clean.length >= 3 ? clean : DEFAULT_TWO_CHOICE_QUESTIONS).slice(0, 5);
}

function buildGuessSentence(targetName: string, keywords: string[]) {
  const [first, second, third] = keywords;
  return `我觉得${targetName}是一个${first}、${second}，而且${third}的人。`;
}

function normalizeProfileChoiceGroups(player: TemplateGamePlayer): ProfileRiddleChoiceGroup[] {
  const grouped = player.profileChoiceGroups?.slice(0, 3).map((group) => ({
    id: group.id,
    options: uniqueText(group.options, [], 3),
  })).filter((group) => group.options.length === 3);
  if (grouped?.length === 3) return grouped as ProfileRiddleChoiceGroup[];

  const flat = uniqueText(player.profileKeywords, DEFAULT_PROFILE_KEYWORDS);
  return DEFAULT_PROFILE_CHOICE_GROUPS.map((fallback, index) => ({
    id: fallback.id,
    options: flat.slice(index * 3, index * 3 + 3) as [string, string, string],
  }));
}

function usePrefersReducedMotion() {
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

export function TemplateGameStage({
  template,
  label,
  viewer,
  players,
  deepDiveTopics,
  twoChoiceQuestions,
  sessionKey = 'default',
  paused = false,
  onViewerChange,
  onSendToChat,
  onComplete,
  onRestart,
  onExit,
}: TemplateGameStageProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const templateRootRef = useRef<HTMLElement>(null);
  const topics = useMemo(() => normalizeTopics(deepDiveTopics), [deepDiveTopics]);
  const questions = useMemo(() => normalizeTwoChoiceQuestions(twoChoiceQuestions), [twoChoiceQuestions]);
  const [localViewer, setLocalViewer] = useState(viewer);

  const [profileActivePlayer, setProfileActivePlayer] = useState<ParticipantId>(viewer);
  const [profileSelections, setProfileSelections] = useState(['', '', '']);
  const [profileGuesses, setProfileGuesses] = useState<Partial<Record<ParticipantId, string[]>>>({});
  const [profilePhase, setProfilePhase] = useState<'choosing' | 'handoff' | 'reveal-ready' | 'reveal'>('choosing');

  const [wheelRotation, setWheelRotation] = useState(0);
  const [wheelSpinning, setWheelSpinning] = useState(false);
  const [selectedTopicIndex, setSelectedTopicIndex] = useState<number | null>(null);
  const [followUpIndex, setFollowUpIndex] = useState(0);
  const wheelTimeoutRef = useRef<number | null>(null);
  const wheelPendingTopicRef = useRef<number | null>(null);

  const [twoFirstPlayer, setTwoFirstPlayer] = useState<ParticipantId>(viewer);
  const [twoActivePlayer, setTwoActivePlayer] = useState<ParticipantId>(viewer);
  const [twoRoundIndex, setTwoRoundIndex] = useState(0);
  const [twoPhase, setTwoPhase] = useState<'ready' | 'answering' | 'handoff' | 'reveal-ready' | 'reveal'>('ready');
  const [secondsLeft, setSecondsLeft] = useState(5);
  const [twoTransitioning, setTwoTransitioning] = useState(false);
  const [twoPendingAnswer, setTwoPendingAnswer] = useState<TwoChoiceAnswer | null>(null);
  const [twoAnswers, setTwoAnswers] = useState<Record<ParticipantId, TwoChoiceAnswer[]>>({ a: [], b: [] });
  const twoAnswersRef = useRef(twoAnswers);
  const answerLockRef = useRef(false);
  const twoDeadlineRef = useRef<number | null>(null);
  const twoRemainingMsRef = useRef(5_000);
  const twoAdvanceTimeoutRef = useRef<number | null>(null);
  const rapidBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalViewer(viewer);
  }, [viewer]);

  const changeViewer = useCallback((nextViewer: ParticipantId) => {
    setLocalViewer(nextViewer);
    onViewerChange?.(nextViewer);
  }, [onViewerChange]);

  useEffect(() => {
    const firstViewer = viewer;
    setLocalViewer(firstViewer);
    setProfileActivePlayer(firstViewer);
    setProfileSelections(['', '', '']);
    setProfileGuesses({});
    setProfilePhase('choosing');

    if (wheelTimeoutRef.current !== null) window.clearTimeout(wheelTimeoutRef.current);
    wheelTimeoutRef.current = null;
    wheelPendingTopicRef.current = null;
    setWheelRotation(0);
    setWheelSpinning(false);
    setSelectedTopicIndex(null);
    setFollowUpIndex(0);

    const emptyAnswers: Record<ParticipantId, TwoChoiceAnswer[]> = { a: [], b: [] };
    setTwoFirstPlayer(firstViewer);
    setTwoActivePlayer(firstViewer);
    setTwoRoundIndex(0);
    setTwoPhase('ready');
    setSecondsLeft(5);
    setTwoTransitioning(false);
    setTwoPendingAnswer(null);
    setTwoAnswers(emptyAnswers);
    twoAnswersRef.current = emptyAnswers;
    answerLockRef.current = false;
    twoDeadlineRef.current = null;
    twoRemainingMsRef.current = 5_000;
    if (twoAdvanceTimeoutRef.current !== null) window.clearTimeout(twoAdvanceTimeoutRef.current);
    twoAdvanceTimeoutRef.current = null;
  // `viewer` is intentionally sampled only when a new session/template starts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, template]);

  useEffect(() => () => {
    if (wheelTimeoutRef.current !== null) window.clearTimeout(wheelTimeoutRef.current);
    if (twoAdvanceTimeoutRef.current !== null) window.clearTimeout(twoAdvanceTimeoutRef.current);
  }, []);

  const finishWheelSpin = useCallback(() => {
    if (pausedRef.current) {
      wheelTimeoutRef.current = null;
      return;
    }
    const nextTopicIndex = wheelPendingTopicRef.current;
    if (nextTopicIndex === null) return;
    const selectedTopic = topics[nextTopicIndex];
    wheelPendingTopicRef.current = null;
    wheelTimeoutRef.current = null;
    setSelectedTopicIndex(nextTopicIndex);
    setWheelSpinning(false);
    onComplete?.({
      type: 'keyword-wheel',
      topic: selectedTopic,
      followUp: selectedTopic.followUps[0],
    });
  }, [onComplete, topics]);

  useEffect(() => {
    if (template !== 'keyword-wheel') return;
    if (paused) {
      if (wheelTimeoutRef.current !== null) window.clearTimeout(wheelTimeoutRef.current);
      wheelTimeoutRef.current = null;
      return;
    }
    if (wheelSpinning && wheelPendingTopicRef.current !== null && wheelTimeoutRef.current === null) {
      wheelTimeoutRef.current = window.setTimeout(finishWheelSpin, prefersReducedMotion ? 80 : 350);
    }
  }, [finishWheelSpin, paused, prefersReducedMotion, template, wheelSpinning]);

  const submitProfileGuess = () => {
    if (profileSelections.some((selection) => !selection)) return;
    const nextGuesses = { ...profileGuesses, [profileActivePlayer]: [...profileSelections] };
    setProfileGuesses(nextGuesses);
    setProfileSelections(['', '', '']);

    const secondPlayer = OTHER_PLAYER[profileActivePlayer];
    if (nextGuesses[secondPlayer]) {
      setProfilePhase('reveal-ready');
    } else {
      setProfilePhase('handoff');
    }
  };

  const revealProfileGuesses = () => {
    const completeGuesses = profileGuesses as Record<ParticipantId, string[]>;
    setProfilePhase('reveal');
    onComplete?.({ type: 'profile-riddle', guesses: completeGuesses });
  };

  const handoffProfileGuess = () => {
    const nextPlayer = OTHER_PLAYER[profileActivePlayer];
    setProfileActivePlayer(nextPlayer);
    changeViewer(nextPlayer);
    setProfilePhase('choosing');
  };

  const restartProfileGuess = () => {
    onRestart?.();
    setProfileGuesses({});
    setProfileSelections(['', '', '']);
    setProfileActivePlayer(localViewer);
    setProfilePhase('choosing');
  };

  const spinWheel = () => {
    if (wheelSpinning || topics.length === 0) return;
    if (selectedTopicIndex !== null) onRestart?.();
    if (wheelTimeoutRef.current !== null) window.clearTimeout(wheelTimeoutRef.current);

    const nextTopicIndex = Math.floor(Math.random() * topics.length);
    const segment = 360 / topics.length;
    const completedTurns = Math.floor(wheelRotation / 360) + 3;
    const nextRotation = completedTurns * 360 + (360 - (nextTopicIndex + 0.5) * segment);
    setWheelSpinning(true);
    setSelectedTopicIndex(null);
    setFollowUpIndex(0);
    setWheelRotation(nextRotation);
    wheelPendingTopicRef.current = nextTopicIndex;
    wheelTimeoutRef.current = window.setTimeout(finishWheelSpin, prefersReducedMotion ? 80 : 1500);
  };

  const commitTwoChoice = useCallback((answer: TwoChoiceAnswer) => {
    if (pausedRef.current || answerLockRef.current || twoPhase !== 'answering') return;
    answerLockRef.current = true;
    const effectiveAnswer = answer !== 'timeout' && twoDeadlineRef.current !== null && performance.now() >= twoDeadlineRef.current
      ? 'timeout'
      : answer;
    twoDeadlineRef.current = null;
    setTwoTransitioning(true);
    setTwoPendingAnswer(effectiveAnswer);

    const activeAnswers = [...twoAnswersRef.current[twoActivePlayer]];
    activeAnswers[twoRoundIndex] = effectiveAnswer;
    const nextAnswers = {
      ...twoAnswersRef.current,
      [twoActivePlayer]: activeAnswers,
    };
    twoAnswersRef.current = nextAnswers;
    setTwoAnswers(nextAnswers);

    if (twoRoundIndex < questions.length - 1) {
      twoAdvanceTimeoutRef.current = window.setTimeout(() => {
        setTwoRoundIndex((current) => current + 1);
        setTwoTransitioning(false);
        setTwoPendingAnswer(null);
        twoAdvanceTimeoutRef.current = null;
      }, 600);
      return;
    }

    setTwoTransitioning(false);
    setTwoPendingAnswer(null);
    if (twoActivePlayer === twoFirstPlayer) {
      setTwoPhase('handoff');
      return;
    }

    setTwoPhase('reveal-ready');
  }, [questions.length, twoActivePlayer, twoFirstPlayer, twoPhase, twoRoundIndex]);

  useEffect(() => {
    if (template !== 'rapid-choice' || twoPhase !== 'answering') return;
    twoRemainingMsRef.current = 5_000;
    setSecondsLeft(5);
  }, [template, twoActivePlayer, twoPhase, twoRoundIndex]);

  useEffect(() => {
    if (template !== 'rapid-choice' || twoPhase !== 'answering' || paused || twoTransitioning) return undefined;
    answerLockRef.current = false;
    setTwoTransitioning(false);
    setTwoPendingAnswer(null);
    const remainingMs = Math.max(0, Math.min(5_000, twoRemainingMsRef.current));
    setSecondsLeft(Math.ceil(remainingMs / 1_000));
    if (remainingMs === 0) {
      queueMicrotask(() => commitTwoChoice('timeout'));
      return undefined;
    }
    const deadline = performance.now() + remainingMs;
    twoDeadlineRef.current = deadline;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1_000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        window.clearInterval(timer);
        commitTwoChoice('timeout');
      }
    }, 200);

    return () => {
      window.clearInterval(timer);
      if (twoDeadlineRef.current === deadline) {
        twoRemainingMsRef.current = Math.max(0, deadline - performance.now());
        twoDeadlineRef.current = null;
      }
    };
  }, [commitTwoChoice, paused, template, twoActivePlayer, twoPhase, twoRoundIndex, twoTransitioning]);

  useEffect(() => {
    if (template !== 'rapid-choice' || paused) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const target = twoPhase === 'answering'
        ? rapidBodyRef.current?.querySelector<HTMLElement>('.template-game__question')
        : twoPhase === 'reveal'
          ? rapidBodyRef.current?.querySelector<HTMLElement>('[data-stage-heading]')
          : rapidBodyRef.current?.querySelector<HTMLElement>('.template-game__primary:not(:disabled)');
      target?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [paused, template, twoActivePlayer, twoPhase, twoRoundIndex]);

  const handoffTwoChoice = () => {
    const nextPlayer = OTHER_PLAYER[twoFirstPlayer];
    setTwoActivePlayer(nextPlayer);
    setTwoRoundIndex(0);
    setTwoPhase('ready');
    changeViewer(nextPlayer);
  };

  const restartTwoChoice = () => {
    onRestart?.();
    const emptyAnswers: Record<ParticipantId, TwoChoiceAnswer[]> = { a: [], b: [] };
    setTwoAnswers(emptyAnswers);
    twoAnswersRef.current = emptyAnswers;
    setTwoFirstPlayer(localViewer);
    setTwoActivePlayer(localViewer);
    setTwoRoundIndex(0);
    setTwoPhase('ready');
    setSecondsLeft(5);
    setTwoTransitioning(false);
    setTwoPendingAnswer(null);
    answerLockRef.current = false;
    twoDeadlineRef.current = null;
    twoRemainingMsRef.current = 5_000;
  };

  useEffect(() => {
    if (paused || template === 'rapid-choice') return undefined;
    const frame = window.requestAnimationFrame(() => {
      const root = templateRootRef.current;
      let target: HTMLElement | null | undefined;
      if (template === 'profile-riddle') {
        target = profilePhase === 'choosing' && localViewer === profileActivePlayer
          ? root?.querySelector<HTMLElement>('select:not(:disabled)')
          : profilePhase === 'reveal'
            ? root?.querySelector<HTMLElement>('[data-stage-heading]')
            : root?.querySelector<HTMLElement>('.template-game__primary:not(:disabled)');
      } else if (!wheelSpinning) {
        target = selectedTopicIndex === null
          ? root?.querySelector<HTMLElement>('.template-game__spin-button:not(:disabled)')
          : root?.querySelector<HTMLElement>('[data-stage-heading]');
      }
      target?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [followUpIndex, localViewer, paused, profileActivePlayer, profilePhase, selectedTopicIndex, template, wheelSpinning]);

  const revealTwoChoice = () => {
    setTwoPhase('reveal');
    onComplete?.({ type: 'rapid-choice', questions, answers: twoAnswersRef.current });
  };

  const selectedTopic = selectedTopicIndex === null ? null : topics[selectedTopicIndex];
  const selectedFollowUp = selectedTopic
    ? selectedTopic.followUps[followUpIndex % selectedTopic.followUps.length]
    : null;
  const showNextFollowUp = () => {
    if (!selectedTopic) return;
    const nextIndex = (followUpIndex + 1) % selectedTopic.followUps.length;
    const nextFollowUp = selectedTopic.followUps[nextIndex];
    setFollowUpIndex(nextIndex);
    onComplete?.({ type: 'keyword-wheel', topic: selectedTopic, followUp: nextFollowUp });
  };
  const wheelGradient = `conic-gradient(${topics.map((_, index) => {
    const start = (index * 360) / topics.length;
    const end = ((index + 1) * 360) / topics.length;
    return `${index % 2 === 0 ? '#5746c7' : '#a83f35'} ${start}deg ${end}deg`;
  }).join(', ')})`;

  const titleByTemplate: Record<TemplateGameType, string> = {
    'profile-riddle': '凭第一感觉，猜 TA 的 3 个小细节',
    'keyword-wheel': '转一下，把一个话题聊深一点',
    'rapid-choice': '5 秒凭直觉，看看你们怎么选',
  };

  return (
    <section ref={templateRootRef} className="template-game" aria-labelledby="template-game-title">
      <header className="template-game__header">
        <div>
          <p className="template-game__eyebrow">双人破冰 · {label}</p>
          <h2 id="template-game-title">{titleByTemplate[template]}</h2>
        </div>
        {onExit && (
          <button className="template-game__close" type="button" onClick={onExit} aria-label="退出游戏">
            ×
          </button>
        )}
      </header>

      {template === 'profile-riddle' && (
        <div className="template-game__body">
          {profilePhase === 'choosing' && localViewer !== profileActivePlayer ? (
            <PrivateTurnGate
              activeName={players[profileActivePlayer].nickname}
              onSwitch={() => changeViewer(profileActivePlayer)}
            />
          ) : profilePhase === 'choosing' ? (
            <div className="template-game__stage">
              <TurnBanner
                name={players[profileActivePlayer].nickname}
                detail={`正在描述 ${players[OTHER_PLAYER[profileActivePlayer]].nickname}`}
              />
              <p className="template-game__lead">
                每一框都是不同生活场景。没有标准答案，选你的第一感觉就好。
              </p>
              <div className="template-game__selects">
                {[0, 1, 2].map((slot) => {
                  const choiceGroup = normalizeProfileChoiceGroups(players[OTHER_PLAYER[profileActivePlayer]])[slot]
                    ?? DEFAULT_PROFILE_CHOICE_GROUPS[slot];
                  return (
                    <label key={slot} className="template-game__field">
                      <span>小猜测 {slot + 1}</span>
                      <select
                        value={profileSelections[slot]}
                        onChange={(event) => {
                          const nextSelections = [...profileSelections];
                          nextSelections[slot] = event.target.value;
                          setProfileSelections(nextSelections);
                        }}
                      >
                        <option value="">请选择</option>
                        {choiceGroup.options.map((keyword) => (
                          <option key={keyword} value={keyword}>
                            {keyword}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
              <div className="template-game__sentence" aria-live="polite">
                <span>你的一句话</span>
                <p>
                  {profileSelections.every(Boolean)
                    ? buildGuessSentence(players[OTHER_PLAYER[profileActivePlayer]].nickname, profileSelections)
                    : '选满 3 个小猜测后，这里会自动组成一句话。'}
                </p>
              </div>
              <button
                className="template-game__primary"
                type="button"
                disabled={profileSelections.some((selection) => !selection)}
                onClick={submitProfileGuess}
              >
                锁定这句话
              </button>
            </div>
          ) : profilePhase === 'handoff' ? (
            <div className="template-game__handoff" aria-live="polite">
              <span className="template-game__big-icon" aria-hidden="true">🔐</span>
              <p className="template-game__eyebrow">第一份印象已保密</p>
              <h3>轮到 {players[OTHER_PLAYER[profileActivePlayer]].nickname} 了</h3>
              <p>把手机交给 TA，两人都完成后再一起揭晓。</p>
              <button className="template-game__primary" type="button" onClick={handoffProfileGuess}>
                切换到 {players[OTHER_PLAYER[profileActivePlayer]].nickname}
              </button>
            </div>
          ) : profilePhase === 'reveal-ready' ? (
            <div className="template-game__handoff" aria-live="polite">
              <span className="template-game__big-icon" aria-hidden="true">🤝</span>
              <p className="template-game__eyebrow">两份印象都已保密保存</p>
              <h3>把手机放在你们中间</h3>
              <p>接下来会同时显示双方的三个小猜测。确认两个人都准备好，再一起揭晓。</p>
              <button className="template-game__primary" type="button" onClick={revealProfileGuesses}>
                我们准备好了，一起揭晓
              </button>
            </div>
          ) : (
            <div className="template-game__reveal" aria-live="polite">
              <span className="template-game__big-icon" aria-hidden="true">✦</span>
              <p className="template-game__eyebrow">印象交换完成</p>
              <h3 data-stage-heading tabIndex={-1}>你们眼中的彼此</h3>
              <div className="template-game__guess-grid">
                {(['a', 'b'] as ParticipantId[]).map((author) => {
                  const target = OTHER_PLAYER[author];
                  const guess = profileGuesses[author] ?? DEFAULT_PROFILE_KEYWORDS.slice(0, 3);
                  const sentence = buildGuessSentence(players[target].nickname, guess);
                  return (
                    <article key={author} className="template-game__result-card">
                      <span>{players[author].nickname} 的印象</span>
                      <p>{sentence}</p>
                      {onSendToChat && (
                        <button type="button" className="template-game__text-button" onClick={() => onSendToChat(sentence)}>
                          放进输入框，我再改改
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
              <p className="template-game__discussion">
                想回哪句都可以：“这个挺准”“你猜反了”“我其实只有出去玩时会这样”。
              </p>
              <button className="template-game__primary" type="button" onClick={restartProfileGuess}>
                换一组词再玩
              </button>
            </div>
          )}
        </div>
      )}

      {template === 'keyword-wheel' && (
        <div className="template-game__body template-game__body--wheel">
          <div className="template-game__wheel-wrap">
            <span className="template-game__wheel-pointer" aria-hidden="true" />
            <div
              className={`template-game__wheel ${wheelSpinning ? 'is-spinning' : ''}`}
              style={{ background: wheelGradient, transform: `rotate(${wheelRotation}deg)` }}
              role="img"
              aria-label={`话题转盘，包含 ${topics.map((topic) => topic.label).join('、')}`}
            >
              {topics.map((topic, index) => {
                const angle = (index + 0.5) * (360 / topics.length);
                return (
                  <span
                    className="template-game__wheel-label"
                    key={topic.id}
                    style={{
                      '--topic-angle': `${angle}deg`,
                      '--topic-label-rotation': `${-angle - wheelRotation}deg`,
                    } as CSSProperties}
                  >
                    <span>{topic.label}</span>
                  </span>
                );
              })}
              <span className="template-game__wheel-hub" aria-hidden="true">✦</span>
            </div>
          </div>
          <button
            className="template-game__primary template-game__spin-button"
            type="button"
            disabled={wheelSpinning}
            onClick={spinWheel}
          >
            {wheelSpinning ? '正在选题……' : selectedTopic ? '再转一次' : '转动话题转盘'}
          </button>

          <div className="template-game__topic-result" aria-live="polite" aria-busy={wheelSpinning}>
            {selectedTopic && selectedFollowUp ? (
              <>
                <p className="template-game__eyebrow">这次聊「{selectedTopic.label}」</p>
                <h3 data-stage-heading tabIndex={-1}>{selectedFollowUp}</h3>
                <div className="template-game__actions">
                  {selectedTopic.followUps.length > 1 && (
                    <button
                      className="template-game__secondary"
                      type="button"
                      onClick={showNextFollowUp}
                    >
                      换一个追问
                    </button>
                  )}
                  {onSendToChat && (
                    <button className="template-game__primary" type="button" onClick={() => onSendToChat(selectedFollowUp)}>
                      放进输入框，我再改改
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="template-game__eyebrow">转盘已就位</p>
                <h3>按下按钮，让这次对话多走一层</h3>
                <p>每个主题都配有低压力追问，不需要“标准答案”。</p>
              </>
            )}
          </div>
        </div>
      )}

      {template === 'rapid-choice' && (
        <div className="template-game__body" ref={rapidBodyRef}>
          {twoPhase === 'ready' && localViewer !== twoActivePlayer ? (
            <PrivateTurnGate
              activeName={players[twoActivePlayer].nickname}
              onSwitch={() => changeViewer(twoActivePlayer)}
            />
          ) : twoPhase === 'ready' ? (
            <div className="template-game__handoff" aria-live="polite">
              <span className="template-game__big-icon" aria-hidden="true">⚡</span>
              <p className="template-game__eyebrow">五秒直觉挑战</p>
              <h3>{players[twoActivePlayer].nickname}，准备好了吗？</h3>
              <p>点击后才会出现第一题；接下来每题都有 5 秒，答案会一直保密到双方完成。</p>
              <button className="template-game__primary" type="button" onClick={() => setTwoPhase('answering')}>
                我准备好了，开始
              </button>
            </div>
          ) : twoPhase === 'answering' && localViewer !== twoActivePlayer ? (
            <PrivateTurnGate
              activeName={players[twoActivePlayer].nickname}
              onSwitch={() => changeViewer(twoActivePlayer)}
            />
          ) : twoPhase === 'answering' ? (
            <div className="template-game__stage">
              <div className="template-game__round-row">
                <TurnBanner name={players[twoActivePlayer].nickname} detail="凭直觉私密作答" />
                <div
                  className={`template-game__timer ${secondsLeft <= 2 ? 'is-urgent' : ''}`}
                  role="timer"
                  aria-label={`还剩 ${secondsLeft} 秒`}
                >
                  <svg viewBox="0 0 40 40" aria-hidden="true">
                    <circle className="template-game__timer-track" cx="20" cy="20" r="16" pathLength="100" />
                    <circle
                      className="template-game__timer-value"
                      cx="20"
                      cy="20"
                      r="16"
                      pathLength="100"
                      style={{ strokeDashoffset: 100 - secondsLeft * 20 }}
                    />
                  </svg>
                  <strong>{secondsLeft}</strong>
                </div>
              </div>
              <div
                className="template-game__progress"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={questions.length}
                aria-valuenow={twoRoundIndex + 1}
                style={{ gridTemplateColumns: `repeat(${questions.length}, minmax(0, 1fr))` }}
                aria-label={`第 ${twoRoundIndex + 1} 题，共 ${questions.length} 题`}
              >
                {questions.map((question, index) => (
                  <span key={question.id} className={index <= twoRoundIndex ? 'is-active' : ''} />
                ))}
              </div>
              <p className="template-game__question-count">第 {twoRoundIndex + 1}/{questions.length} 题</p>
              <h3 className="template-game__question" id={`rapid-question-${questions[twoRoundIndex].id}`} tabIndex={-1}>{questions[twoRoundIndex].prompt}</h3>
              <div className="template-game__duel" role="group" aria-labelledby={`rapid-question-${questions[twoRoundIndex].id}`} aria-busy={twoTransitioning}>
                <button className={twoPendingAnswer === 0 ? 'is-selected' : ''} type="button" disabled={twoTransitioning} aria-describedby={`rapid-question-${questions[twoRoundIndex].id}`} onClick={() => commitTwoChoice(0)}>
                  <span>A</span>
                  <strong>{questions[twoRoundIndex].optionA}</strong>
                </button>
                <span className="template-game__versus" aria-hidden="true">VS</span>
                <button className={twoPendingAnswer === 1 ? 'is-selected' : ''} type="button" disabled={twoTransitioning} aria-describedby={`rapid-question-${questions[twoRoundIndex].id}`} onClick={() => commitTwoChoice(1)}>
                  <span>B</span>
                  <strong>{questions[twoRoundIndex].optionB}</strong>
                </button>
              </div>
              <p className="template-game__hint" aria-live="polite">
                {twoTransitioning
                  ? twoPendingAnswer === 'timeout'
                    ? '本题已超时，正在进入下一题…'
                    : `已选 ${twoPendingAnswer === 0 ? 'A' : 'B'}，正在进入下一题…`
                  : '5 秒后未选会自动跳过，对方作答前不会看到你的答案。'}
              </p>
            </div>
          ) : twoPhase === 'handoff' ? (
            <div className="template-game__handoff" aria-live="polite">
              <span className="template-game__big-icon" aria-hidden="true">✋</span>
              <p className="template-game__eyebrow">{players[twoFirstPlayer].nickname} 已完成</p>
              <h3>接下来由 {players[OTHER_PLAYER[twoFirstPlayer]].nickname} 作答</h3>
              <p>答案已经收好，只有两人都完成后才会一起揭晓。</p>
              <button className="template-game__primary" type="button" onClick={handoffTwoChoice}>
                切换到 {players[OTHER_PLAYER[twoFirstPlayer]].nickname}
              </button>
            </div>
          ) : twoPhase === 'reveal-ready' ? (
            <div className="template-game__handoff" aria-live="polite">
              <span className="template-game__big-icon" aria-hidden="true">🤝</span>
              <p className="template-game__eyebrow">双方选择都已保密保存</p>
              <h3>把手机放在你们中间</h3>
              <p>下一步会同时显示所有答案。确认两个人都在看，再一起揭晓。</p>
              <button className="template-game__primary" type="button" onClick={revealTwoChoice}>
                我们准备好了，一起揭晓
              </button>
            </div>
          ) : (
            <div className="template-game__reveal" aria-live="polite">
              <span className="template-game__big-icon" aria-hidden="true">🃏</span>
              <p className="template-game__eyebrow">选择已全部揭晓</p>
              <h3 data-stage-heading tabIndex={-1}>一样是默契，不一样是话题</h3>
              <div className="template-game__comparison-list">
                {questions.map((question, index) => {
                  const answerA = twoAnswers.a[index];
                  const answerB = twoAnswers.b[index];
                  const labelFor = (answer: TwoChoiceAnswer | undefined) => (
                    answer === 0 ? `A·${question.optionA}` : answer === 1 ? `B·${question.optionB}` : '超时未选'
                  );
                  const timedOutA = answerA === 'timeout' || answerA === undefined;
                  const timedOutB = answerB === 'timeout' || answerB === undefined;
                  const same = !timedOutA && !timedOutB && answerA === answerB;
                  const discussion = timedOutA && timedOutB
                    ? '这一题你们都没来得及选。可以先聊聊各自看到题目时的第一反应。'
                    : timedOutA || timedOutB
                      ? `${timedOutA ? players.a.nickname : players.b.nickname} 刚刚没来得及选，${timedOutA ? players.b.nickname : players.a.nickname} 选了「${labelFor(timedOutA ? answerB : answerA)}」。也可以从彼此的第一反应聊起。`
                      : same
                        ? `你们都选了「${labelFor(answerA)}」。${question.matchedDiscussionPrompt}`
                        : `${players.a.nickname} 选「${labelFor(answerA)}」，${players.b.nickname} 选「${labelFor(answerB)}」。${question.differentDiscussionPrompt}`;
                  return (
                    <article className="template-game__comparison" key={question.id}>
                      <span className="template-game__comparison-index">{index + 1}</span>
                      <div>
                        <h4>{question.prompt}</h4>
                        <div className="template-game__answer-pills">
                          <span>{players.a.nickname}：{labelFor(answerA)}</span>
                          <span>{players.b.nickname}：{labelFor(answerB)}</span>
                        </div>
                        <p>{discussion}</p>
                        {onSendToChat && (
                          <button className="template-game__text-button" type="button" onClick={() => onSendToChat(discussion)}>
                            把这个话题放进输入框
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              <button className="template-game__primary" type="button" onClick={restartTwoChoice}>
                再玩一局
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TurnBanner({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="template-game__turn-banner">
      <span className="template-game__avatar" aria-hidden="true">{name.trim().slice(0, 1) || '你'}</span>
      <span><strong>{name}</strong>{detail}</span>
      <em>保密中</em>
    </div>
  );
}

function PrivateTurnGate({ activeName, onSwitch }: { activeName: string; onSwitch: () => void }) {
  return (
    <div className="template-game__handoff">
      <span className="template-game__big-icon" aria-hidden="true">👀</span>
      <p className="template-game__eyebrow">私密作答阶段</p>
      <h3>现在轮到 {activeName}</h3>
      <p>切换视角后才能继续，未揭晓的选择不会被另一方看到。</p>
      <button className="template-game__primary" type="button" onClick={onSwitch}>
        切换到 {activeName}
      </button>
    </div>
  );
}
