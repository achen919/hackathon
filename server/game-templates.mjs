import {
  buildExclusiveMechanics,
  buildExclusiveSeriesPrompt,
  publicExclusiveSeriesCatalog,
  requireExclusiveSeries,
} from './exclusive-series.mjs';

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
    available: true,
    description: '从五个稳定系列中选择一套包装，再根据公开聊天生成三轮轮流猜答的专属题卡。',
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

const SENSITIVE_GAME_TOPIC_PATTERN = new RegExp([
  '手机号|微信号|联系方式|住址|精确地址|身份证|银行卡',
  '收入|工资|月薪|年薪|薪资|到手|存款|负债|资产|房产|车产|房贷|车贷|经济状况|消费水平',
  '疾病|病史|服药|看病|住院|手术|慢性病|身体状况|健康状况|长期不舒服|身体.{0,6}不舒服|过敏|抑郁|焦虑|心理咨询|失眠',
  '性经历|性偏好|宗教信仰|政治立场|生育计划|彩礼|婚前财产',
  '婚史|离异|离婚|已婚|未婚|丧偶|前任|单亲|有娃|有孩子',
  '年龄|身高|体重|职业|公司|单位|学校|学历|户籍|籍贯',
  '和谁一起住|跟谁一起住|独居|合租|室友|住在哪|住哪里|小区|门牌',
].join('|'), 'i');

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
  custom: `严格生成“专属小游戏”：
- templateId 固定为 custom，并严格遵循服务端指定的 seriesId 和系列内容骨架。
- 固定三轮，每轮由一方私密作答、另一方猜测，下一轮交换角色。
- 每轮提供 3-4 个互斥、无优劣的短选项；猜中是同频高光，猜错是新话题，不累计分数。
- 只抽象公开聊天主题和允许的非敏感信号，不复述原始资料、记忆或敏感原句。`,
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
      ...(template.id === 'custom' ? { series: publicExclusiveSeriesCatalog() } : {}),
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

export function buildPromptPreview(match, gameType, selection = {}) {
  const template = templateForId(gameType.id);
  if (!template) throw new Error('Unknown game template');
  if (template.id === 'custom') {
    return buildExclusiveSeriesPrompt(match, requireExclusiveSeries(selection.seriesId).seriesId);
  }
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

export function hasUnsafeGameText(value) {
  return typeof value === 'string' && (
    SENSITIVE_GAME_TOPIC_PATTERN.test(value) || hasUnsafeContactOrLink(value)
  );
}

export function templateGuidance(templateId, seriesId) {
  if (templateId !== 'custom') return TEMPLATE_GUIDANCE[templateId] ?? TEMPLATE_GUIDANCE.custom;
  if (!seriesId) return TEMPLATE_GUIDANCE.custom;
  const series = requireExclusiveSeries(seriesId);
  return `${TEMPLATE_GUIDANCE.custom}\n\n本次系列：${series.title}\n系列 ID：${series.seriesId}\n版本键：${series.templateKey}\n${series.generationBrief}`;
}

export function isTemplateShapeValid(game, templateId, seriesId) {
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
  if (templateId === 'custom') {
    requireExclusiveSeries(seriesId);
    return game.questions.length === 3 && game.questions.every(
      (question) => Array.isArray(question.options) && question.options.length >= 3 && question.options.length <= 4,
    );
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

export function buildTemplateMechanics(game, templateId, seriesId) {
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
  if (templateId === 'custom') return buildExclusiveMechanics(requireExclusiveSeries(seriesId).seriesId);
  return { kind: 'custom' };
}
