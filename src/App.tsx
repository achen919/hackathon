import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Avatar } from './components/Avatar';
import { CasePromptGameDialog } from './components/CasePromptGameDialog';
import { GamePromptStudio } from './components/GamePromptStudio';
import { ProfileExplorer } from './components/ProfileExplorer';
import { RollingGameTitle } from './components/RollingGameTitle';
import { TemplateGameDialog } from './components/TemplateGameDialog';
import type { TemplateGameResult } from './components/TemplateGameStage';
import { normalizeCarnivalExclusiveGame } from './carnival-api';
import type { CarnivalExclusiveGameDefinition, CarnivalGamePreview } from './carnival-types';
import { demoMatch } from './data/demoMatch';
import { buildLocalPromptPreview, DEFAULT_GAME_TYPES } from './game/catalog';
import { buildDemoPromptGame } from './game/demo-prompt-game';
import { buildFallbackGame, isGameDefinition } from './game/questions';
import {
  genderLabel,
  getUser,
  otherParticipant,
  perspectiveLabel,
  toneFor,
} from './lib/participants';
import type {
  AiGameResponse,
  AiGameStatus,
  GamePromptPreview,
  GameTemplateId,
  GameTypeOption,
  MatchMessage,
  MatchPayload,
  ParticipantId,
} from './types';

const fallbackMessage = '接口未配置，当前展示本地比赛样例';

function formatTime(value: string) {
  const time = value.split(' ')[1];
  return time || value;
}

function recentProfileLine(profile: string) {
  return profile.replace(/^#+\s*/gm, '').replace(/\n+/g, ' ').trim();
}

function isTemplateId(value: unknown): value is GameTemplateId {
  return ['profile-riddle', 'keyword-wheel', 'rapid-choice', 'custom'].includes(String(value));
}

function safeGameTypes(value: unknown): GameTypeOption[] {
  if (!Array.isArray(value)) return DEFAULT_GAME_TYPES;
  const options = value.filter((item): item is GameTypeOption => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Partial<GameTypeOption>;
    return isTemplateId(candidate.id) && candidate.templateId === candidate.id &&
      typeof candidate.label === 'string' && candidate.label.trim().length >= 2 &&
      typeof candidate.enabled === 'boolean' && typeof candidate.available === 'boolean' &&
      typeof candidate.description === 'string';
  });
  return options.some((option) => option.enabled) ? options : DEFAULT_GAME_TYPES;
}

function sessionSummary(result: TemplateGameResult) {
  if (result.type === 'profile-riddle') return '双方眼中的三个关键词已经一起揭晓';
  if (result.type === 'keyword-wheel') return `转盘抽到了「${result.topic.label}」，可以顺着这个关键词继续聊`;
  const same = result.questions.filter((_, index) => (
    result.answers.a[index] !== 'timeout' && result.answers.a[index] === result.answers.b[index]
  )).length;
  return `双方答案已揭晓 · ${same} 题同选，${result.questions.length - same} 个新发现`;
}

function templateSteps(templateId: GameTemplateId, questionLabels: string[]) {
  if (templateId === 'profile-riddle') return ['选择三个关键词', '交换聊天视角', '一起揭晓印象'];
  if (templateId === 'keyword-wheel') return ['转动关键词转盘', '抽中一条追问', '把话题带回聊天'];
  if (templateId === 'rapid-choice') return questionLabels.length > 0 ? questionLabels : ['五秒凭直觉选择', '交换视角作答', '一起查看答案'];
  return questionLabels.length > 0 ? questionLabels : ['修改专属 Prompt', '试玩三种交互', '收下续聊话题'];
}

function customGameShell(match: MatchPayload, game: CarnivalExclusiveGameDefinition) {
  const shell = buildFallbackGame(match, 'custom', '专属小游戏');
  const topics = [...new Set(game.questions.map((question) => question.label))].slice(0, 3);
  return {
    ...shell,
    title: game.title,
    description: game.description,
    topics: topics.length >= 2 ? topics : ['Prompt 生成', '可玩交互', '轻松破冰'],
    questions: game.questions.map((question) => ({
      id: question.id,
      label: question.label,
      source: question.source,
      prompt: question.prompt,
      options: question.options,
      matchedFollowUp: question.matchedFollowUp ?? '你们选到了同一个方向，为什么它更像你？',
      differentFollowUp: question.differentFollowUp ?? '你们选了不同方向，各自最看重的是什么？',
    })),
    generatedBy: game.generatedBy,
    generatedAt: new Date().toISOString(),
  };
}

export default function App() {
  const [match, setMatch] = useState<MatchPayload>(demoMatch);
  const [messages, setMessages] = useState<MatchMessage[]>(demoMatch.messages);
  const [dataSource, setDataSource] = useState<'loading' | 'live' | 'demo'>('demo');
  const [sourceMessage, setSourceMessage] = useState('稳定演示样例 · 可从接口随机抽取');
  const [gameContextId, setGameContextId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ParticipantId>('a');
  const [drafts, setDrafts] = useState<Record<ParticipantId, string>>({ a: '', b: '' });
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [casePromptOpen, setCasePromptOpen] = useState(false);
  const [casePromptPreview, setCasePromptPreview] = useState<CarnivalGamePreview | null>(null);
  const [promptStudioOpen, setPromptStudioOpen] = useState(false);
  const [gameTypes, setGameTypes] = useState<GameTypeOption[]>(DEFAULT_GAME_TYPES);
  const [selectedTemplateId, setSelectedTemplateId] = useState<GameTemplateId>('profile-riddle');
  const [rollingLocked, setRollingLocked] = useState(false);
  const [activeGame, setActiveGame] = useState(() => buildFallbackGame(demoMatch, 'profile-riddle'));
  const [aiStatus, setAiStatus] = useState<AiGameStatus | null>(null);
  const [gameGeneration, setGameGeneration] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');
  const [promptStatus, setPromptStatus] = useState<'idle' | 'loading' | 'editing' | 'generating' | 'error'>('idle');
  const [promptText, setPromptText] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'playing' | 'complete'>('idle');
  const [completedSummary, setCompletedSummary] = useState('');
  const [sessionKey, setSessionKey] = useState('initial');
  const timelineRef = useRef<HTMLElement>(null);
  const generationVersionRef = useRef(0);
  const promptVersionRef = useRef(0);

  const visibleGameTypes = useMemo(() => {
    const visible = gameTypes.filter((option) => option.enabled);
    return visible.length > 0 ? visible : DEFAULT_GAME_TYPES;
  }, [gameTypes]);
  const selectedOption = visibleGameTypes.find((option) => option.id === selectedTemplateId) ?? visibleGameTypes[0];
  const peer = otherParticipant(viewer);
  const currentUser = getUser(match, viewer);
  const otherUser = getUser(match, peer);
  const composer = drafts[viewer];
  const recentConversation = messages.slice(-10).map((message) => message.content).join(' ');
  const closureSignals = ['到这里', '感恩相遇', '各自祝福', '不合适', '不太合适', '不适合继续', '不再继续推进', '不在这个软件上绑定', '解除匹配', '祝你一切顺利'];
  const gameEligible = !closureSignals.some((signal) => recentConversation.includes(signal));
  const displayGame = sessionStatus === 'idle'
    ? buildFallbackGame({ ...match, messages, message_count: messages.length }, selectedOption.id, selectedOption.label)
    : activeGame;
  const steps = templateSteps(displayGame.templateId, displayGame.questions.map((question) => question.label));

  useEffect(() => {
    let active = true;
    void fetch('/api/games/status', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load AI status');
        return (await response.json()) as Partial<AiGameStatus>;
      })
      .then((status) => {
        if (!active) return;
        const options = safeGameTypes(status.gameTypes);
        setGameTypes(options);
        setSelectedTemplateId((current) => options.some((option) => option.enabled && option.id === current) ? current : options.find((option) => option.enabled)?.id ?? 'profile-riddle');
        setAiStatus({ configured: status.configured === true, model: typeof status.model === 'string' ? status.model : null, gameTypes: options });
      })
      .catch(() => { if (active) setAiStatus(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (timeline) timeline.scrollTop = timeline.scrollHeight;
  }, [messages.length, sessionStatus]);

  useEffect(() => {
    const modalOpen = gameOpen || profilesOpen || promptStudioOpen || casePromptOpen;
    document.body.classList.toggle('is-modal-open', modalOpen);
    return () => document.body.classList.remove('is-modal-open');
  }, [casePromptOpen, gameOpen, profilesOpen, promptStudioOpen]);

  function resetSession(nextMatch: MatchPayload, templateId: GameTemplateId = selectedTemplateId) {
    const option = gameTypes.find((item) => item.id === templateId) ?? DEFAULT_GAME_TYPES.find((item) => item.id === templateId);
    setActiveGame(buildFallbackGame(nextMatch, templateId, option?.label));
    setGameGeneration('idle');
    setSessionStatus('idle');
    setCompletedSummary('');
    setGameOpen(false);
    setCasePromptOpen(false);
    setCasePromptPreview(null);
    setPromptStudioOpen(false);
    setPromptStatus('idle');
    setPromptText('');
    setPromptError(null);
    setRollingLocked(false);
  }

  async function loadMatch() {
    generationVersionRef.current += 1;
    promptVersionRef.current += 1;
    setDataSource('loading');
    setSourceMessage('正在随机载入一对比赛案例…');
    try {
      const response = await fetch('/api/match', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextGameContextId = response.headers.get('x-game-context-id');
      if (!nextGameContextId) throw new Error('Missing game context');
      const payload = (await response.json()) as MatchPayload;
      if (!payload.user_a || !payload.user_b || !Array.isArray(payload.messages)) throw new Error('Unexpected payload');
      setMatch(payload);
      setMessages(payload.messages);
      setGameContextId(nextGameContextId);
      setDataSource('live');
      setSourceMessage(`已缓存案例 ${payload.match_id.slice(-8)}`);
      setViewer('a');
      setDrafts({ a: '', b: '' });
      setProfilesOpen(false);
      resetSession(payload);
    } catch {
      setMatch(demoMatch);
      setMessages(demoMatch.messages);
      setGameContextId(null);
      setDataSource('demo');
      setSourceMessage(fallbackMessage);
      setViewer('a');
      setDrafts({ a: '', b: '' });
      setProfilesOpen(false);
      resetSession(demoMatch);
      setGameGeneration('fallback');
    }
  }

  function restoreDemo() {
    generationVersionRef.current += 1;
    promptVersionRef.current += 1;
    setMatch(demoMatch);
    setMessages(demoMatch.messages);
    setGameContextId(null);
    setDataSource('demo');
    setSourceMessage('稳定演示样例 · 可从接口随机抽取');
    setViewer('a');
    setDrafts({ a: '', b: '' });
    setProfilesOpen(false);
    resetSession(demoMatch);
  }

  function selectRollingTemplate(templateId: GameTemplateId) {
    setSelectedTemplateId(templateId);
    if (sessionStatus !== 'playing') {
      const option = visibleGameTypes.find((item) => item.id === templateId);
      setActiveGame(buildFallbackGame({ ...match, messages, message_count: messages.length }, templateId, option?.label));
      setSessionStatus('idle');
      setCompletedSummary('');
    }
  }

  function chooseTemplate(templateId: GameTemplateId) {
    setRollingLocked(true);
    selectRollingTemplate(templateId);
  }

  async function loadPrompt(templateId: GameTemplateId) {
    const option = visibleGameTypes.find((item) => item.id === templateId) ?? selectedOption;
    const local = buildLocalPromptPreview({ ...match, messages, message_count: messages.length }, option);
    const runVersion = ++promptVersionRef.current;
    setSelectedTemplateId(templateId);
    setPromptError(null);
    if (!option.available || !gameContextId) {
      setPromptText(local.prompt);
      setPromptStatus('editing');
      return;
    }
    setPromptStatus('loading');
    setPromptText('');
    try {
      const response = await fetch('/api/games/prompt', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contextId: gameContextId,
          templateId,
          ...(templateId === 'custom' ? { seriesId: 'prompt-arcade' } : {}),
        }),
      });
      const payload = (await response.json()) as Partial<GamePromptPreview> & { code?: string };
      if (!response.ok || payload.templateId !== templateId || typeof payload.prompt !== 'string') throw new Error(payload.code ?? `HTTP ${response.status}`);
      if (runVersion !== promptVersionRef.current) return;
      setPromptText(payload.prompt);
      setPromptStatus('editing');
    } catch {
      if (runVersion !== promptVersionRef.current) return;
      setPromptText(local.prompt);
      setPromptStatus('editing');
      setPromptError('在线 Prompt 暂时不可用，已准备好本地安全简报，仍可修改并开始。');
    }
  }

  function openPromptStudio(templateId: GameTemplateId = selectedTemplateId) {
    if (!gameEligible) return;
    setGameOpen(false);
    setCasePromptOpen(false);
    setPromptStudioOpen(true);
    void loadPrompt(templateId);
  }

  function launchGame(game: ReturnType<typeof buildFallbackGame>, mode: 'ready' | 'fallback', notice: string) {
    setActiveGame(game);
    setGameGeneration(mode);
    setSessionStatus('playing');
    setCompletedSummary('');
    setSessionKey(`${game.matchId}-${game.templateId}-${Date.now()}`);
    setPromptStudioOpen(false);
    setPromptStatus('editing');
    setGameOpen(true);
  }

  function launchCasePromptGame(
    game: CarnivalExclusiveGameDefinition,
    mode: 'ready' | 'fallback',
    notice: string,
  ) {
    const currentMatch = { ...match, messages, message_count: messages.length };
    const previewToken = `case-${match.match_id}-${Date.now()}`;
    setActiveGame(customGameShell(currentMatch, game));
    setCasePromptPreview({
      previewToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      game,
    });
    setGameGeneration(mode);
    setSessionStatus('playing');
    setCompletedSummary('');
    setSessionKey(previewToken);
    setPromptStudioOpen(false);
    setPromptStatus('editing');
    setGameOpen(false);
    setCasePromptOpen(true);
  }

  async function generateAndStart() {
    if (!selectedOption.available || promptText.trim().length < 20 || promptStatus === 'generating') return;
    if (selectedOption.id === 'custom') {
      const currentMatch = { ...match, messages, message_count: messages.length };
      const fallback = buildDemoPromptGame(currentMatch, promptText);
      if (aiStatus?.configured === false || !gameContextId) {
        launchCasePromptGame(
          fallback,
          'fallback',
          aiStatus?.configured === false
            ? 'AI 尚未在管理后台可用，已按你的 Prompt 用安全本地引擎生成三轮可玩游戏。'
            : '当前是本地演示案例，已按你的 Prompt 生成三轮可玩游戏。',
        );
        return;
      }
      const runVersion = ++generationVersionRef.current;
      setPromptStatus('generating');
      setPromptError(null);
      setGameGeneration('loading');
      try {
        const response = await fetch('/api/games/generate', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contextId: gameContextId,
            templateId: 'custom',
            seriesId: 'prompt-arcade',
            prompt: promptText,
            fresh: sessionStatus === 'complete' && activeGame.templateId === 'custom',
          }),
        });
        const payload = (await response.json()) as { game?: unknown; cached?: boolean; code?: string };
        if (!response.ok || !payload.game) throw new Error(payload.code ?? `HTTP ${response.status}`);
        const game = normalizeCarnivalExclusiveGame(payload.game);
        if (runVersion !== generationVersionRef.current) return;
        if (game.generatedBy === 'ai') {
          setAiStatus((current) => ({ configured: true, model: current?.model ?? null, gameTypes: current?.gameTypes ?? gameTypes }));
        }
        launchCasePromptGame(
          game,
          game.generatedBy === 'ai' ? 'ready' : 'fallback',
          game.generatedBy === 'ai'
            ? payload.cached
              ? '已取回这份 Prompt 对应的同一局可玩游戏。'
              : `AI 已生成「${game.title}」，可以直接在案例页试玩。`
            : '在线服务已用安全引擎生成同一套三轮交互。',
        );
      } catch (error) {
        if (runVersion !== generationVersionRef.current) return;
        const code = error instanceof Error ? error.message : '';
        if (code === 'AI_NOT_CONFIGURED') setAiStatus({ configured: false, model: null, gameTypes });
        const notice = code === 'AI_AUTH_FAILED'
          ? 'AI 密钥或模型暂不可用，已按你的 Prompt 切换到安全本地引擎。'
          : code === 'AI_REFRESH_LIMIT'
            ? '本案例智能换题次数已用完，已用安全本地引擎生成。'
            : 'AI 此刻没有及时返回，已按你的 Prompt 生成本地可玩版。';
        launchCasePromptGame(fallback, 'fallback', notice);
      }
      return;
    }
    const fallback = buildFallbackGame({ ...match, messages, message_count: messages.length }, selectedOption.id, selectedOption.label);
    if (aiStatus?.configured === false || !gameContextId) {
      launchGame(fallback, 'fallback', aiStatus?.configured === false ? 'AI 尚未在管理后台配置，本局使用同一交互模板和安全题库。' : '当前是本地演示案例，本局使用同一交互模板和安全题库。');
      return;
    }
    const runVersion = ++generationVersionRef.current;
    setPromptStatus('generating');
    setPromptError(null);
    setGameGeneration('loading');
    try {
      const response = await fetch('/api/games/generate', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contextId: gameContextId,
          templateId: selectedOption.id,
          prompt: promptText,
          fresh: sessionStatus === 'complete' && activeGame.templateId === selectedOption.id,
        }),
      });
      const payload = (await response.json()) as Partial<AiGameResponse> & { code?: string };
      if (!response.ok || !isGameDefinition(payload.game) || payload.game.matchId !== match.match_id || payload.game.templateId !== selectedOption.id) throw new Error(payload.code ?? `HTTP ${response.status}`);
      if (runVersion !== generationVersionRef.current) return;
      setAiStatus((current) => ({ configured: true, model: current?.model ?? null, gameTypes: current?.gameTypes ?? gameTypes }));
      launchGame(payload.game, 'ready', payload.cached ? '已取回同一份 Prompt 生成的专属题面。' : `AI 已生成「${payload.game.gameType}」：${payload.game.whyItFits}`);
    } catch (error) {
      if (runVersion !== generationVersionRef.current) return;
      const code = error instanceof Error ? error.message : '';
      if (code === 'AI_NOT_CONFIGURED') setAiStatus({ configured: false, model: null, gameTypes });
      const notice = code === 'AI_AUTH_FAILED'
        ? 'AI 密钥或模型暂不可用，已自动切换到同一玩法的安全题库。'
        : code === 'AI_REFRESH_LIMIT'
          ? '本案例智能换题次数已用完，已切换到同一玩法的安全题库。'
          : 'AI 此刻没有及时返回，已自动切换到同一玩法的安全题库。';
      launchGame(fallback, 'fallback', notice);
    }
  }

  function startOrResumeGame() {
    if (!gameEligible || gameGeneration === 'loading') return;
    if (sessionStatus === 'playing') {
      if (activeGame.templateId === 'custom' && casePromptPreview) setCasePromptOpen(true);
      else setGameOpen(true);
      return;
    }
    openPromptStudio(selectedOption.id);
  }

  function bringFollowUpToChat(text: string) {
    setDrafts((current) => ({ ...current, [viewer]: text }));
    setGameOpen(false);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('#chat-composer')?.focus(), 80);
  }

  function completeGame(result: TemplateGameResult) {
    setSessionStatus('complete');
    setCompletedSummary(sessionSummary(result));
  }

  function completeCasePromptGame() {
    setSessionStatus('complete');
    setCompletedSummary('三轮 Prompt-to-Game 试玩已完成 · 可以顺着结尾问句继续聊');
  }

  function restartCasePromptGame() {
    setSessionStatus('playing');
    setCompletedSummary('');
  }

  function closePromptStudio() {
    promptVersionRef.current += 1;
    generationVersionRef.current += 1;
    setPromptStudioOpen(false);
    setPromptStatus('idle');
    if (gameGeneration === 'loading') {
      setGameGeneration('idle');
    }
  }

  function sendMessage() {
    const content = composer.trim();
    if (!content) return;
    const now = new Date();
    const sentAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setMessages((current) => [...current, { from: viewer, type: 'text', content, sent_at: sentAt }]);
    setDrafts((current) => ({ ...current, [viewer]: '' }));
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  const firstStepNote: Record<GameTemplateId, string> = {
    'profile-riddle': '双方分别选词，揭晓前彼此不可见',
    'keyword-wheel': '转盘从公开话题中随机抽取一个追问',
    'rapid-choice': '双方分别作答，答案不会提前暴露',
    custom: '在当前接口案例中本地试玩，不进入真实匹配',
  };
  return (
    <div className="app-shell">
      <aside className="brand-rail" aria-label="主导航">
        <div className="brand-mark" aria-label="良配心动局">良</div>
        <nav className="rail-nav">
          <button className="rail-button is-active" type="button" aria-label="聊天">◌</button>
          <button className="rail-button" type="button" aria-label="我也要聊，进入游园会真实匹配" onClick={() => { window.location.href = '/carnival'; }}>♡</button>
          <button className="rail-button" type="button" aria-label="AI 游戏管理后台" onClick={() => { window.location.href = '/admin'; }}>⌾</button>
        </nav>
        <Avatar name={currentUser.nickname} tone={toneFor(viewer)} size="small" />
      </aside>

      <aside className="match-sidebar">
        <div className="sidebar-title-row"><div><span className="eyebrow">一对一匹配中</span><h1>心动会话</h1></div><button className="icon-button" type="button" aria-label="更多选项">•••</button></div>
        <button className="match-list-item is-active" type="button">
          <Avatar name={otherUser.nickname} tone={toneFor(peer)} />
          <span className="match-list-item__copy"><strong>{otherUser.nickname}</strong><small>{messages.at(-1)?.content ?? '刚刚匹配成功'}</small></span>
          <span className="unread-dot" aria-label="有新消息" />
        </button>
        <a className="carnival-entry" href="/carnival">
          <span className="carnival-entry__icon" aria-hidden="true">♡</span>
          <span><strong>我也要聊</strong><small>进入游园会真实匹配</small></span>
          <span aria-hidden="true">→</span>
        </a>
        <div className="sidebar-note"><span className={`source-dot source-dot--${dataSource}`} /><p>{sourceMessage}</p><button type="button" onClick={() => void loadMatch()} disabled={dataSource === 'loading'}>{dataSource === 'loading' ? '载入中' : dataSource === 'demo' ? '从接口抽一对' : '换一对案例'}</button></div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div className="chat-person"><Avatar name={otherUser.nickname} tone={toneFor(peer)} /><div><strong>{otherUser.nickname}</strong><span><i /> 你正以 {currentUser.nickname} 的身份聊天</span></div></div>
          <div className="perspective-switch" role="group" aria-label="切换聊天视角">
            {(['a', 'b'] as ParticipantId[]).map((participant) => <button key={participant} type="button" className={viewer === participant ? 'is-active' : ''} aria-pressed={viewer === participant} onClick={() => setViewer(participant)}><span className={`perspective-switch__dot is-${toneFor(participant)}`} aria-hidden="true" />{perspectiveLabel(match, participant)}</button>)}
          </div>
          <div className="chat-header__actions">
            <button className="secondary-button compact-only" type="button" onClick={startOrResumeGame} disabled={!gameEligible || gameGeneration === 'loading'}>✦ 小游戏</button>
            <a className="carnival-mobile-entry" href="/carnival">我也要聊</a>
            <button className="mobile-match-button" type="button" onClick={() => void loadMatch()} disabled={dataSource === 'loading'} aria-label={dataSource === 'loading' ? '正在载入匹配案例' : '从接口换一对匹配案例'}><span className="mobile-match-button__icon" aria-hidden="true">↻</span><span className="mobile-match-button__label">{dataSource === 'loading' ? '载入中' : '换案例'}</span><span className={`source-dot source-dot--${dataSource}`} aria-hidden="true" /></button>
            <button className="profile-open-button" type="button" onClick={() => setProfilesOpen(true)} aria-label="查看双方完整资料"><span className="profile-open-button__wide">双方资料</span><span className="profile-open-button__compact" aria-hidden="true">资料</span></button>
          </div>
        </header>

        <section className="chat-timeline" aria-label="聊天记录" ref={timelineRef}>
          <div className="timeline-date"><span>完整聊天记录 · 共 {messages.length} 条</span></div>
          {messages.map((message, index) => {
            const sender = getUser(match, message.from);
            const mine = message.from === viewer;
            return <div className={`message-row message-row--${toneFor(message.from)} ${mine ? 'is-mine' : ''}`} key={`${message.sent_at}-${index}`}>{!mine && <Avatar name={sender.nickname} tone={toneFor(message.from)} size="small" />}<div className="message-content"><div className="message-bubble">{message.content || (message.type === 'non_text' ? '非文本消息' : '空消息')}</div><time>{formatTime(message.sent_at)}</time></div></div>;
          })}

          <article className={`game-invite ${sessionStatus !== 'idle' ? 'is-active' : ''} ${!gameEligible ? 'is-ineligible' : ''}`} aria-busy={gameGeneration === 'loading'}>
            <div className="game-invite__glow" aria-hidden="true">✦</div>
            <div className="game-invite__topline"><span className="game-label">上下文双人破冰</span></div>
            {gameEligible ? (sessionStatus === 'playing' || sessionStatus === 'complete' ? <h2>{activeGame.title}</h2> : <RollingGameTitle items={visibleGameTypes} activeId={selectedOption.id} paused={rollingLocked || promptStudioOpen || gameOpen || casePromptOpen} onActiveChange={selectRollingTemplate} />) : <h2>尊重结束，也是一种认真</h2>}
            <p>{gameEligible ? (sessionStatus === 'idle' ? selectedOption.description : activeGame.description) : '最近对话里出现了明确的结束信号。此时不应该用游戏重新施压，系统会安静收起邀请。'}</p>
            {gameEligible && sessionStatus === 'idle' && <div className="game-template-picker" aria-label="选择游戏类型">{visibleGameTypes.map((option) => <button key={option.id} className={`${option.id === selectedOption.id ? 'is-active' : ''} ${!option.available ? 'is-waiting' : ''}`} type="button" aria-pressed={option.id === selectedOption.id} onClick={() => chooseTemplate(option.id)}>{option.label}</button>)}</div>}
            {gameEligible && sessionStatus !== 'idle' && <div className="topic-chips" aria-label="游戏话题">{activeGame.topics.map((topic) => <span key={topic}>{topic}</span>)}</div>}
            <button className="game-invite__button" type="button" onClick={gameEligible ? startOrResumeGame : restoreDemo} disabled={gameGeneration === 'loading'}>{gameEligible ? gameGeneration === 'loading' ? '正在生成…' : sessionStatus === 'playing' ? '继续这一局' : sessionStatus === 'complete' ? '换个 Prompt 再玩' : selectedOption.available ? '一起玩' : '查看接入状态' : '回到适合破冰的演示样例'}<span aria-hidden="true">→</span></button>
          </article>
        </section>

        <footer className="chat-composer">
          <button className="composer-game-button" type="button" onClick={startOrResumeGame} disabled={!gameEligible || gameGeneration === 'loading'}><span aria-hidden="true">✦</span>小游戏</button>
          <textarea id="chat-composer" value={composer} rows={1} placeholder={`${currentUser.nickname} 想说…`} aria-label={`以 ${currentUser.nickname} 身份输入消息`} onChange={(event) => setDrafts((current) => ({ ...current, [viewer]: event.target.value }))} onKeyDown={handleComposerKeyDown} />
          <button className={`send-button send-button--${toneFor(viewer)}`} type="button" onClick={sendMessage} disabled={!composer.trim()}>发送</button>
        </footer>
      </main>

      <aside className="context-panel">
        <section className="pair-profile-preview">
          <div className="section-heading"><div><span className="eyebrow">模拟匹配资料</span><h2>双方资料</h2></div><span className="pair-badge">A × B</span></div>
          <div className="pair-profile-preview__list">
            {(['a', 'b'] as ParticipantId[]).map((participant) => {
              const user = getUser(match, participant);
              const active = viewer === participant;
              return <button key={participant} type="button" className={`pair-profile-card pair-profile-card--${toneFor(participant)} ${active ? 'is-viewer' : ''}`} onClick={() => setViewer(participant)} aria-pressed={active}><span className="pair-profile-card__top"><Avatar name={user.nickname} tone={toneFor(participant)} size="small" /><span><strong>{user.nickname}</strong><small>{genderLabel(user, participant)} · 用户 {participant.toUpperCase()}</small></span><em>{active ? '当前视角' : '切换'}</em></span><span className="pair-profile-card__summary">{recentProfileLine(user.profile).slice(0, 54)}…</span><span className="pair-profile-card__counts"><span>自我记忆 {user.memories_self.length}</span><span>择偶偏好 {user.memories_ideal.length}</span></span></button>;
            })}
          </div>
          <button className="open-profile-explorer" type="button" onClick={() => setProfilesOpen(true)}>查看双方完整资料 <span aria-hidden="true">→</span></button>
        </section>

        <section className="round-card">
          <div className="section-heading"><div><span className="eyebrow">{displayGame.templateId === 'custom' ? displayGame.generatedBy === 'ai' ? 'AI 专属游戏' : 'PROMPT 安全引擎' : displayGame.generatedBy === 'ai' ? 'AI 专属题面' : '固定玩法模板'}</span><h2>{displayGame.gameType}</h2></div><span className="round-count">{sessionStatus === 'complete' ? '完成' : sessionStatus === 'playing' ? '进行中' : '待开始'}</span></div>
          <ol className="round-list">{steps.map((step, index) => <li className={sessionStatus === 'complete' ? 'is-done' : sessionStatus === 'playing' && index === 0 ? 'is-current' : ''} key={`${displayGame.templateId}-${step}`}><span>{sessionStatus === 'complete' ? '✓' : index + 1}</span><div><strong>{step}</strong><small>{index === 0 ? firstStepNote[displayGame.templateId] : '玩法内会提示下一步'}</small></div></li>)}</ol>
        </section>

        <section className="safety-note"><span aria-hidden="true">☂</span><div><strong>资料用于理解，题面守住边界</strong><p>Prompt 只展示安全玩法简报；私密偏好不会直接出现在题目里，发送内容仍由本人确认。</p></div></section>
      </aside>

      <GamePromptStudio open={promptStudioOpen} options={visibleGameTypes} selectedId={selectedOption.id} prompt={promptText} status={promptStatus} error={promptError} usesAi={aiStatus?.configured !== false && Boolean(gameContextId)} onSelect={(templateId) => void loadPrompt(templateId)} onPromptChange={(value) => { setPromptText(value); setPromptStatus('editing'); setPromptError(null); }} onStart={() => void generateAndStart()} onClose={closePromptStudio} />
      {casePromptPreview && <CasePromptGameDialog key={sessionKey} open={casePromptOpen} preview={casePromptPreview} onComplete={completeCasePromptGame} onRestart={restartCasePromptGame} onClose={() => setCasePromptOpen(false)} />}
      <TemplateGameDialog open={gameOpen} game={activeGame} match={{ ...match, messages, message_count: messages.length }} viewer={viewer} sessionKey={sessionKey} onViewerChange={setViewer} onFollowUp={bringFollowUpToChat} onComplete={completeGame} onRestart={() => { setSessionStatus('playing'); setCompletedSummary(''); }} onClose={() => setGameOpen(false)} />
      <ProfileExplorer open={profilesOpen} match={match} viewer={viewer} onViewerChange={setViewer} onClose={() => setProfilesOpen(false)} />
    </div>
  );
}
