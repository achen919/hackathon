import type { GamePromptPreview, GameTypeOption, MatchPayload } from '../types';

export const DEFAULT_GAME_TYPES: GameTypeOption[] = [
  {
    id: 'profile-riddle', templateId: 'profile-riddle', label: '资料猜谜局', enabled: true, available: true,
    description: '从非敏感资料提炼候选词，选三个词拼成一句话，猜对方是什么样的人。',
  },
  {
    id: 'keyword-wheel', templateId: 'keyword-wheel', label: '关键词深挖', enabled: true, available: true,
    description: '把公开聊天里的共同话题放进转盘，随机抽一个再从轻到深追问。',
  },
  {
    id: 'rapid-choice', templateId: 'rapid-choice', label: '极限2选1', enabled: true, available: true,
    description: '双方分别在五秒内完成二选一，最后一起对照答案并继续聊。',
  },
  {
    id: 'custom', templateId: 'custom', label: '专属小游戏', enabled: true, available: true,
    description: '编辑一句 Prompt，系统会将公开聊天线索变成三轮可玩互动；案例页直接试玩，无需登录。',
  },
];

const topicWords = ['博物馆', '逛展', '徒步', '爬山', '做饭', '摄影', '旅行', '咖啡', '电影', '音乐', '运动', '阅读', '宠物', '周末'];

export function buildLocalPromptPreview(match: MatchPayload, option: GameTypeOption): GamePromptPreview {
  const chat = match.messages.map((message) => message.content).join(' ');
  const topics = topicWords.filter((topic) => chat.includes(topic)).slice(0, 3);
  const stage = match.messages.length <= 6
    ? '刚刚认识，适合非常轻的开场'
    : match.messages.length <= 24
      ? '正在熟悉彼此，可以从共同点进入日常偏好'
      : '已经有连续对话，可以在不越界的前提下多问一层原因';
  const mechanics = option.id === 'profile-riddle'
    ? '让双方分别从中性资料关键词中选择三个词，拼成一句印象描述；两人完成后一起揭晓。'
    : option.id === 'keyword-wheel'
      ? '生成 3–5 个公开聊天关键词作为转盘扇区，每个关键词配一条轻量追问。'
      : option.id === 'rapid-choice'
        ? '生成 3–5 道五秒二选一，每题严格两个短选项，结束后引导双方解释为什么选择 A 或 B。'
        : '固定生成 3 轮可玩互动：左右滑卡、情绪刻度和星球轨道。可根据 Prompt 调整主题、场景和交互顺序，但只使用公开聊天线索。';
  return {
    templateId: option.id,
    label: option.label,
    available: option.available,
    description: option.description,
    maxLength: 1_500,
    prompt: `请为这两位用户生成一局「${option.label}」。\n\n关系阶段：${stage}。\n公开线索：${topics.length > 0 ? topics.join('、') : '聊天主题还不多，请从轻松日常开始'}。\n\n${mechanics}\n\n语气轻松，题面简短，双方都可以跳过；不输出匹配分数、私密资料或关系结论。`,
  };
}

const profileKeywordRules: Array<[RegExp, string]> = [
  [/阅读|书|文学/, '爱阅读'], [/摄影|拍照/, '会观察'], [/旅行|徒步|爬山/, '爱探索'],
  [/做饭|烹饪|美食/, '有生活感'], [/运动|跑步|健身/, '有行动力'], [/电影|音乐|展览|博物馆/, '有审美'],
  [/计划|规划|自律/, '有计划'], [/温柔|细腻|体贴/, '细腻'], [/真诚|坦诚/, '真诚'],
  [/幽默|有趣/, '有趣'], [/倾听|沟通/, '会倾听'], [/好奇|学习/, '有好奇心'],
];

export function profileKeywords(profile: string, generated: string[] = []) {
  const fromProfile = profileKeywordRules.filter(([pattern]) => pattern.test(profile)).map(([, label]) => label);
  return [...new Set([...fromProfile, ...generated, '真诚', '有趣', '细腻', '有分寸', '热爱生活', '松弛'])]
    .filter((value) => value.length <= 24)
    .slice(0, 12);
}
