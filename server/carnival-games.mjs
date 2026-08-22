import { randomUUID } from 'node:crypto';
import { buildExclusiveFallbackGame } from './exclusive-series.mjs';

const PUBLIC_TOPICS = [
  '博物馆', '逛展', '徒步', '爬山', '露营', '骑行', '跑步', '健身', '做饭', '摄影',
  '旅行', '咖啡', '电影', '音乐', '阅读', '宠物', '桌游', '动漫', '艺术', '周末',
  '早餐', '夜宵', '散步', '游戏',
];

const PROFILE_QUESTIONS = [
  {
    id: 'first-impression', label: '第一感觉', source: '来自这段公开聊天的整体印象',
    prompt: '哪个词更接近你对 TA 的第一感觉？', options: ['真诚', '有趣', '慢热', '直率'],
    matchedFollowUp: '你们想到了一起。是哪个聊天细节让你有这种感觉？',
    differentFollowUp: '这个词很有意思。你是从哪个聊天细节感受到的？',
  },
  {
    id: 'getting-along', label: '相处方式', source: '只描述公开聊天中的相处体验',
    prompt: '如果用一个词形容 TA 的相处方式，你会选？', options: ['细腻', '会倾听', '有行动力', '有分寸'],
    matchedFollowUp: '这个观察很具体。你愿意说说对应的聊天瞬间吗？',
    differentFollowUp: '原来你看到的是这一面。哪句话让你有这个印象？',
  },
  {
    id: 'life-energy', label: '生活状态', source: '一组不涉及敏感身份的生活方式词',
    prompt: 'TA 给你的生活状态更像哪一个词？', options: ['热爱生活', '有好奇心', '松弛', '有计划'],
    matchedFollowUp: '你们都留意到了这一点。它对你来说为什么重要？',
    differentFollowUp: '这个角度我之前没想到。你为什么会选它？',
  },
];

function wheelQuestions(topic) {
  return [
    {
      id: 'shared-topic', label: topic.slice(0, 8), source: `来自公开聊天里的「${topic}」`,
      prompt: `聊到「${topic}」时，你最想听对方讲哪一段经历？`, options: ['先分享自己的', '先听对方说'],
      matchedFollowUp: `如果从「${topic}」选一个最难忘的瞬间，你会讲哪个？`,
      differentFollowUp: `关于「${topic}」，最近一次让你有新感受的是什么？`,
    },
    {
      id: 'weekend', label: '周末', source: '从轻松日常继续往下聊',
      prompt: '什么样的周末会让你觉得真正充到电？', options: ['安排一点事情', '完全随心一点'],
      matchedFollowUp: '最近哪个周末让你觉得过得很值？',
      differentFollowUp: '如果只有半天，你最想把时间留给什么？',
    },
    {
      id: 'tiny-happiness', label: '小确幸', source: '不需要标准答案的小事题',
      prompt: '最近什么小事让你的心情变好了？', options: ['意外的小惊喜', '熟悉的日常感'],
      matchedFollowUp: '这件小事为什么会让你记这么久？',
      differentFollowUp: '你通常会把这种开心分享给谁？',
    },
    {
      id: 'curiosity', label: '好奇心', source: '给下一轮聊天留一个入口',
      prompt: '最近你在主动了解什么新东西？', options: ['一项新技能', '一个新地方'],
      matchedFollowUp: '如果今天就开始，你会先做哪一步？',
      differentFollowUp: '是什么让你突然对它产生兴趣？',
    },
  ];
}

const RAPID_QUESTIONS = [
  {
    id: 'plan-or-go', label: '周末模式', source: '公开聊天后的轻量直觉题',
    prompt: '周末出去玩，你更偏向哪一种？', options: ['提前把攻略做好', '当天醒来再决定'],
    matchedFollowUp: '你们都这样选，可以聊聊：这种方式最吸引你的是什么？',
    differentFollowUp: '你们选得不一样，可以聊聊：各自更看重安心感还是自由感？',
  },
  {
    id: 'talk-or-space', label: '情绪节奏', source: '轻量相处偏好题',
    prompt: '心情不好的时候，你更希望对方怎么做？', options: ['马上来聊聊', '先给一点空间'],
    matchedFollowUp: '你们都这样选。平时会怎么把这个需要告诉对方？',
    differentFollowUp: '你们选得不一样。怎样表达才能让对方不需要猜？',
  },
  {
    id: 'photo-or-moment', label: '记录瞬间', source: '从日常习惯认识彼此',
    prompt: '遇到很好看的日落，你更可能怎么做？', options: ['先拍下来分享', '先安静地看一会儿'],
    matchedFollowUp: '看来你们记录美好的方式很像。最近保存了哪个瞬间？',
    differentFollowUp: '你们记录美好的方式不同。哪种回忆更容易留在你心里？',
  },
  {
    id: 'new-or-familiar', label: '约会灵感', source: '不推动见面的低压力想象题',
    prompt: '空出一个小时，你更愿意怎么度过？', options: ['试一家新店', '去熟悉的地方'],
    matchedFollowUp: '你们都这样选。心里有没有一个具体候选？',
    differentFollowUp: '你们选得不一样。新鲜感和熟悉感分别给你什么？',
  },
];

function unique(values, maximum = 12) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].slice(0, maximum);
}

function publicTopic(messages) {
  const chat = messages.map((message) => message.content).join(' ');
  return PUBLIC_TOPICS.find((topic) => chat.includes(topic)) ?? '周末安排';
}

export function carnivalMatchFromState(state) {
  if (state?.status !== 'matched' || !state.room || !state.self || !state.peer) {
    throw new Error('Carnival participant is not matched');
  }
  const members = [state.self, state.peer];
  const participantFor = new Map(members.map((member, index) => [member.id, index === 0 ? 'a' : 'b']));
  const textMessages = state.messages.filter((message) => message.type === 'text');
  const user = (member) => ({
    nickname: member.nickname,
    gender: member.gender,
    profile: '',
    memories_self: [],
    memories_ideal: [],
  });
  return {
    match_id: state.room.id,
    match_status: 'MATCH_STATUS_MATCHED',
    message_count: textMessages.length,
    messages: textMessages.map((message) => ({
      from: participantFor.get(message.senderId) ?? 'a',
      type: 'text',
      content: message.content,
      sent_at: new Date(message.createdAt).toISOString(),
    })),
    user_a: user(members[0]),
    user_b: user(members[1]),
  };
}

export function buildCarnivalFallbackGame(match, templateId, label, selection = {}) {
  if (templateId === 'custom') {
    return buildExclusiveFallbackGame(match, selection.seriesId, label || '专属小游戏');
  }
  const topic = publicTopic(match.messages);
  const questions = templateId === 'keyword-wheel'
    ? wheelQuestions(topic)
    : templateId === 'rapid-choice'
      ? RAPID_QUESTIONS
      : PROFILE_QUESTIONS;
  const gameLabel = label || (
    templateId === 'keyword-wheel' ? '关键词深挖' : templateId === 'rapid-choice' ? '极限2选1' : '资料猜谜局'
  );
  const topics = templateId === 'keyword-wheel'
    ? unique([topic, '周末', '小确幸', '好奇心'], 4)
    : templateId === 'rapid-choice'
      ? ['周末模式', '情绪节奏', '记录瞬间', '约会灵感']
      : ['第一感觉', '相处方式', '生活状态'];
  const mechanics = templateId === 'profile-riddle'
    ? {
        kind: 'profile-riddle',
        keywordOptions: unique([
          ...questions.flatMap((question) => question.options),
          '真诚', '有趣', '细腻', '有分寸', '热爱生活', '有好奇心',
        ]),
        sentencePattern: '我猜你是一个「关键词一」、有点「关键词二」，还很「关键词三」的人。',
      }
    : templateId === 'keyword-wheel'
      ? {
          kind: 'keyword-wheel',
          segments: questions.map((question) => ({
            id: question.id,
            keyword: question.label,
            prompt: question.prompt,
            followUp: question.differentFollowUp,
          })),
        }
      : { kind: 'rapid-choice', roundSeconds: 5 };
  return {
    schemaVersion: 2,
    id: randomUUID(),
    matchId: match.match_id,
    templateId,
    gameType: gameLabel,
    title: templateId === 'profile-riddle'
      ? '用 3 个词，说说眼中的 TA'
      : templateId === 'keyword-wheel'
        ? '转一下，把一个话题聊深一点'
        : '5 秒凭直觉，看看你们怎么选',
    eyebrow: `${gameLabel} · 游园会双人局`,
    description: templateId === 'profile-riddle'
      ? '双方各选三个关键词描述对方，两个人完成后才会一起揭晓。'
      : templateId === 'keyword-wheel'
        ? '转盘会从公开聊天线索中抽一个关键词，再给出一条低压力追问。'
        : '双方分别完成四道五秒二选一，最后一起查看答案和可以继续聊的原因。',
    whyItFits: `从你们已经聊过的「${topic}」开始，不需要准备标准答案。`,
    estimatedMinutes: templateId === 'rapid-choice' ? 4 : 3,
    topics,
    questions,
    mechanics,
    generatedBy: 'fallback',
    generatedAt: new Date().toISOString(),
  };
}
