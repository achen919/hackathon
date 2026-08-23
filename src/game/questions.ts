import type {
  GameDefinition,
  GameQuestion,
  GameTemplateId,
  MatchPayload,
} from '../types';

const publicTopics = ['博物馆', '逛展', '徒步', '做饭', '摄影', '旅行', '咖啡', '电影', '运动', '阅读'];

function findPublicTopic(match: MatchPayload) {
  const chat = match.messages.map((message) => message.content).join(' ');
  return publicTopics.find((topic) => chat.includes(topic)) ?? '周末安排';
}

const profileQuestions: GameQuestion[] = [
  {
    id: 'first-impression', label: '第一感觉', source: '从公开资料提炼的中性描述词',
    prompt: '哪个词更接近你对 TA 的第一感觉？', options: ['真诚', '有趣', '慢热', '直率'],
    matchedFollowUp: '你们想到了一起。是哪个细节让你有这种感觉？',
    differentFollowUp: '这个词很有意思。你是从哪个细节感受到的？',
  },
  {
    id: 'getting-along', label: '相处方式', source: '只描述相处体验，不给人格下结论',
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

function wheelQuestions(topic: string): GameQuestion[] {
  return [
    {
      id: 'wheel-shared-topic', label: topic.slice(0, 8), source: `来自公开聊天里的「${topic}」`,
      prompt: `聊到「${topic}」时，你最想知道对方哪一段经历？`, options: ['先分享自己的', '先听对方说'],
      matchedFollowUp: `如果从「${topic}」选一个最难忘的瞬间，你会讲哪个？`,
      differentFollowUp: `关于「${topic}」，最近一次让你有新感受的是什么？`,
    },
    {
      id: 'wheel-weekend', label: '周末', source: '从轻松日常继续往下聊',
      prompt: '什么样的周末会让你觉得真正充到电？', options: ['安排一点事情', '完全随心一点'],
      matchedFollowUp: '最近哪个周末让你觉得过得很值？',
      differentFollowUp: '如果只有半天，你最想把时间留给什么？',
    },
    {
      id: 'wheel-tiny-happiness', label: '小确幸', source: '不需要标准答案的小事题',
      prompt: '最近什么小事让你的心情变好了？', options: ['意外的小惊喜', '熟悉的日常感'],
      matchedFollowUp: '这件小事为什么会让你记这么久？',
      differentFollowUp: '你通常会把这种开心分享给谁？',
    },
    {
      id: 'wheel-curiosity', label: '好奇心', source: '给下一轮聊天留一个入口',
      prompt: '最近你在主动了解什么新东西？', options: ['一项新技能', '一个新地方'],
      matchedFollowUp: '如果今天就开始，你会先做哪一步？',
      differentFollowUp: '是什么让你突然对它产生兴趣？',
    },
  ];
}

const rapidQuestions: GameQuestion[] = [
  {
    id: 'plan-or-go', label: '周末模式', source: '五秒直觉题，没有更好的选项',
    prompt: '周末出去玩，你更偏向哪一种？', options: ['提前把攻略做好', '当天醒来再决定'],
    matchedFollowUp: '你们都这样选，可以聊聊：这种方式最吸引你的是什么？',
    differentFollowUp: '你们选得不一样，可以聊聊：各自最看重安心感还是自由感？',
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

const customQuestions: GameQuestion[] = [
  {
    id: 'prompt-opening', label: '滑卡开场', source: '根据公开聊天主题组合的安全互动',
    prompt: '用左右滑卡选一个更像你的开场方式。', options: ['先听 TA 说', '先分享自己的'],
    matchedFollowUp: '你们想从同一边开场。这种方式为什么让你放松？',
    differentFollowUp: '你们选了不同的开场。各自更看重什么？',
  },
  {
    id: 'prompt-temperature', label: '情绪刻度', source: '只描述当下聊天节奏，不分析人格',
    prompt: '现在的聊天温度更接近哪一格？', options: ['轻松试探', '有点好奇', '渐入佳境', '想多听一点'],
    matchedFollowUp: '你们感受很像。是哪个瞬间让聊天升温了？',
    differentFollowUp: '你们的感受不同。下一句怎样聊会更自然？',
  },
  {
    id: 'prompt-next', label: '星轨选择', source: '从公开话题延伸的低压力续聊方向',
    prompt: '这局结束后，你最想把聊天带向哪里？', options: ['周末灵感', '最近的小确幸', '一个还没问过的好奇', '先收好这份默契'],
    matchedFollowUp: '你们想去同一个方向。谁愿意先用一句话开场？',
    differentFollowUp: '这里出现了两条好走的支线。为什么你更想先聊这一条？',
  },
];

function unique(values: string[], maximum = 12) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, maximum);
}

function mechanicsFor(templateId: GameTemplateId, questions: GameQuestion[], topics: string[]): GameDefinition['mechanics'] {
  if (templateId === 'profile-riddle') {
    return {
      kind: 'profile-riddle',
      keywordOptions: unique([
        ...questions.flatMap((question) => question.options),
        '真诚', '有趣', '细腻', '有分寸', '热爱生活', '有好奇心',
      ]),
      sentencePattern: '我猜你是一个「关键词一」、有点「关键词二」，还很「关键词三」的人。',
    };
  }
  if (templateId === 'keyword-wheel') {
    return {
      kind: 'keyword-wheel',
      segments: questions.map((question, index) => ({
        id: question.id,
        keyword: question.label || topics[index % topics.length],
        prompt: question.prompt,
        followUp: question.differentFollowUp,
      })),
    };
  }
  if (templateId === 'rapid-choice') return { kind: 'rapid-choice', roundSeconds: 5 };
  return { kind: 'custom' };
}

export function buildFallbackGame(
  match: MatchPayload,
  templateId: GameTemplateId = 'profile-riddle',
  label?: string,
): GameDefinition {
  const topic = findPublicTopic(match);
  const questions = templateId === 'keyword-wheel'
    ? wheelQuestions(topic)
    : templateId === 'rapid-choice'
      ? rapidQuestions
      : templateId === 'custom'
        ? customQuestions
        : profileQuestions;
  const gameType = label ?? (
    templateId === 'keyword-wheel' ? '关键词深挖' : templateId === 'rapid-choice' ? '极限2选1' : templateId === 'custom' ? '专属小游戏' : '资料猜谜局'
  );
  const topics = templateId === 'keyword-wheel'
    ? unique([topic, '周末', '小确幸', '好奇心'], 4)
    : templateId === 'rapid-choice'
      ? ['周末模式', '情绪节奏', '记录瞬间', '约会灵感']
      : templateId === 'custom'
        ? ['Prompt 生成', '可玩交互', topic]
        : ['第一感觉', '相处方式', '生活状态'];

  return {
    schemaVersion: 2,
    id: `fallback-${match.match_id}-${templateId}`,
    matchId: match.match_id,
    templateId,
    gameType,
    title: templateId === 'profile-riddle'
      ? '用 3 个词，说说眼中的 TA'
      : templateId === 'keyword-wheel'
        ? '转一下，把一个话题聊深一点'
        : templateId === 'rapid-choice'
          ? '5 秒凭直觉，看看你们怎么选'
          : '写一句 Prompt，现场变成游戏',
    eyebrow: `${gameType} · 双人破冰`,
    description: templateId === 'profile-riddle'
      ? '双方根据对方资料各选三个关键词，拼成一句印象描述，完成后一起揭晓。'
      : templateId === 'keyword-wheel'
        ? '转盘会从公开聊天线索中抽一个关键词，再给出一条低压力追问。'
        : templateId === 'rapid-choice'
          ? '双方分别完成 3–5 道五秒二选一，最后一起查看答案和可以继续聊的原因。'
          : '在当前案例页编辑 Prompt，生成滑卡、情绪刻度和星轨等三轮可玩互动，无需登录。',
    whyItFits: `从你们已经聊过的「${topic}」开始，不需要准备标准答案。`,
    estimatedMinutes: templateId === 'rapid-choice' ? 4 : 3,
    topics,
    questions,
    mechanics: mechanicsFor(templateId, questions, topics),
    generatedBy: 'fallback',
    generatedAt: new Date().toISOString(),
  };
}

function validMechanics(game: Partial<GameDefinition>) {
  const mechanics = game.mechanics;
  if (!mechanics || typeof mechanics !== 'object' || !('kind' in mechanics) || mechanics.kind !== game.templateId) return false;
  if (mechanics.kind === 'profile-riddle') {
    return Array.isArray(mechanics.keywordOptions) && mechanics.keywordOptions.length >= 6 && mechanics.keywordOptions.length <= 12 &&
      mechanics.keywordOptions.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 60) &&
      typeof mechanics.sentencePattern === 'string' && mechanics.sentencePattern.length >= 10 && mechanics.sentencePattern.length <= 160;
  }
  if (mechanics.kind === 'keyword-wheel') {
    return Array.isArray(mechanics.segments) && mechanics.segments.length >= 3 && mechanics.segments.length <= 5 && mechanics.segments.every(
      (segment) => segment && typeof segment.id === 'string' && typeof segment.keyword === 'string' && typeof segment.prompt === 'string' && typeof segment.followUp === 'string',
    );
  }
  if (mechanics.kind === 'rapid-choice') return mechanics.roundSeconds === 5;
  return mechanics.kind === 'custom';
}

export function isGameDefinition(value: unknown): value is GameDefinition {
  if (!value || typeof value !== 'object') return false;
  const game = value as Partial<GameDefinition>;
  if (
    game.schemaVersion !== 2 ||
    !['profile-riddle', 'keyword-wheel', 'rapid-choice', 'custom'].includes(game.templateId ?? '') ||
    typeof game.id !== 'string' || game.id.length > 100 ||
    typeof game.matchId !== 'string' || game.matchId.length > 200 ||
    typeof game.gameType !== 'string' || game.gameType.length < 2 || game.gameType.length > 60 ||
    typeof game.title !== 'string' || game.title.length < 4 || game.title.length > 60 ||
    typeof game.eyebrow !== 'string' || game.eyebrow.length < 2 || game.eyebrow.length > 60 ||
    typeof game.description !== 'string' || game.description.length < 10 || game.description.length > 240 ||
    typeof game.whyItFits !== 'string' || game.whyItFits.length < 10 || game.whyItFits.length > 240 ||
    !Number.isInteger(game.estimatedMinutes) || (game.estimatedMinutes ?? 0) < 2 || (game.estimatedMinutes ?? 0) > 12 ||
    !Array.isArray(game.topics) || game.topics.length < 2 || game.topics.length > 4 ||
    !game.topics.every((topic) => typeof topic === 'string' && topic.length >= 2 && topic.length <= 24) ||
    new Set(game.topics).size !== game.topics.length ||
    !Array.isArray(game.questions) || game.questions.length < 3 || game.questions.length > 5 ||
    (game.generatedBy !== 'fallback' && game.generatedBy !== 'ai') || typeof game.generatedAt !== 'string' || !validMechanics(game)
  ) return false;

  const ids = new Set<string>();
  const questionsValid = game.questions.every((question) => {
    if (
      !question || typeof question.id !== 'string' || !/^[a-z0-9-]{2,40}$/.test(question.id) || ids.has(question.id) ||
      typeof question.label !== 'string' || question.label.length < 2 || question.label.length > 24 ||
      typeof question.source !== 'string' || question.source.length < 4 || question.source.length > 100 ||
      typeof question.prompt !== 'string' || question.prompt.length < 8 || question.prompt.length > 140 ||
      !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 4 ||
      !question.options.every((option) => typeof option === 'string' && option.length > 0 && option.length <= 60) ||
      new Set(question.options).size !== question.options.length ||
      typeof question.matchedFollowUp !== 'string' || question.matchedFollowUp.length < 6 || question.matchedFollowUp.length > 140 ||
      typeof question.differentFollowUp !== 'string' || question.differentFollowUp.length < 6 || question.differentFollowUp.length > 140
    ) return false;
    ids.add(question.id);
    return true;
  });
  if (!questionsValid) return false;
  if (game.templateId === 'profile-riddle') return game.questions.length === 3 && game.questions.every((question) => question.options.length >= 3);
  if (game.templateId === 'rapid-choice') return game.questions.every((question) => question.options.length === 2);
  return true;
}
