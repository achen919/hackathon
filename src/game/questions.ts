import type {
  GameDefinition,
  GameQuestion,
  GameTemplateId,
  MatchPayload,
  ParticipantId,
  ProfileRiddleChoiceGroup,
} from '../types';

const publicTopics = ['博物馆', '逛展', '徒步', '做饭', '摄影', '旅行', '咖啡', '电影', '运动', '阅读'];

function findPublicTopic(match: MatchPayload) {
  const chat = match.messages.map((message) => message.content).join(' ');
  return publicTopics.find((topic) => chat.includes(topic)) ?? '周末安排';
}

interface ProfileDirection {
  id: string;
  category: 'interaction' | 'planning' | 'lifestyle';
  signals: readonly string[];
  options: readonly [string, string, string];
}

const profileDirections: readonly ProfileDirection[] = [
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

const fallbackProfileDirectionIds = ['profile-weekend', 'profile-food', 'profile-social-state', 'profile-decision'];
const guessLabels = ['小猜测一', '小猜测二', '小猜测三'];

function profileSignalText(match: MatchPayload, target: ParticipantId) {
  const user = target === 'a' ? match.user_a : match.user_b;
  return [
    user?.profile,
    ...match.messages
      .filter((message) => message.type === 'text' && message.from === target)
      .map((message) => message.content),
  ].filter((value): value is string => typeof value === 'string').join(' ');
}

function selectProfileDirections(match: MatchPayload, target: ParticipantId) {
  const signalText = profileSignalText(match, target);
  const scored = profileDirections
    .map((direction, index) => ({
      direction,
      index,
      score: direction.signals.reduce((score, signal) => score + (signalText.includes(signal) ? 1 : 0), 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected: ProfileDirection[] = [];
  const selectedCategories = new Set<ProfileDirection['category']>();
  for (const { direction } of scored) {
    if (selected.length === 3) break;
    if (!selectedCategories.has(direction.category)) {
      selected.push(direction);
      selectedCategories.add(direction.category);
    }
  }
  const fallbackDirections = fallbackProfileDirectionIds
    .map((id) => profileDirections.find((candidate) => candidate.id === id))
    .filter((direction): direction is ProfileDirection => Boolean(direction));
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

function profileQuestions(match: MatchPayload, target: ParticipantId): GameQuestion[] {
  return selectProfileDirections(match, target).map((direction, index) => ({
    id: direction.id,
    label: guessLabels[index],
    source: '根据公开资料延伸的轻松行为候选',
    prompt: '凭第一感觉，选一个更像 TA 的日常片段。',
    options: [...direction.options],
    matchedFollowUp: '这条猜得挺准。你愿意补充一个具体的小故事吗？',
    differentFollowUp: '这条猜反了也很好聊。你实际更接近哪种情况？',
  }));
}

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

function choiceGroupsFor(questions: GameQuestion[]) {
  return questions.map((question) => ({
    id: question.id,
    options: [question.options[0], question.options[1], question.options[2]] as [string, string, string],
  })) as [ProfileRiddleChoiceGroup, ProfileRiddleChoiceGroup, ProfileRiddleChoiceGroup];
}

function mechanicsFor(
  templateId: GameTemplateId,
  questions: GameQuestion[],
  topics: string[],
  profileQuestionsByTarget?: Record<ParticipantId, GameQuestion[]>,
): GameDefinition['mechanics'] {
  if (templateId === 'profile-riddle') {
    const choiceGroupsByTarget = {
      a: choiceGroupsFor(profileQuestionsByTarget?.a ?? questions),
      b: choiceGroupsFor(profileQuestionsByTarget?.b ?? questions),
    };
    const choiceGroups = choiceGroupsByTarget.b;
    return {
      kind: 'profile-riddle',
      choiceGroups,
      choiceGroupsByTarget,
      keywordOptions: unique(choiceGroups.flatMap((group) => group.options)),
      sentencePattern: '我觉得{昵称}是一个{猜测一}、{猜测二}，而且{猜测三}的人。',
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
  const profileQuestionsByTarget = templateId === 'profile-riddle'
    ? { a: profileQuestions(match, 'a'), b: profileQuestions(match, 'b') }
    : undefined;
  const questions = templateId === 'keyword-wheel'
    ? wheelQuestions(topic)
    : templateId === 'rapid-choice'
      ? rapidQuestions
      : templateId === 'custom'
        ? customQuestions
        : profileQuestionsByTarget?.b ?? profileQuestions(match, 'b');
  const gameType = label ?? (
    templateId === 'keyword-wheel' ? '关键词深挖' : templateId === 'rapid-choice' ? '极限2选1' : templateId === 'custom' ? '专属小游戏' : '资料猜谜局'
  );
  const topics = templateId === 'keyword-wheel'
    ? unique([topic, '周末', '小确幸', '好奇心'], 4)
    : templateId === 'rapid-choice'
      ? ['周末模式', '情绪节奏', '记录瞬间', '约会灵感']
      : templateId === 'custom'
        ? ['Prompt 生成', '可玩交互', topic]
        : guessLabels;

  return {
    schemaVersion: 2,
    id: `fallback-${match.match_id}-${templateId}`,
    matchId: match.match_id,
    templateId,
    gameType,
    title: templateId === 'profile-riddle'
      ? '凭第一感觉，猜 TA 的 3 个小细节'
      : templateId === 'keyword-wheel'
        ? '转一下，把一个话题聊深一点'
        : templateId === 'rapid-choice'
          ? '5 秒凭直觉，看看你们怎么选'
          : '写一句 Prompt，现场变成游戏',
    eyebrow: `${gameType} · 双人破冰`,
    description: templateId === 'profile-riddle'
      ? '从三组日常片段中各选一个小猜测，发给 TA 看看哪里挺准、哪里正好聊开。'
      : templateId === 'keyword-wheel'
        ? '转盘会从公开聊天线索中抽一个关键词，再给出一条低压力追问。'
        : templateId === 'rapid-choice'
          ? '双方分别完成 3–5 道五秒二选一，最后一起查看答案和可以继续聊的原因。'
          : '在当前案例页编辑 Prompt，生成滑卡、情绪刻度和星轨等三轮可玩互动，无需登录。',
    whyItFits: templateId === 'profile-riddle'
      ? '三个小猜测都来自轻松日常，猜反了也能自然接着聊。'
      : `从你们已经聊过的「${topic}」开始，不需要准备标准答案。`,
    estimatedMinutes: templateId === 'rapid-choice' ? 4 : 3,
    topics,
    questions,
    mechanics: mechanicsFor(templateId, questions, topics, profileQuestionsByTarget),
    generatedBy: 'fallback',
    generatedAt: new Date().toISOString(),
  };
}

function validMechanics(game: Partial<GameDefinition>) {
  const mechanics = game.mechanics;
  if (!mechanics || typeof mechanics !== 'object' || !('kind' in mechanics) || mechanics.kind !== game.templateId) return false;
  if (mechanics.kind === 'profile-riddle') {
    const groupsValid = mechanics.choiceGroups === undefined || validProfileGroups(mechanics.choiceGroups);
    const targetMap = mechanics.choiceGroupsByTarget;
    const targetGroupsValid = targetMap === undefined || (
      typeof targetMap === 'object' && targetMap !== null && !Array.isArray(targetMap) &&
      Object.keys(targetMap).length === 2 && 'a' in targetMap && 'b' in targetMap &&
      validProfileGroups(targetMap.a) && validProfileGroups(targetMap.b)
    );
    return groupsValid && targetGroupsValid && Array.isArray(mechanics.keywordOptions) && mechanics.keywordOptions.length >= 6 && mechanics.keywordOptions.length <= 12 &&
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

const broadProfileLabelRoots = [
  '慢热', '外向', '内向', '理性', '感性', '随性', '有计划', '直率', '真诚',
  '细腻', '松弛', '有分寸', '热爱生活', '有好奇心', '有行动力', '会倾听',
];
const interestingScene = /有趣(?:的)?(?:小店|店|地方|展览|展|电影|书|音乐|游戏|话题|活动|东西|故事|点子|路线|招牌|菜单|餐厅|体验|事情|内容|作品)/gu;

function isBehaviorLabel(value: string) {
  const normalized = value.trim();
  const length = [...normalized].length;
  const comparable = normalized.replace(/[\s\p{P}\p{S}]+/gu, '');
  const withoutInterestingScene = comparable.replace(interestingScene, '');
  return length >= 4 && length <= 12 &&
    !/[\r\n，。！？、；：,.!?;:]/u.test(normalized) &&
    !broadProfileLabelRoots.some((root) => comparable.includes(root)) &&
    !withoutInterestingScene.includes('有趣') &&
    !/控制欲|恋爱脑|妈宝|社恐|难搞|情绪化|不靠谱|黏人|强势|冷漠|自私|幼稚/u.test(normalized) &&
    !/(?:的人|型人格|性格)$/u.test(normalized);
}

function validProfileGroups(groups: unknown) {
  if (!Array.isArray(groups) || groups.length !== 3) return false;
  const directionIds = new Set(profileDirections.map((direction) => direction.id));
  const ids = groups.map((group) => group?.id);
  if (new Set(ids).size !== 3 || !ids.every((id) => typeof id === 'string' && directionIds.has(id))) return false;
  const categories = new Set(ids.map((id) => profileDirections.find((direction) => direction.id === id)?.category));
  const options = groups.flatMap((group) => Array.isArray(group?.options) ? group.options : []);
  return categories.size >= 2 && options.length === 9 && new Set(options).size === 9 &&
    groups.every((group) => Array.isArray(group.options) && group.options.length === 3 && group.options.every(isBehaviorLabel));
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
  if (game.templateId === 'profile-riddle') {
    return validProfileGroups(game.questions);
  }
  if (game.templateId === 'rapid-choice') return game.questions.every((question) => question.options.length === 2);
  return true;
}
