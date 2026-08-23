import type { GameDefinition, GameResultCard, GameTemplateId, MatchUser, ParticipantId } from './types';
import type { TemplateGameResult } from './components/TemplateGameStage';

export interface ResultCardRequest {
  game: Pick<GameDefinition, 'id' | 'matchId' | 'templateId' | 'gameType' | 'title' | 'description'>;
  result: unknown;
  players: Record<ParticipantId, Pick<MatchUser, 'nickname'>>;
}

function clean(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function rapidStats(result: TemplateGameResult) {
  if (result.type !== 'rapid-choice') return null;
  const total = result.questions.length;
  const same = result.questions.reduce((count, _, index) => {
    const a = result.answers.a[index];
    const b = result.answers.b[index];
    return count + (a !== 'timeout' && b !== 'timeout' && a === b ? 1 : 0);
  }, 0);
  return { total, same };
}

export function buildFallbackResultCard(
  game: ResultCardRequest['game'],
  result: unknown,
  players: ResultCardRequest['players'],
  status: GameResultCard['status'] = 'fallback',
): GameResultCard {
  const typed = result as Partial<TemplateGameResult> | undefined;
  const stats = rapidStats(typed as TemplateGameResult);
  const first = players.a.nickname;
  const second = players.b.nickname;
  let headline = '这一局，把彼此的答案放在了同一张桌上';
  let summary = `${first} 和 ${second} 完成了「${game.title}」。不急着给关系下结论，先把这一刻留下。`;
  let highlights = ['愿意一起玩完，就是很好的默契', '答案不同的地方，也是一扇新的聊天入口'];
  let badge = '轻松完成';
  let score = 82;
  let nextPrompt = '如果把这一局延长 10 分钟，你们最想继续聊哪个答案？';

  if (typed?.type === 'profile-riddle') {
    headline = '你们正在形成一份只属于彼此的印象';
    summary = `${first} 和 ${second} 交换了眼中的关键词，完成了一次温柔的互相发现。`;
    highlights = ['关键词是入口，不是标签', '可以从“为什么选这个词”继续聊下去'];
    badge = '互相发现';
    score = 88;
    nextPrompt = '刚才哪个关键词最出乎你的意料？为什么？';
  } else if (typed?.type === 'keyword-wheel') {
    const topic = clean(typed.topic?.label, '共同话题');
    headline = `「${topic}」是你们今天的隐藏彩蛋`;
    summary = `${first} 和 ${second} 从一个随机关键词出发，把对话推进到了更具体、更生活化的一层。`;
    highlights = [`从「${topic}」继续追问，容易聊出真实细节`, '一问一答，比追求标准答案更重要'];
    badge = '话题升温';
    score = 86;
    nextPrompt = clean(typed.followUp, '关于这个话题，你们还想交换哪一个小故事？');
  } else if (stats) {
    const different = stats.total - stats.same;
    headline = stats.same >= Math.ceil(stats.total / 2) ? '你们的默契，在选择里自然露了出来' : '不同答案，正好留下了更多新发现';
    summary = `${first} 和 ${second} 完成了 ${stats.total} 道快速选择题：${stats.same} 题同选，${different} 题各有想法。`;
    highlights = [`${stats.same} 题同选，是轻松的共同节奏`, `${different} 个不同答案，适合拿来交换理由`];
    badge = stats.same >= Math.ceil(stats.total / 2) ? '默契在线' : '新发现';
    score = Math.round(74 + (stats.same / Math.max(1, stats.total)) * 20);
    nextPrompt = '挑一道你们答案不同的题，先说说自己为什么这么选。';
  }

  return {
    id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    gameId: game.id,
    gameTitle: game.title,
    templateId: game.templateId as GameTemplateId,
    status,
    badge,
    headline,
    score,
    summary,
    highlights,
    nextPrompt,
    generatedBy: 'fallback',
    createdAt: new Date().toISOString(),
  };
}
