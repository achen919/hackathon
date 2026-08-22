export const GAME_TEMPLATE_CATALOG = Object.freeze([
  Object.freeze({
    id: 'profile-riddle',
    defaultLabel: '资料猜谜局',
    available: true,
    description: '从非敏感资料提炼候选词，选三个词拼成一句话，猜对方是什么样的人。',
  }),
  Object.freeze({
    id: 'keyword-wheel',
    defaultLabel: '关键词深挖',
    available: true,
    description: '把公开聊天里的共同话题放进转盘，随机抽取一个，再从轻到深追问。',
  }),
  Object.freeze({
    id: 'rapid-choice',
    defaultLabel: '极限2选1',
    available: true,
    description: '双方分别在五秒内完成二选一，最后一起对照答案并顺势继续聊。',
  }),
  Object.freeze({
    id: 'custom',
    defaultLabel: '专属小游戏',
    available: false,
    description: '为团队中的自定义小游戏实现预留的扩展插槽。',
  }),
]);

const PUBLIC_TOPIC_WORDS = [
  '博物馆', '逛展', '徒步', '爬山', '做饭', '摄影', '旅行', '咖啡', '电影', '音乐',
  '运动', '阅读', '宠物', '周末', '工作', '下班', '早餐', '夜宵', '散步', '游戏',
];

const CONTACT_OR_LINK_PATTERNS = [
  /(?:\+?86[-\s]*)?1[3-9](?:[-\s]*\d){9}/i,
  /\+\d{1,3}(?:[\s().-]*\d){7,14}/,
  /(?:微信号|wechat(?:\s*id)?|wx(?:\s*id)?|qq号)\s*[:：是为]?\s*[A-Z0-9_-]{5,}/i,
  /(?:微信|qq)\s*[:：]\s*[A-Z0-9_-]{5,}/i,
  /(?:^|[^\d])\d{7,12}(?:[^\d]|$)/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /https?:\/\/|www\./i,
];

const TEMPLATE_GUIDANCE = Object.freeze({
  'profile-riddle': `严格生成“资料猜谜局”：
- 固定三轮，双方轮流描述对方。
- 每轮提供 3-4 个中性、非敏感、非唯一识别的性格或生活方式关键词。
- 这些词只能帮助组织一句印象描述，不得直接复述私密资料，不得给人格下结论。
- matchedFollowUp / differentFollowUp 要引导本人解释“为什么这样理解对方”。`,
  'keyword-wheel': `严格生成“关键词深挖”：
- 生成 3-5 个来自公开聊天共同点的安全话题，每轮代表转盘抽中的一个关键词。
- 问题从事实偏好逐步过渡到轻量感受，不追问创伤、收入、健康、住址或联系方式。
- 每轮给 2-4 个无优劣选项，并提供一句可自然继续聊的追问。`,
  'rapid-choice': `严格生成“极限2选1”：
- 生成 3-5 道题，每题必须且只能有两个短选项，适合五秒内凭直觉选择。
- 从轻松日常到相处偏好逐步深入，不设置正确答案，不把不同选择解释为不合适。
- matchedFollowUp / differentFollowUp 都要明确邀请双方聊“为什么我或对方选择 A / B”。`,
  custom: `这是预留的“专属小游戏”类型。保持通用三轮安全题卡结构，不假设尚未接入的前端机制。`,
});

function cleanLabel(value) {
  return typeof value === 'string' ? value.trim().slice(0, 60) : '';
}

export function templateForId(value) {
  return GAME_TEMPLATE_CATALOG.find((template) => template.id === value) ?? null;
}

export function publicGameTypes(gameTypes) {
  return gameTypes.map((value) => {
    const template = templateForId(value.id);
    if (!template) return null;
    return {
      id: template.id,
      label: cleanLabel(value.label) || template.defaultLabel,
      templateId: template.id,
      enabled: value.enabled !== false,
      available: template.available && value.enabled !== false,
      description: template.description,
    };
  }).filter(Boolean);
}

export function configuredGameType(gameTypes, requested) {
  if (typeof requested !== 'string') return null;
  const normalized = requested.trim();
  return gameTypes.find((item) => item.id === normalized && item.enabled !== false) ?? null;
}

function publicTopics(match) {
  const chat = match.messages.map((message) => message.content).join(' ');
  const topics = PUBLIC_TOPIC_WORDS.filter((topic) => chat.includes(topic));
  return topics.slice(0, 3);
}

function relationshipStage(messageCount) {
  if (messageCount <= 6) return '刚刚认识，适合非常轻的开场';
  if (messageCount <= 24) return '正在熟悉彼此，可以从共同点进入日常偏好';
  return '已经有连续对话，可以在不越界的前提下多问一层原因';
}

export function buildPromptPreview(match, gameType) {
  const template = templateForId(gameType.id);
  if (!template) throw new Error('Unknown game template');
  const topics = publicTopics(match);
  const topicLine = topics.length > 0 ? `公开聊天中出现过：${topics.join('、')}` : '公开聊天主题较少，请从轻松日常开始';
  const stage = relationshipStage(match.messages.length);
  return `请为这两位用户生成一局「${gameType.label}」。\n\n关系阶段：${stage}。\n公开线索：${topicLine}。\n\n${TEMPLATE_GUIDANCE[template.id]}\n\n表达要求：像朋友发出的轻松邀请，题面简短，双方都可以跳过；不要输出匹配分数或关系结论。`;
}

export function normalizePlayerPrompt(value) {
  if (typeof value !== 'string') throw Object.assign(new Error('prompt must be a string'), { status: 400 });
  const normalized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (normalized.length < 20 || normalized.length > 1_500) {
    throw Object.assign(new Error('prompt must be between 20 and 1500 characters'), { status: 400 });
  }
  if (hasUnsafeContactOrLink(normalized)) {
    throw Object.assign(new Error('prompt must not contain contact details or links'), { status: 400 });
  }
  return normalized;
}

export function hasUnsafeContactOrLink(value) {
  if (typeof value !== 'string') return false;
  return CONTACT_OR_LINK_PATTERNS.some((pattern) => pattern.test(value));
}

export function templateGuidance(templateId) {
  return TEMPLATE_GUIDANCE[templateId] ?? TEMPLATE_GUIDANCE.custom;
}

export function isTemplateShapeValid(game, templateId) {
  if (!game || !Array.isArray(game.questions)) return false;
  if (game.questions.length < 3 || game.questions.length > 5) return false;
  if (templateId === 'rapid-choice') {
    return game.questions.every((question) => Array.isArray(question.options) && question.options.length === 2);
  }
  if (templateId === 'profile-riddle') {
    return game.questions.length === 3 && game.questions.every(
      (question) => Array.isArray(question.options) && question.options.length >= 3,
    );
  }
  if (templateId === 'keyword-wheel') {
    const labels = game.questions.map((question) => question.label?.trim()).filter(Boolean);
    return labels.length === game.questions.length && new Set(labels).size === labels.length;
  }
  return true;
}

function uniqueStrings(values, limit) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

export function buildTemplateMechanics(game, templateId) {
  if (templateId === 'profile-riddle') {
    return {
      kind: 'profile-riddle',
      keywordOptions: uniqueStrings([
        ...game.questions.flatMap((question) => question.options),
        '真诚', '有趣', '细腻', '有分寸', '热爱生活', '有好奇心',
      ], 12),
      sentencePattern: '我猜你是一个「关键词一」、有点「关键词二」，还很「关键词三」的人。',
    };
  }
  if (templateId === 'keyword-wheel') {
    return {
      kind: 'keyword-wheel',
      segments: game.questions.map((question, index) => ({
        id: question.id,
        keyword: question.label || game.topics[index % game.topics.length],
        prompt: question.prompt,
        followUp: question.differentFollowUp,
      })),
    };
  }
  if (templateId === 'rapid-choice') {
    return { kind: 'rapid-choice', roundSeconds: 5 };
  }
  return { kind: 'custom' };
}
