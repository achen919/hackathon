import { randomUUID } from 'node:crypto';
import { buildArcadeFallbackGame } from './arcade-game.mjs';
import { buildExclusiveFallbackGame } from './exclusive-series.mjs';

const PUBLIC_TOPICS = [
  '博物馆', '逛展', '徒步', '爬山', '露营', '骑行', '跑步', '健身', '做饭', '摄影',
  '旅行', '咖啡', '电影', '音乐', '阅读', '宠物', '桌游', '动漫', '艺术', '周末',
  '早餐', '夜宵', '散步', '游戏',
];

const PROFILE_DIRECTIONS = [
  {
    id: 'profile-social-state', category: 'interaction', signals: ['朋友', '聚会', '桌游', '派对', '唱歌', 'KTV', '社团'],
    options: ['人多时先观察', '很快接上大家话题', '更喜欢一对一聊'],
  },
  {
    id: 'profile-communication', category: 'interaction', signals: ['倾听', '分享', '直接说', '语音', '长消息', '慢慢聊'],
    options: ['有话喜欢直接说', '先听完再回应', '想清楚再开口'],
  },
  {
    id: 'profile-weekend', category: 'planning', signals: ['周末', '宅家', '逛展', '散步', 'citywalk', 'Citywalk'],
    options: ['周末临时再安排', '会提前约好行程', '想留半天给自己'],
  },
  {
    id: 'profile-travel', category: 'planning', signals: ['旅行', '旅游', '出游', '攻略', '露营', '徒步', '爬山', '骑行'],
    options: ['出门先做好攻略', '到地方再看心情', '随时愿意改路线'],
  },
  {
    id: 'profile-food', category: 'lifestyle', signals: ['美食', '吃饭', '火锅', '咖啡', '做饭', '烘焙', '夜宵', '探店'],
    options: ['为了吃愿意绕远', '就近找家顺眼的', '先问大家想吃啥'],
  },
  {
    id: 'profile-interest', category: 'lifestyle', signals: ['电影', '音乐', '阅读', '摄影', '画画', '动漫', '游戏', '运动', '健身', '跑步', '博物馆'],
    options: ['感兴趣会查到底', '会拉朋友一起体验', '有空再慢慢研究'],
  },
  {
    id: 'profile-life-pace', category: 'planning', signals: ['早起', '熬夜', '夜猫', '晨跑', '作息', '下班'],
    options: ['一早就安排当天', '忙完才开始放松', '晚上更容易来劲'],
  },
  {
    id: 'profile-decision', category: 'planning', signals: ['计划', '选择', '决定', '随机', '临时', '安排'],
    options: ['先比较再做决定', '通常凭第一感觉', '会先听听别人意见'],
  },
  {
    id: 'profile-date', category: 'interaction', signals: ['约会', '看展', '看电影', '约饭', '见面'],
    options: ['喜欢边走边聊天', '更想一起做点事', '找家小店慢慢聊'],
  },
  {
    id: 'profile-emotion', category: 'interaction', signals: ['开心', '心情', '情绪', '难过', '压力'],
    options: ['开心会马上分享', '会先自己消化下', '更习惯边聊边理清'],
  },
];

const FALLBACK_PROFILE_DIRECTION_IDS = ['profile-weekend', 'profile-food', 'profile-social-state', 'profile-decision'];
const GUESS_LABELS = ['小猜测一', '小猜测二', '小猜测三'];

function profileSignalText(match, target) {
  const user = target === 'a' ? match.user_a : match.user_b;
  return [
    user?.profile,
    ...match.messages
      .filter((message) => message.type === 'text' && message.from === target)
      .map((message) => message.content),
  ].filter((value) => typeof value === 'string').join(' ');
}

function selectProfileDirections(match, target) {
  const signalText = profileSignalText(match, target);
  const scored = PROFILE_DIRECTIONS
    .map((direction, index) => ({
      direction,
      index,
      score: direction.signals.reduce((score, signal) => score + (signalText.includes(signal) ? 1 : 0), 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = [];
  const selectedCategories = new Set();
  for (const { direction } of scored) {
    if (selected.length === 3) break;
    if (!selectedCategories.has(direction.category)) {
      selected.push(direction);
      selectedCategories.add(direction.category);
    }
  }
  const fallbackDirections = FALLBACK_PROFILE_DIRECTION_IDS
    .map((id) => PROFILE_DIRECTIONS.find((candidate) => candidate.id === id))
    .filter(Boolean);
  for (const direction of fallbackDirections) {
    if (selected.length === 3) break;
    if (!selectedCategories.has(direction.category) && !selected.some((candidate) => candidate.id === direction.id)) {
      selected.push(direction);
      selectedCategories.add(direction.category);
    }
  }
  for (const { direction } of scored) {
    if (selected.length === 3) break;
    if (!selected.some((candidate) => candidate.id === direction.id)) selected.push(direction);
  }
  for (const direction of fallbackDirections) {
    if (selected.length === 3) break;
    if (!selected.some((candidate) => candidate.id === direction.id)) selected.push(direction);
  }
  return selected;
}

function profileQuestions(match, target) {
  return selectProfileDirections(match, target).map((direction, index) => ({
    id: direction.id,
    label: GUESS_LABELS[index],
    source: '根据公开资料延伸的轻松行为候选',
    prompt: '凭第一感觉，选一个更像 TA 的日常片段。',
    options: [...direction.options],
    matchedFollowUp: '这条猜得挺准。你愿意补充一个具体的小故事吗？',
    differentFollowUp: '这条猜反了也很好聊。你实际更接近哪种情况？',
  }));
}

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
    if (selection.seriesId === 'prompt-arcade') {
      return buildArcadeFallbackGame(match, label || '专属小游戏', selection);
    }
    return buildExclusiveFallbackGame(match, selection.seriesId, label || '专属小游戏', selection);
  }
  const topic = publicTopic(match.messages);
  const profileQuestionsByTarget = templateId === 'profile-riddle'
    ? { a: profileQuestions(match, 'a'), b: profileQuestions(match, 'b') }
    : null;
  const questions = templateId === 'keyword-wheel'
    ? wheelQuestions(topic)
    : templateId === 'rapid-choice'
      ? RAPID_QUESTIONS
      : profileQuestionsByTarget?.b ?? profileQuestions(match, 'b');
  const gameLabel = label || (
    templateId === 'keyword-wheel' ? '关键词深挖' : templateId === 'rapid-choice' ? '极限2选1' : '资料猜谜局'
  );
  const topics = templateId === 'keyword-wheel'
    ? unique([topic, '周末', '小确幸', '好奇心'], 4)
    : templateId === 'rapid-choice'
      ? ['周末模式', '情绪节奏', '记录瞬间', '约会灵感']
      : GUESS_LABELS;
  const mechanics = templateId === 'profile-riddle'
    ? (() => {
        const groupsFor = (targetQuestions) => targetQuestions.map((question) => ({
          id: question.id,
          options: [question.options[0], question.options[1], question.options[2]],
        }));
        const choiceGroupsByTarget = {
          a: groupsFor(profileQuestionsByTarget.a),
          b: groupsFor(profileQuestionsByTarget.b),
        };
        const choiceGroups = choiceGroupsByTarget.b;
        return {
          kind: 'profile-riddle',
          choiceGroups,
          choiceGroupsByTarget,
          keywordOptions: unique(choiceGroups.flatMap((group) => group.options)),
          sentencePattern: '我觉得{昵称}是一个{猜测一}、{猜测二}，而且{猜测三}的人。',
        };
      })()
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
      ? '凭第一感觉，猜 TA 的 3 个小细节'
      : templateId === 'keyword-wheel'
        ? '转一下，把一个话题聊深一点'
        : '5 秒凭直觉，看看你们怎么选',
    eyebrow: `${gameLabel} · 游园会双人局`,
    description: templateId === 'profile-riddle'
      ? '从三组日常片段中各选一个小猜测，发给 TA 看看哪里挺准、哪里正好聊开。'
      : templateId === 'keyword-wheel'
        ? '转盘会从公开聊天线索中抽一个关键词，再给出一条低压力追问。'
        : '双方分别完成四道五秒二选一，最后一起查看答案和可以继续聊的原因。',
    whyItFits: templateId === 'profile-riddle'
      ? '三个小猜测都来自轻松日常，猜反了也能自然接着聊。'
      : `从你们已经聊过的「${topic}」开始，不需要准备标准答案。`,
    estimatedMinutes: templateId === 'rapid-choice' ? 4 : 3,
    topics,
    questions,
    mechanics,
    generatedBy: 'fallback',
    generatedAt: new Date().toISOString(),
  };
}
