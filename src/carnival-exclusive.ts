import type { CarnivalTextMessage } from './carnival-types';

export type CarnivalExclusiveSeriesId =
  | 'prompt-arcade'
  | 'courtside'
  | 'chat-archaeology'
  | 'weekend-studio'
  | 'contrast-lab'
  | 'future-trailer';

export type CarnivalExclusiveTone = 'coral' | 'violet' | 'mint' | 'gold' | 'blue';

export interface CarnivalExclusiveSeries {
  id: CarnivalExclusiveSeriesId;
  templateKey: string;
  title: string;
  shortTitle: string;
  icon: string;
  tone: CarnivalExclusiveTone;
  eyebrow: string;
  description: string;
  duration: string;
  tags: string[];
  generationBrief: string;
  matchedEyebrow: string;
  matchedTitle: string;
  differentEyebrow: string;
  differentTitle: string;
  resultUnit: string;
}

export interface CarnivalExclusiveRecommendation {
  seriesId: CarnivalExclusiveSeriesId;
  reason: string;
}

export const CARNIVAL_EXCLUSIVE_SERIES: readonly CarnivalExclusiveSeries[] = Object.freeze([
  {
    id: 'prompt-arcade',
    templateKey: 'exclusive_game_prompt_arcade_v1',
    title: 'AI 游戏工坊 · 说一句就生成真游戏',
    shortTitle: 'AI 游戏工坊',
    icon: '◇',
    tone: 'blue',
    eyebrow: 'Prompt → HTML/CSS/JS',
    description: '写下篮球、合作冒险或策略等想法，AI 会现场编写完整游戏代码；试玩满意后把同一版本发给 TA。',
    duration: '实时操作 · 约 1–3 分钟',
    tags: ['AI 生成代码', '真实操作', '双端同步'],
    generationBrief: '根据可编辑 Prompt 生成一份自包含 HTML/CSS/JavaScript 游戏，使用 PairPlay v1 接入服务端角色、操作、比分和同步；代码只能在无同源权限、无网络能力的沙箱中执行。',
    matchedEyebrow: '你们触发了同一种反馈',
    matchedTitle: '这一关默契同步',
    differentEyebrow: '游戏解锁一条新分支',
    differentTitle: '两个选择都让剧情继续',
    resultUnit: '个专属互动关卡',
  },
  {
    id: 'courtside',
    templateKey: 'exclusive_game_courtside_v1',
    title: '默契篮球 · 双人攻防',
    shortTitle: '默契篮球',
    icon: '◉',
    tone: 'coral',
    eyebrow: '模拟篮球',
    description: '把聊天线索变成三节小比赛：选主场、喊暂停、打最后一球。猜中算进球，猜错算助攻。',
    duration: '3 节 · 约 3 分钟',
    tags: ['有画面', '轮流猜'],
    generationBrief: '模拟篮球比赛包装；三轮分别为选主场、暂停暗号、绝杀配合；同频叫进球，差异叫助攻；禁止计分和输赢评价。',
    matchedEyebrow: '这一球命中同一处',
    matchedTitle: '默契进球',
    differentEyebrow: '换个角度也是配合',
    differentTitle: '送出一次新助攻',
    resultUnit: '个战术回合',
  },
  {
    id: 'chat-archaeology',
    templateKey: 'exclusive_game_chat_archaeology_v1',
    title: '聊天考古队 · 挖出未完待续',
    shortTitle: '聊天考古队',
    icon: '⌁',
    tone: 'violet',
    eyebrow: '聊天回看优选',
    description: '不考原句背诵，把公开聊过的话题重新翻出来，看看哪一条最想继续。',
    duration: '3 铲 · 约 4 分钟',
    tags: ['话题回看', '不翻隐私'],
    generationBrief: '聊天考古包装；只抽象公开对话主题，不判断真实高光或复述敏感原句；三轮为话题碎片、想继续的支线、一句话注释。',
    matchedEyebrow: '挖到同一块碎片',
    matchedTitle: '这段话题你们都想继续',
    differentEyebrow: '遗址出现两条支线',
    differentTitle: '各自收藏了不同线索',
    resultUnit: '条聊天线索',
  },
  {
    id: 'weekend-studio',
    templateKey: 'exclusive_game_weekend_studio_v1',
    title: '周末制片厂 · 合拍一支短片',
    shortTitle: '周末制片厂',
    icon: '▷',
    tone: 'mint',
    eyebrow: '计划猜猜看',
    description: '从开场、节奏和彩蛋猜 TA 会怎样安排，再把三轮答案拼成一版低压力的半日灵感。',
    duration: '3 幕 · 约 3 分钟',
    tags: ['计划猜猜看', '轻邀约'],
    generationBrief: '周末短片包装；用轮流答猜完成开场镜头、相处节奏、片尾彩蛋；只建议可拒绝、可调整的低压力计划。',
    matchedEyebrow: '镜头刚好合拍',
    matchedTitle: '这一幕可以直接开拍',
    differentEyebrow: '剪出两个有趣版本',
    differentTitle: '故事突然多了一条线',
    resultUnit: '个故事镜头',
  },
  {
    id: 'contrast-lab',
    templateKey: 'exclusive_game_contrast_lab_v1',
    title: '反差实验室 · 解锁另一面',
    shortTitle: '反差实验室',
    icon: '◒',
    tone: 'gold',
    eyebrow: '认识感升级',
    description: '从充电方式、临时邀请和小小偏爱入手，看看熟悉印象之外还有什么新发现。',
    duration: '3 组样本 · 约 3 分钟',
    tags: ['反差感', '边界友好'],
    generationBrief: '轻量反差实验包装；只问可当场解释的生活偏好，不分析人格、不判断关系适配度。',
    matchedEyebrow: '观察结果一致',
    matchedTitle: '你捕捉到了这个小偏好',
    differentEyebrow: '出现一条新线索',
    differentTitle: '原来还有没聊过的一面',
    resultUnit: '组生活偏好',
  },
  {
    id: 'future-trailer',
    templateKey: 'exclusive_game_future_trailer_v1',
    title: '未来预告片 · 下一集会怎样',
    shortTitle: '未来预告片',
    icon: '✦',
    tone: 'blue',
    eyebrow: '暧昧但不催',
    description: '只往前想一小步：下一集聊什么、怎样同框、今天留什么彩蛋，不替关系下结论。',
    duration: '3 段预告 · 约 3 分钟',
    tags: ['低压力', '下一步'],
    generationBrief: '未来预告片包装；只设计一小步的假设场景，避免婚恋承诺、关系定义和施压式邀约。',
    matchedEyebrow: '下一集预告同频',
    matchedTitle: '你们想先看同一段剧情',
    differentEyebrow: '预告片开启双线叙事',
    differentTitle: '下一集有了两个好方向',
    resultUnit: '条下一集线索',
  },
]);

const TOPIC_WORDS = [
  '徒步', '爬山', '露营', '散步', '骑行', '逛展', '博物馆', '美术馆', '做饭', '探店',
  '咖啡', '电影', '音乐', '阅读', '旅行', '运动', '游戏', '宠物', '摄影', '周末',
];

export function exclusiveSeriesById(value: unknown) {
  return CARNIVAL_EXCLUSIVE_SERIES.find((series) => series.id === value) ?? null;
}

export function summarizeCarnivalTopics(messages: CarnivalTextMessage[]) {
  const publicChat = messages.map((message) => message.content).join(' ');
  return TOPIC_WORDS.filter((topic) => publicChat.includes(topic)).slice(0, 4);
}

export function recommendCarnivalExclusiveSeries(
  messages: CarnivalTextMessage[],
): CarnivalExclusiveRecommendation {
  const publicChat = messages.map((message) => message.content).join(' ');
  const topics = summarizeCarnivalTopics(messages);
  const topicText = topics.slice(0, 2).join('、');

  if (/(?:篮球|足球|羽毛球|网球|跑步|健身|运动|骑行)/.test(publicChat)) {
    return { seriesId: 'courtside', reason: '聊天里出现了运动或互动线索，适合用攻防包装热场。' };
  }
  if (messages.length >= 18 || topics.length >= 3) {
    return {
      seriesId: 'chat-archaeology',
      reason: `已经积累 ${messages.length} 条公开聊天${topicText ? `和「${topicText}」等话题` : ''}，适合回看想继续的支线。`,
    };
  }
  if (topics.some((topic) => ['徒步', '爬山', '露营', '散步', '骑行', '逛展', '博物馆', '美术馆', '做饭', '探店', '咖啡', '电影', '音乐', '阅读', '旅行', '摄影', '周末'].includes(topic))) {
    return {
      seriesId: 'weekend-studio',
      reason: `聊天里出现了「${topicText || topics[0]}」，适合把兴趣剪成三幕轻量计划。`,
    };
  }
  if (/(?:喜欢|习惯|平时|通常|偏向|更想|比较爱)/.test(publicChat)) {
    return { seriesId: 'contrast-lab', reason: '聊天里已有日常偏好表达，适合猜猜彼此还没聊到的小选择。' };
  }
  return {
    seriesId: 'future-trailer',
    reason: `你们已经交换 ${messages.length} 条公开消息，适合从低压力的“下一集”继续。`,
  };
}

export function buildCarnivalExclusivePrompt(
  seriesId: CarnivalExclusiveSeriesId,
  messages: CarnivalTextMessage[],
) {
  const series = exclusiveSeriesById(seriesId) ?? CARNIVAL_EXCLUSIVE_SERIES[0];
  const topics = summarizeCarnivalTopics(messages);
  const topicLine = topics.length > 0 ? topics.join('、') : '轻松日常、周末安排和聊天节奏';
  return [
    `请为我们生成一局「${series.title}」专属双人小游戏。`,
    `双方已经公开交换 ${messages.length} 条文字消息；可以使用的公开主题：${topicLine}。`,
    `系列模板：${series.generationBrief}`,
    '固定生成 3 轮；每轮包含一个问题、2–4 个互斥短选项、同频追问和差异追问；滑动牌组固定 2 项，转盘与星轨使用 3–4 项。',
    '双方轮流私密作答和猜测；未到共同揭晓阶段，不得向另一方返回答案。',
    '只使用公开聊天线索，不输出匹配度、输赢或人格结论，不替用户自动发送后续消息。',
  ].join('\n\n');
}
