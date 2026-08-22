import { useEffect, useRef, useState } from 'react';
import { Avatar } from './components/Avatar';
import { IcebreakerGame } from './components/IcebreakerGame';
import { ProfileExplorer } from './components/ProfileExplorer';
import { demoMatch } from './data/demoMatch';
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
  GamePhase,
  MatchMessage,
  MatchPayload,
  ParticipantId,
  RoundResult,
} from './types';

const fallbackMessage = '接口未配置，当前展示本地比赛样例';

function formatTime(value: string) {
  const time = value.split(' ')[1];
  return time || value;
}

function recentProfileLine(profile: string) {
  return profile
    .replace(/^#+\s*/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
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
  const [activeGame, setActiveGame] = useState(() => buildFallbackGame(demoMatch));
  const [aiStatus, setAiStatus] = useState<AiGameStatus | null>(null);
  const [gameGeneration, setGameGeneration] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');
  const [gameNotice, setGameNotice] = useState('从接口抽取案例后，AI 会读取双方完整上下文，为这一对临场出题。');
  const [gamePhase, setGamePhase] = useState<GamePhase>('idle');
  const [gameStarter, setGameStarter] = useState<ParticipantId>('a');
  const [roundIndex, setRoundIndex] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const [guess, setGuess] = useState<number | null>(null);
  const [results, setResults] = useState<RoundResult[]>([]);
  const timelineRef = useRef<HTMLElement>(null);
  const generationVersionRef = useRef(0);

  const questions = activeGame.questions;
  const peer = otherParticipant(viewer);
  const currentUser = getUser(match, viewer);
  const otherUser = getUser(match, peer);
  const composer = drafts[viewer];
  const matchedCount = results.filter((result) => result.answer === result.guess).length;
  const recentConversation = messages.slice(-10).map((message) => message.content).join(' ');
  const closureSignals = [
    '到这里',
    '感恩相遇',
    '各自祝福',
    '不合适',
    '不太合适',
    '不适合继续',
    '不再继续推进',
    '不在这个软件上绑定',
    '解除匹配',
    '祝你一切顺利',
  ];
  const gameEligible = !closureSignals.some((signal) => recentConversation.includes(signal));

  useEffect(() => {
    let active = true;
    void fetch('/api/games/status', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load AI status');
        return (await response.json()) as AiGameStatus;
      })
      .then((status) => {
        if (active) setAiStatus(status);
      })
      .catch(() => {
        if (active) setAiStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadMatch() {
    generationVersionRef.current += 1;
    setDataSource('loading');
    setSourceMessage('正在随机载入一对比赛案例…');

    try {
      const response = await fetch('/api/match', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextGameContextId = response.headers.get('x-game-context-id');
      if (!nextGameContextId) throw new Error('Missing game context');

      const payload = (await response.json()) as MatchPayload;
      if (!payload.user_a || !payload.user_b || !Array.isArray(payload.messages)) {
        throw new Error('Unexpected payload');
      }

      setMatch(payload);
      setMessages(payload.messages);
      setGameContextId(nextGameContextId);
      setActiveGame(buildFallbackGame(payload));
      setGameGeneration('idle');
      setGameNotice('新案例已载入，AI 会根据双方完整上下文重新设计一局。');
      setDataSource('live');
      setSourceMessage(`已缓存案例 ${payload.match_id.slice(-8)}`);
      setViewer('a');
      setDrafts({ a: '', b: '' });
      setProfilesOpen(false);
      resetGame(false);
    } catch {
      setMatch(demoMatch);
      setMessages(demoMatch.messages);
      setGameContextId(null);
      setActiveGame(buildFallbackGame(demoMatch));
      setGameGeneration('fallback');
      setGameNotice('接口暂时不可用，已切换到稳定演示题卡。');
      setDataSource('demo');
      setSourceMessage(fallbackMessage);
      setViewer('a');
      setDrafts({ a: '', b: '' });
      setProfilesOpen(false);
      resetGame(false);
    }
  }

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    timeline.scrollTop = timeline.scrollHeight;
  }, [messages.length, gamePhase]);

  useEffect(() => {
    const modalOpen = gameOpen || profilesOpen;
    document.body.classList.toggle('is-modal-open', modalOpen);

    return () => document.body.classList.remove('is-modal-open');
  }, [gameOpen, profilesOpen]);

  function resetGame(open = true) {
    if (open) setGameStarter(viewer);
    setRoundIndex(0);
    setAnswer(null);
    setGuess(null);
    setResults([]);
    setGamePhase(open ? 'answering' : 'idle');
    setGameOpen(open);
  }

  function restoreDemo() {
    generationVersionRef.current += 1;
    setMatch(demoMatch);
    setMessages(demoMatch.messages);
    setGameContextId(null);
    setActiveGame(buildFallbackGame(demoMatch));
    setGameGeneration('idle');
    setGameNotice('从接口抽取案例后，AI 会读取双方完整上下文，为这一对临场出题。');
    setDataSource('demo');
    setSourceMessage('稳定演示样例 · 可从接口随机抽取');
    setViewer('a');
    setDrafts({ a: '', b: '' });
    setProfilesOpen(false);
    resetGame(false);
  }

  async function generateAndStart(fresh = false) {
    if (!gameEligible || gameGeneration === 'loading') return;
    if (aiStatus?.configured === false || !gameContextId) {
      const fallback = buildFallbackGame({ ...match, messages, message_count: messages.length });
      setActiveGame(fallback);
      setGameGeneration('fallback');
      setGameNotice(
        aiStatus?.configured === false
          ? 'AI 尚未在管理后台配置，先用安全题卡继续演示；配置后即可生成专属类型。'
          : '当前是本地演示案例；从接口抽取真实案例后，即可生成专属游戏。',
      );
      resetGame(true);
      return;
    }
    const runVersion = ++generationVersionRef.current;
    setGameGeneration('loading');
    setGameNotice('AI 正在理解双方资料、偏好与完整聊天，设计一局只属于你们的游戏…');

    try {
      const response = await fetch('/api/games/generate', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: gameContextId, fresh }),
      });
      const payload = (await response.json()) as Partial<AiGameResponse> & { code?: string };
      if (!response.ok || !isGameDefinition(payload.game) || payload.game.matchId !== match.match_id) {
        throw new Error(payload.code ?? `HTTP ${response.status}`);
      }
      if (runVersion !== generationVersionRef.current) return;
      setActiveGame(payload.game);
      setAiStatus((current) => ({ configured: true, model: current?.model ?? null }));
      setGameGeneration('ready');
      setGameNotice(payload.cached ? '已取回这对用户刚刚生成的专属游戏。' : `AI 选择了「${payload.game.gameType}」：${payload.game.whyItFits}`);
      resetGame(true);
    } catch (error) {
      if (runVersion !== generationVersionRef.current) return;
      const fallback = buildFallbackGame({ ...match, messages, message_count: messages.length });
      setActiveGame(fallback);
      setGameGeneration('fallback');
      const code = error instanceof Error ? error.message : '';
      if (code === 'AI_NOT_CONFIGURED') {
        setAiStatus({ configured: false, model: null });
        setGameNotice('AI 尚未在管理后台配置，先用安全题卡继续演示；配置后即可生成专属类型。');
      } else if (code === 'AI_REFRESH_LIMIT') {
        setGameGeneration('ready');
        setGameNotice('这对用户的两次智能换题机会已用完，已保留当前专属游戏，可重新玩这一局。');
        resetGame(true);
        return;
      } else if (code === 'AI_AUTH_FAILED') {
        setGameNotice('AI 密钥或模型暂不可用，已自动切换到安全题卡。请在管理后台检查配置。');
      } else {
        setGameNotice('AI 此刻没有及时返回，已自动切换到安全题卡，游戏仍可正常进行。');
      }
      resetGame(true);
    }
  }

  function startOrResumeGame() {
    if (!gameEligible) return;
    if (gamePhase === 'idle' || gamePhase === 'complete') {
      void generateAndStart(gamePhase === 'complete');
      return;
    }
    setGameOpen(true);
  }

  function lockAnswer() {
    if (answer === null) return;
    setGamePhase('handoff');
  }

  function revealRound() {
    if (answer === null || guess === null) return;
    const protagonist = roundIndex % 2 === 0 ? gameStarter : otherParticipant(gameStarter);
    setResults((current) => [
      ...current,
      { question: questions[roundIndex], protagonist, answer, guess },
    ]);
    setGamePhase('revealed');
  }

  function nextRound() {
    if (roundIndex >= questions.length - 1) {
      setGamePhase('complete');
      return;
    }
    setRoundIndex((current) => current + 1);
    setAnswer(null);
    setGuess(null);
    setGamePhase('answering');
  }

  function bringFollowUpToChat(text: string) {
    setDrafts((current) => ({ ...current, [viewer]: text }));
    setGameOpen(false);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('#chat-composer')?.focus(), 80);
  }

  function sendMessage() {
    const content = composer.trim();
    if (!content) return;

    const now = new Date();
    const sentAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    setMessages((current) => [
      ...current,
      { from: viewer, type: 'text', content, sent_at: sentAt },
    ]);
    setDrafts((current) => ({ ...current, [viewer]: '' }));
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  const gameCardStatus = (() => {
    if (gameGeneration === 'loading') return 'AI 正在临场出题…';
    if (gamePhase === 'complete') return `完成 · ${matchedCount} 次同频，${results.length - matchedCount} 个新发现`;
    if (gamePhase === 'idle') return `${questions.length} 个小问题 · 约 ${activeGame.estimatedMinutes} 分钟`;
    if (gamePhase === 'revealed') return `第 ${roundIndex + 1} 轮已揭晓`;
    return `进行中 · 第 ${roundIndex + 1}/${questions.length} 轮`;
  })();

  function changeViewer(participant: ParticipantId) {
    setViewer(participant);
  }

  return (
    <div className="app-shell">
      <aside className="brand-rail" aria-label="主导航">
        <div className="brand-mark" aria-label="良配心动局">良</div>
        <nav className="rail-nav">
          <button className="rail-button is-active" type="button" aria-label="聊天">◌</button>
          <button className="rail-button" type="button" aria-label="匹配">♡</button>
          <button className="rail-button" type="button" aria-label="AI 游戏管理后台" onClick={() => { window.location.href = '/admin'; }}>⌾</button>
        </nav>
        <Avatar name={currentUser.nickname} tone={toneFor(viewer)} size="small" />
      </aside>

      <aside className="match-sidebar">
        <div className="sidebar-title-row">
          <div>
            <span className="eyebrow">一对一匹配中</span>
            <h1>心动会话</h1>
          </div>
          <button className="icon-button" type="button" aria-label="更多选项">•••</button>
        </div>

        <button className="match-list-item is-active" type="button">
          <Avatar name={otherUser.nickname} tone={toneFor(peer)} />
          <span className="match-list-item__copy">
            <strong>{otherUser.nickname}</strong>
            <small>{messages.at(-1)?.content ?? '刚刚匹配成功'}</small>
          </span>
          <span className="unread-dot" aria-label="有新消息" />
        </button>

        <div className="sidebar-note">
          <span className={`source-dot source-dot--${dataSource}`} />
          <p>{sourceMessage}</p>
          <button type="button" onClick={() => void loadMatch()} disabled={dataSource === 'loading'}>
            {dataSource === 'loading' ? '载入中' : dataSource === 'demo' ? '从接口抽一对' : '换一对案例'}
          </button>
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div className="chat-person">
            <Avatar name={otherUser.nickname} tone={toneFor(peer)} />
            <div>
              <strong>{otherUser.nickname}</strong>
              <span><i /> 你正以 {currentUser.nickname} 的身份聊天</span>
            </div>
          </div>
          <div className="perspective-switch" role="group" aria-label="切换聊天视角">
            {(['a', 'b'] as ParticipantId[]).map((participant) => (
              <button
                key={participant}
                type="button"
                className={viewer === participant ? 'is-active' : ''}
                aria-pressed={viewer === participant}
                onClick={() => changeViewer(participant)}
              >
                <span className={`perspective-switch__dot is-${toneFor(participant)}`} aria-hidden="true" />
                {perspectiveLabel(match, participant)}
              </button>
            ))}
          </div>
          <div className="chat-header__actions">
            <button className="secondary-button compact-only" type="button" onClick={startOrResumeGame} disabled={!gameEligible || gameGeneration === 'loading'}>
              ✦ 小游戏
            </button>
            <button
              className="mobile-match-button"
              type="button"
              onClick={() => void loadMatch()}
              disabled={dataSource === 'loading'}
              aria-label={dataSource === 'loading' ? '正在载入匹配案例' : '从接口换一对匹配案例'}
            >
              <span className="mobile-match-button__icon" aria-hidden="true">↻</span>
              <span className="mobile-match-button__label">{dataSource === 'loading' ? '载入中' : '换案例'}</span>
              <span className={`source-dot source-dot--${dataSource}`} aria-hidden="true" />
            </button>
            <button
              className="profile-open-button"
              type="button"
              onClick={() => setProfilesOpen(true)}
              aria-label="查看双方完整资料"
            >
              <span className="profile-open-button__wide">双方资料</span>
              <span className="profile-open-button__compact" aria-hidden="true">资料</span>
            </button>
          </div>
        </header>

        <section className="chat-timeline" aria-label="聊天记录" ref={timelineRef}>
          <div className="timeline-date"><span>完整聊天记录 · 共 {messages.length} 条</span></div>

          {messages.map((message, index) => {
            const sender = getUser(match, message.from);
            const mine = message.from === viewer;
            return (
              <div
                className={`message-row message-row--${toneFor(message.from)} ${mine ? 'is-mine' : ''}`}
                key={`${message.sent_at}-${index}`}
              >
                {!mine && <Avatar name={sender.nickname} tone={toneFor(message.from)} size="small" />}
                <div className="message-content">
                  <div className="message-bubble">
                    {message.content || (message.type === 'non_text' ? '非文本消息' : '空消息')}
                  </div>
                  <time>{formatTime(message.sent_at)}</time>
                </div>
              </div>
            );
          })}

          <article className={`game-invite ${gamePhase !== 'idle' ? 'is-active' : ''} ${!gameEligible ? 'is-ineligible' : ''}`} aria-busy={gameGeneration === 'loading'}>
            <div className="game-invite__glow" aria-hidden="true">✦</div>
            <div className="game-invite__topline">
              <span className="game-label">{activeGame.generatedBy === 'ai' ? 'AI 专属小局' : '破冰小局'}</span>
              <span>{gameEligible ? gameCardStatus : '此刻不推荐发起'}</span>
            </div>
            <h2>{gameEligible ? activeGame.title : '尊重结束，也是一种认真'}</h2>
            <p>
              {gameEligible
                ? activeGame.description
                : '最近对话里出现了明确的结束信号。此时不应该用游戏重新施压，系统会安静收起邀请。'}
            </p>
            {gameEligible && (
              <div className="topic-chips" aria-label="游戏话题">
                {activeGame.topics.map((topic) => <span key={topic}>{topic}</span>)}
              </div>
            )}
            {gameEligible && <p className={`game-ai-note is-${gameGeneration}`} role="status" aria-live="polite">{gameNotice}</p>}
            <button className="game-invite__button" type="button" onClick={gameEligible ? startOrResumeGame : restoreDemo} disabled={gameGeneration === 'loading'}>
              {gameEligible
                ? gameGeneration === 'loading'
                  ? '正在生成…'
                  : gamePhase === 'idle' || gamePhase === 'complete'
                    ? aiStatus?.configured === false || !gameContextId ? '先玩安全题卡' : 'AI 生成专属游戏'
                  : '继续这一局'
                : '回到适合破冰的演示样例'}
              <span aria-hidden="true">→</span>
            </button>
          </article>
        </section>

        <footer className="chat-composer">
          <button className="composer-game-button" type="button" onClick={startOrResumeGame} disabled={!gameEligible || gameGeneration === 'loading'}>
            <span aria-hidden="true">✦</span>
            小游戏
          </button>
          <textarea
            id="chat-composer"
            value={composer}
            rows={1}
            placeholder={`${currentUser.nickname} 想说…`}
            aria-label={`以 ${currentUser.nickname} 身份输入消息`}
            onChange={(event) =>
              setDrafts((current) => ({ ...current, [viewer]: event.target.value }))
            }
            onKeyDown={handleComposerKeyDown}
          />
          <button className={`send-button send-button--${toneFor(viewer)}`} type="button" onClick={sendMessage} disabled={!composer.trim()}>
            发送
          </button>
        </footer>
      </main>

      <aside className="context-panel">
        <section className="pair-profile-preview">
          <div className="section-heading">
            <div>
              <span className="eyebrow">模拟匹配资料</span>
              <h2>双方资料</h2>
            </div>
            <span className="pair-badge">A × B</span>
          </div>
          <div className="pair-profile-preview__list">
            {(['a', 'b'] as ParticipantId[]).map((participant) => {
              const user = getUser(match, participant);
              const active = viewer === participant;
              return (
                <button
                  key={participant}
                  type="button"
                  className={`pair-profile-card pair-profile-card--${toneFor(participant)} ${active ? 'is-viewer' : ''}`}
                  onClick={() => changeViewer(participant)}
                  aria-pressed={active}
                >
                  <span className="pair-profile-card__top">
                    <Avatar name={user.nickname} tone={toneFor(participant)} size="small" />
                    <span>
                      <strong>{user.nickname}</strong>
                      <small>{genderLabel(user, participant)} · 用户 {participant.toUpperCase()}</small>
                    </span>
                    <em>{active ? '当前视角' : '切换'}</em>
                  </span>
                  <span className="pair-profile-card__summary">
                    {recentProfileLine(user.profile).slice(0, 54)}…
                  </span>
                  <span className="pair-profile-card__counts">
                    <span>自我记忆 {user.memories_self.length}</span>
                    <span>择偶偏好 {user.memories_ideal.length}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <button className="open-profile-explorer" type="button" onClick={() => setProfilesOpen(true)}>
            查看双方完整资料 <span aria-hidden="true">→</span>
          </button>
        </section>

        <section className="round-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{activeGame.generatedBy === 'ai' ? 'AI 为这对用户生成' : '今晚的小局'}</span>
              <h2>{activeGame.gameType}</h2>
            </div>
            <span className="round-count">{results.length}/{questions.length}</span>
          </div>
          <ol className="round-list">
            {questions.map((question, index) => (
              <li className={index < results.length ? 'is-done' : index === roundIndex && gamePhase !== 'idle' ? 'is-current' : ''} key={question.id}>
                <span>{index < results.length ? '✓' : index + 1}</span>
                <div>
                  <strong>{question.label}</strong>
                  <small>{question.source}</small>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="safety-note">
          <span aria-hidden="true">☂</span>
          <div>
            <strong>理解完整资料，题面守住边界</strong>
            <p>私密偏好只用于避开雷区，不直接暴露；任何跟进都由本人确认后发送。</p>
          </div>
        </section>
      </aside>

      <IcebreakerGame
        open={gameOpen}
        match={match}
        game={activeGame}
        phase={gamePhase}
        roundIndex={roundIndex}
        answer={answer}
        guess={guess}
        results={results}
        viewer={viewer}
        starter={gameStarter}
        onAnswerChange={setAnswer}
        onGuessChange={setGuess}
        onLockAnswer={lockAnswer}
        onHandoff={() => setGamePhase('guessing')}
        onReveal={revealRound}
        onNextRound={nextRound}
        onClose={() => setGameOpen(false)}
        onFollowUp={bringFollowUpToChat}
        onRestart={() => resetGame(true)}
        onViewerChange={changeViewer}
      />

      <ProfileExplorer
        open={profilesOpen}
        match={match}
        viewer={viewer}
        onViewerChange={changeViewer}
        onClose={() => setProfilesOpen(false)}
      />
    </div>
  );
}
