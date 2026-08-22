import type { GameDefinition, MatchPayload } from '../types';

const publicTopics = ['博物馆', '逛展', '徒步', '做饭', '摄影', '旅行', '咖啡', '电影', '运动', '阅读'];

function findPublicTopic(match: MatchPayload) {
  const chat = match.messages.map((message) => message.content).join(' ');
  return publicTopics.find((topic) => chat.includes(topic)) ?? '周末安排';
}

export function buildFallbackGame(match: MatchPayload): GameDefinition {
  const topic = findPublicTopic(match);

  return {
    schemaVersion: 1,
    id: `fallback-${match.match_id}`,
    matchId: match.match_id,
    gameType: '默契猜猜',
    title: '来一局「如果是你」吗？',
    eyebrow: '如果是你 · 默契接力',
    description: '一方偷偷选择，另一方凭感觉猜。没有输赢，猜错反而会多一个可以继续聊的话题。',
    whyItFits: `从你们已经聊过的「${topic}」轻松开始，再慢慢交换日常偏好。`,
    estimatedMinutes: 3,
    topics: [topic, '陪伴偏好', '留个下次'],
    generatedBy: 'fallback',
    generatedAt: new Date().toISOString(),
    questions: [
    {
      id: 'free-afternoon',
      label: '轻松开场',
      source: `来自你们聊过的「${topic}」`,
      prompt: '如果突然多出半天空闲，TA 更可能怎么安排？',
      options: ['去看一个小展', '沿江随便走走', '找家店聊一下午', '宅家充电'],
      matchedFollowUp: '原来你也这么觉得。你心里有具体想去的地方吗？',
      differentFollowUp: '我原来猜错啦。是什么让你更喜欢这个安排？',
    },
    {
      id: 'tired-evening',
      label: '日常节奏',
      source: '一张不涉及隐私的陪伴偏好题',
      prompt: '忙完特别累的一天，TA 更希望收到哪种陪伴？',
      options: ['听我吐槽五分钟', '发点好玩的转移注意', '先让我安静一会儿', '看当天心情'],
      matchedFollowUp: '这个答案很实用。你平时会直接告诉对方自己的状态吗？',
      differentFollowUp: '这个答案和我想的不一样，但挺有用。你会怎么表达这种需要？',
    },
    {
      id: 'tiny-plan',
      label: '留个下次',
      source: '把聊天变成一个低压力的小行动',
      prompt: '如果把今天的聊天延长一小时，TA 更愿意一起做什么？',
      options: ['互换一首循环歌曲', '分享一张今日照片', '再来一道问题', '继续随便聊聊'],
      matchedFollowUp: '看来这件小事可以马上开始。要不要就从你先来？',
      differentFollowUp: '我们想的不一样也挺好。你为什么更想选这个？',
    },
    ],
  };
}

export function isGameDefinition(value: unknown): value is GameDefinition {
  if (!value || typeof value !== 'object') return false;
  const game = value as Partial<GameDefinition>;
  if (
    game.schemaVersion !== 1 ||
    typeof game.id !== 'string' || game.id.length > 100 ||
    typeof game.matchId !== 'string' || game.matchId.length > 200 ||
    typeof game.gameType !== 'string' || game.gameType.length < 2 || game.gameType.length > 60 ||
    typeof game.title !== 'string' || game.title.length < 4 || game.title.length > 60 ||
    typeof game.eyebrow !== 'string' || game.eyebrow.length < 2 || game.eyebrow.length > 30 ||
    typeof game.description !== 'string' || game.description.length < 10 || game.description.length > 240 ||
    typeof game.whyItFits !== 'string' || game.whyItFits.length < 10 || game.whyItFits.length > 240 ||
    !Number.isInteger(game.estimatedMinutes) ||
    (game.estimatedMinutes ?? 0) < 2 || (game.estimatedMinutes ?? 0) > 12 ||
    !Array.isArray(game.topics) ||
    game.topics.length < 2 || game.topics.length > 4 ||
    !game.topics.every((topic) => typeof topic === 'string' && topic.length >= 2 && topic.length <= 24) ||
    new Set(game.topics).size !== game.topics.length ||
    !Array.isArray(game.questions) ||
    game.questions.length !== 3 ||
    (game.generatedBy !== 'fallback' && game.generatedBy !== 'ai') ||
    typeof game.generatedAt !== 'string'
  ) return false;

  const ids = new Set<string>();
  return game.questions.every((question) => {
    if (
      !question ||
      typeof question.id !== 'string' || !/^[a-z0-9-]{2,40}$/.test(question.id) ||
      ids.has(question.id) ||
      typeof question.label !== 'string' || question.label.length < 2 || question.label.length > 24 ||
      typeof question.source !== 'string' || question.source.length < 4 || question.source.length > 100 ||
      typeof question.prompt !== 'string' || question.prompt.length < 8 || question.prompt.length > 140 ||
      !Array.isArray(question.options) ||
      question.options.length < 3 ||
      question.options.length > 4 ||
      !question.options.every((option) => typeof option === 'string' && option.length > 0 && option.length <= 60) ||
      new Set(question.options).size !== question.options.length ||
      typeof question.matchedFollowUp !== 'string' || question.matchedFollowUp.length < 6 || question.matchedFollowUp.length > 140 ||
      typeof question.differentFollowUp !== 'string' || question.differentFollowUp.length < 6 || question.differentFollowUp.length > 140
    ) return false;
    ids.add(question.id);
    return true;
  });
}
