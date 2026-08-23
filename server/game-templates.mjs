import {
  buildExclusiveMechanics,
  buildExclusiveSeriesPrompt,
  publicExclusiveSeriesCatalog,
  requireExclusiveSeries,
} from './exclusive-series.mjs';
import { PROMPT_GAME_ENGINE, isPromptGamePayload } from './prompt-game.mjs';

export const GAME_TEMPLATE_CATALOG = Object.freeze([
  Object.freeze({
    id: 'profile-riddle',
    defaultLabel: '资料猜谜局',
    available: true,
    description: '从公开资料延伸出三个生活小猜测，选完自然拼成一句，让 TA 很想接话。',
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
    description: '从稳定系列或 AI 游戏工坊出发，让 Prompt 在四种安全交互组件中组合三轮专属双人游戏。',
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
- 目标是制造“挺准 / 其实不是 / 我反而会……”的回应欲，不是判断性格、匹配度或关系。
- 一次调用同时生成 questionsByTarget.a 和 questionsByTarget.b，两套各固定 3 组候选，每组恰好 3 个选项；AI 只提供“可以怎么猜”，绝不替用户选择答案。
- questionsByTarget.a 只能根据 user_a.public_profile_signals 和 from=a 的公开聊天生成；questionsByTarget.b 只能根据 user_b.public_profile_signals 和 from=b 的公开聊天生成。不得把另一人的资料或发言当成当前 target 的依据。
- 每组使用一个不同的后台方向，id 必须从 profile-social-state、profile-communication、profile-weekend、profile-travel、profile-food、profile-interest、profile-life-pace、profile-decision、profile-date、profile-emotion 中选择，且三个 id 不重复。
- 后台方向只写入 id，不要把社交状态、沟通方式、周末状态、旅行方式、饮食方式、兴趣投入、生活节奏、决策方式、约会偏好、情绪表达这些维度名称写进 label、prompt、topics 或其他用户可见文案。
- 每个选项必须是约 4-10 个汉字、口语化且有场景动作的行为标签，例如“熟了以后话很多”“出门前会做点攻略”“为了吃会专门跑远”。
- 禁止宽泛人格词或结论，例如“慢热、外向、理性、随性、有计划、直率、真诚、有趣、细腻、松弛”；在这些词前后包装“平时很”或“做事比较”也不允许。
- 同组 3 个选项必须明显不同，不能用近义改写凑数；全部 9 个标签不得重复。
- 可以把 MBTI、星座、兴趣、资料照片描述、简介与公开聊天作为推断线索，但不能直接复述已知信息；例如不能把“ENFP”“喜欢旅行”“喜欢火锅”直接做成选项，也不得把已知信号包装在更长的标签中。
- 每组至少一个选项应与线索较贴近，其余选项也必须合理；不要标记或暗示正确答案，不要总把较贴近项放在同一位置。
- 禁止控制欲强、恋爱脑、妈宝、社恐、难搞、情绪化、不靠谱、黏人等评价、冒犯或诊断性标签。
- 资料不足时优先使用周末怎么过、吃饭怎么选、出门怎么安排、社交场合状态、做决定方式等低风险方向；不得编造职业、家庭、收入或恋爱经历。
- label 使用“小猜测一 / 小猜测二 / 小猜测三”这类中性名称；source 只写“根据公开资料延伸的轻松行为候选”；prompt 不得泄露后台方向或推断理由。
- matchedFollowUp / differentFollowUp 只邀请本人轻松纠正或补充，不输出心理分析、性格结论或关系建议。`,
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
- 除 prompt-arcade 外固定三轮，每轮由一方私密作答、另一方猜测，下一轮交换角色；prompt-arcade 改用其专属实时沙箱契约。
- 除 prompt-arcade 外声明式引擎固定为 ${PROMPT_GAME_ENGINE}；每轮从 card-grid、swipe-deck、mood-dial、orbit-pick 中选择一个交互和匹配 variant。
- swipe-deck 恰好 2 个选项；mood-dial / orbit-pick 为 3-4 个选项；card-grid 为 2-4 个选项。所有选项互斥且无优劣。
- 除 prompt-arcade 隔离 document 外，只允许 schema 中列出的 presentation token 和 ending 文案，不得输出 HTML、CSS、JavaScript、URL、资源路径、自定义组件、事件处理器或动作规则。
- 猜中是同频高光，猜错是新话题，不累计分数。
- 只抽象公开聊天主题和允许的非敏感信号，不复述原始资料、记忆或敏感原句。`,
});

export const PROFILE_RIDDLE_DIRECTION_IDS = Object.freeze([
  'profile-social-state',
  'profile-communication',
  'profile-weekend',
  'profile-travel',
  'profile-food',
  'profile-interest',
  'profile-life-pace',
  'profile-decision',
  'profile-date',
  'profile-emotion',
]);

const PROFILE_RIDDLE_DIRECTION_CATEGORY = Object.freeze({
  'profile-social-state': 'interaction',
  'profile-communication': 'interaction',
  'profile-weekend': 'planning',
  'profile-travel': 'planning',
  'profile-food': 'lifestyle',
  'profile-interest': 'lifestyle',
  'profile-life-pace': 'planning',
  'profile-decision': 'planning',
  'profile-date': 'interaction',
  'profile-emotion': 'interaction',
});

const PROFILE_RIDDLE_BROAD_LABEL_ROOTS = Object.freeze([
  '慢热', '外向', '内向', '理性', '感性', '随性', '有计划', '直率', '真诚',
  '细腻', '松弛', '有分寸', '热爱生活', '有好奇心', '有行动力', '会倾听',
  '乐观', '开朗', '大方', '温柔', '善良', '靠谱', '认真负责',
]);

const PROFILE_RIDDLE_INTERESTING_SCENE = /有趣(?:的)?(?:小店|店|地方|展览|展|电影|书|音乐|游戏|话题|活动|东西|故事|点子|路线|招牌|菜单|餐厅|体验|事情|内容|作品)/gu;

const PROFILE_RIDDLE_RISKY_LABEL = /控制欲|恋爱脑|妈宝|社恐|难搞|情绪化|不靠谱|黏人|强势|冷漠|自私|幼稚/u;

export function isProfileRiddleBehaviorLabel(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  const length = [...normalized].length;
  const comparable = normalized.replace(/[\s\p{P}\p{S}]+/gu, '');
  const withoutInterestingScene = comparable.replace(PROFILE_RIDDLE_INTERESTING_SCENE, '');
  return length >= 4 && length <= 12 &&
    !/[\r\n，。！？、；：,.!?;:]/u.test(normalized) &&
    !PROFILE_RIDDLE_BROAD_LABEL_ROOTS.some((root) => comparable.includes(root)) &&
    !withoutInterestingScene.includes('有趣') &&
    !PROFILE_RIDDLE_RISKY_LABEL.test(normalized) &&
    !/(?:的人|型人格|性格)$/u.test(normalized);
}

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
  if (series.seriesId === 'prompt-arcade') {
    return `严格生成“专属小游戏 · AI 游戏工坊”：
- schemaVersion 与权威状态由服务端补齐；模型只输出结构化 schema 要求的展示文案、五选一 preset、有界 tuning 和完整 document。
- document 是在无 allow-same-origin 的 CSP sandbox iframe 中执行的自包含 HTML/CSS/JavaScript，必须严格使用 PairPlay v1 bridge，不得联网、引用外部资源或读取父页 DOM。
- 模型生成的代码只负责画面、动画与输入采集；角色、允许 control、物理、比分、胜负和状态转换全部服从 host.init / host.sync，不得自行伪造。
- playMode=preview 时要在沙箱内提供本地对手模拟和完整可玩试玩；playMode=network 时只渲染服务端权威状态。
- 不得把聊天原文、用户资料或任何敏感信息写入代码和可见文案。

本次系列：${series.title}
系列 ID：${series.seriesId}
版本键：${series.templateKey}
${series.generationBrief}`;
  }
  return `${TEMPLATE_GUIDANCE.custom}\n\n本次系列：${series.title}\n系列 ID：${series.seriesId}\n版本键：${series.templateKey}\n${series.generationBrief}`;
}

export function isTemplateShapeValid(game, templateId, seriesId) {
  if (!game) return false;
  if (templateId === 'profile-riddle') {
    const validTargetQuestions = (questions) => {
      if (!Array.isArray(questions) || questions.length !== 3) return false;
      const directions = questions.map((question) => question?.id);
      const options = questions.flatMap((question) => question?.options ?? []);
      return new Set(directions).size === 3 &&
        new Set(directions.map((id) => PROFILE_RIDDLE_DIRECTION_CATEGORY[id])).size >= 2 &&
        directions.every((id) => PROFILE_RIDDLE_DIRECTION_IDS.includes(id)) &&
        questions.every((question) =>
          Array.isArray(question?.options) &&
          question.options.length === 3 &&
          question.options.every(isProfileRiddleBehaviorLabel)
        ) &&
        new Set(options.map((option) => option.trim())).size === 9;
    };
    if (game?.questionsByTarget !== undefined) {
      const byTarget = game.questionsByTarget;
      return Boolean(byTarget) &&
        typeof byTarget === 'object' &&
        !Array.isArray(byTarget) &&
        Object.keys(byTarget).length === 2 &&
        Object.hasOwn(byTarget, 'a') &&
        Object.hasOwn(byTarget, 'b') &&
        validTargetQuestions(byTarget.a) &&
        validTargetQuestions(byTarget.b);
    }
    return validTargetQuestions(game?.questions);
  }
  if (!Array.isArray(game.questions)) return false;
  if (game.questions.length < 3 || game.questions.length > 5) return false;
  if (templateId === 'rapid-choice') {
    return game.questions.every((question) => Array.isArray(question.options) && question.options.length === 2);
  }
  if (templateId === 'keyword-wheel') {
    const labels = game.questions.map((question) => question.label?.trim()).filter(Boolean);
    return labels.length === game.questions.length && new Set(labels).size === labels.length;
  }
  if (templateId === 'custom') {
    requireExclusiveSeries(seriesId);
    return isPromptGamePayload(game, { hasUnsafeText: hasUnsafeGameText });
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
    const toChoiceGroups = (questions) => questions.slice(0, 3).map((question) => ({
      id: question.id,
      options: uniqueStrings(question.options, 3),
    }));
    const choiceGroupsByTarget = game.questionsByTarget
      ? {
          a: toChoiceGroups(game.questionsByTarget.a),
          b: toChoiceGroups(game.questionsByTarget.b),
        }
      : {
          a: toChoiceGroups(game.questions),
          b: toChoiceGroups(game.questions),
        };
    const choiceGroups = choiceGroupsByTarget.b;
    return {
      kind: 'profile-riddle',
      choiceGroupsByTarget,
      choiceGroups,
      keywordOptions: choiceGroups.flatMap((group) => group.options),
      sentencePattern: '我觉得{昵称}是一个{猜测一}、{猜测二}，而且{猜测三}的人。',
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
