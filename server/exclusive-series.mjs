import { randomUUID } from 'node:crypto';
import {
  PROMPT_GAME_ENGINE,
  PROMPT_GAME_SCHEMA_VERSION,
  applyPromptGamePlan,
} from './prompt-game.mjs';

export const EXCLUSIVE_SERIES_IDS = Object.freeze([
  'courtside',
  'chat-archaeology',
  'weekend-studio',
  'contrast-lab',
  'future-trailer',
  'prompt-arcade',
]);

const SERIES = [
  {
    seriesId: 'courtside',
    templateKey: 'exclusive_game_courtside_v1',
    title: '默契篮球 · 双人攻防',
    shortTitle: '默契篮球',
    icon: '◉',
    tone: 'coral',
    eyebrow: '模拟篮球',
    description: '把公开聊天线索变成三节小比赛：选主场、喊暂停、打最后一球。猜中算进球，猜错算助攻。',
    duration: '3 节 · 约 3 分钟',
    tags: ['有画面', '轮流猜', '不计输赢'],
    generationBrief: '使用篮球攻防包装；三轮依次为选主场、暂停暗号、绝杀配合；同频叫进球，差异叫助攻；禁止计分和输赢评价。',
    matchedEyebrow: '这一球命中同一处',
    matchedTitle: '默契进球',
    differentEyebrow: '换个角度也是配合',
    differentTitle: '送出一次新助攻',
    resultUnit: '个战术回合',
  },
  {
    seriesId: 'chat-archaeology',
    templateKey: 'exclusive_game_chat_archaeology_v1',
    title: '聊天考古队 · 挖出未完待续',
    shortTitle: '聊天考古队',
    icon: '⌁',
    tone: 'violet',
    eyebrow: '聊天回看优选',
    description: '不考原句背诵，把公开聊过的话题重新翻出来，看看哪一条最想继续。',
    duration: '3 铲 · 约 4 分钟',
    tags: ['话题回看', '补话题', '不翻隐私'],
    generationBrief: '使用聊天考古包装；只抽象公开对话主题，不判断真实高光或复述敏感原句；三轮依次为话题碎片、想继续的支线、一句话注释。',
    matchedEyebrow: '挖到同一块碎片',
    matchedTitle: '这段话题你们都想继续',
    differentEyebrow: '遗址出现两条支线',
    differentTitle: '各自收藏了不同线索',
    resultUnit: '条聊天线索',
  },
  {
    seriesId: 'weekend-studio',
    templateKey: 'exclusive_game_weekend_studio_v1',
    title: '周末制片厂 · 合拍一支短片',
    shortTitle: '周末制片厂',
    icon: '▷',
    tone: 'mint',
    eyebrow: '计划猜猜看',
    description: '从开场、节奏和彩蛋猜 TA 会怎样安排，再把三轮答案拼成一版低压力的半日灵感。',
    duration: '3 幕 · 约 3 分钟',
    tags: ['计划猜猜看', '低压力', '可随时调整'],
    generationBrief: '使用周末短片包装；用轮流答猜完成开场镜头、相处节奏、片尾彩蛋；只建议可拒绝、可调整的低压力计划，不默认线下见面。',
    matchedEyebrow: '镜头刚好合拍',
    matchedTitle: '这一幕可以直接开拍',
    differentEyebrow: '剪出两个有趣版本',
    differentTitle: '故事突然多了一条线',
    resultUnit: '个故事镜头',
  },
  {
    seriesId: 'contrast-lab',
    templateKey: 'exclusive_game_contrast_lab_v1',
    title: '反差实验室 · 解锁另一面',
    shortTitle: '反差实验室',
    icon: '◒',
    tone: 'gold',
    eyebrow: '认识感升级',
    description: '从充电方式、临时安排和日常偏爱入手，在已有印象之外发现一点新线索。',
    duration: '3 组样本 · 约 3 分钟',
    tags: ['生活偏好', '边界友好', '不贴标签'],
    generationBrief: '使用轻量反差实验包装；只问可由本人当场解释的生活偏好，不分析人格、依恋类型或关系适配度。',
    matchedEyebrow: '观察结果一致',
    matchedTitle: '你捕捉到了这个小偏好',
    differentEyebrow: '出现一条新线索',
    differentTitle: '原来还有没聊过的一面',
    resultUnit: '组生活偏好',
  },
  {
    seriesId: 'future-trailer',
    templateKey: 'exclusive_game_future_trailer_v1',
    title: '未来预告片 · 下一集会怎样',
    shortTitle: '未来预告片',
    icon: '✦',
    tone: 'blue',
    eyebrow: '轻轻向前',
    description: '只往前想一小步：下一集聊什么、怎样相处、今天留什么彩蛋，不替关系下结论。',
    duration: '3 段预告 · 约 3 分钟',
    tags: ['低压力', '下一步', '不催表态'],
    generationBrief: '使用未来预告片包装；只设计一小步的假设场景，避免婚恋承诺、关系定义、交换联系方式和施压式邀约。',
    matchedEyebrow: '下一集预告同频',
    matchedTitle: '你们想先看同一段剧情',
    differentEyebrow: '预告片开启双线叙事',
    differentTitle: '下一集有了两个好方向',
    resultUnit: '条下一集线索',
  },
  {
    seriesId: 'prompt-arcade',
    // Kept stable so already-persisted v2/v3 prompt-arcade invitations remain playable.
    templateKey: 'exclusive_game_prompt_arcade_v1',
    title: 'AI 游戏工坊 · 说一句就开局',
    shortTitle: 'AI 游戏工坊',
    icon: '◇',
    tone: 'blue',
    eyebrow: 'Prompt 现场生成',
    description: '写下想玩的主题和感觉，AI 会现场编写完整 HTML/CSS/JavaScript，生成有操控、有动画和胜负反馈的双人小游戏。',
    duration: '实时双人局 · 约 1 分钟',
    tags: ['AI 生成代码', '真实操控', '双端同步'],
    generationBrief: '只允许从 competition/dash-duel、cooperation/tandem-rescue、sport/basketball-duel、adventure/relic-expedition、strategy/grid-command 五组固定引擎中选择；篮球主题必须选择 sport/basketball-duel。模型输出严格枚举、展示文案、有界 tuning 和一份自包含 HTML/CSS/JavaScript document；document 只能使用 PairPlay v1，不得联网、引用 URL、读取父页 DOM 或自定权威角色、物理、比分和胜负。playMode=preview 时本地模拟另一角色，playMode=network 时只渲染服务端同步。',
    matchedEyebrow: '双人操作已经同步',
    matchedTitle: '这一局配合起来了',
    differentEyebrow: '对抗产生新的变化',
    differentTitle: '下一回合还有机会',
    resultUnit: '局真实双人游戏',
  },
];

export const EXCLUSIVE_SERIES_CATALOG = Object.freeze(
  SERIES.map((series) => Object.freeze({ ...series, tags: Object.freeze([...series.tags]) })),
);

const TOPICS = [
  { label: '户外走走', activity: '去走一条轻松路线', scene: '边走边聊的户外半日', keywords: ['徒步', '爬山', '露营', '户外', '散步', '骑行', '公园'] },
  { label: '逛展看馆', activity: '挑一个展慢慢逛', scene: '从一件展品聊开的下午', keywords: ['博物馆', '美术馆', '逛展', '看展', '展览', '建筑'] },
  { label: '吃饭做饭', activity: '一起解锁一道喜欢的味道', scene: '围绕一顿饭展开的小计划', keywords: ['做饭', '下厨', '吃饭', '美食', '探店', '火锅', '甜品'] },
  { label: '咖啡小坐', activity: '找家安静的店坐坐', scene: '不赶时间的咖啡店聊天', keywords: ['咖啡', '咖啡店', '茶馆', '下午茶', '喝茶'] },
  { label: '电影追剧', activity: '互换一部最近想看的片', scene: '看完还能继续讨论的放映夜', keywords: ['电影', '影院', '追剧', '电视剧', '综艺', '纪录片', '动漫'] },
  { label: '音乐歌单', activity: '互换三首循环歌曲', scene: '用一张歌单交换最近心情', keywords: ['音乐', '歌单', '歌曲', '演唱会', '乐队'] },
  { label: '阅读充电', activity: '交换一本最近翻过的书', scene: '各自安静也不尴尬的阅读时段', keywords: ['阅读', '看书', '书店', '小说', '读书'] },
  { label: '旅行出发', activity: '选一座想了解的小城', scene: '不用立刻出发的旅行脑洞', keywords: ['旅行', '旅游', '城市', '海边'] },
  { label: '运动开局', activity: '安排一场轻量运动局', scene: '带一点互动但不较真的运动局', keywords: ['篮球', '足球', '羽毛球', '网球', '健身', '跑步', '瑜伽', '运动'] },
  { label: '游戏搭子', activity: '挑一个双人小游戏', scene: '有来有回的轻松游戏夜', keywords: ['游戏', '桌游', '密室', '电竞', '开黑'] },
  { label: '毛茸茸', activity: '分享一张喜欢的萌宠照片', scene: '被毛茸茸治愈的闲聊时间', keywords: ['猫', '狗', '宠物', '小动物'] },
  { label: '拍照记录', activity: '分享一张今天喜欢的照片', scene: '用照片讲一个当天的小故事', keywords: ['摄影', '拍照', '相机', '照片', '镜头'] },
];

const FALLBACK_TOPICS = [
  { label: '周末安排', activity: '留半天随心安排', scene: '松弛、不赶场的周末半日', mentions: 0, score: 0 },
  { label: '日常节奏', activity: '分享一件当天的小事', scene: '从普通日常继续往下聊', mentions: 0, score: 0 },
  { label: '聊天偏好', activity: '再交换一个认真回答', scene: '没有标准答案的慢慢了解', mentions: 0, score: 0 },
  { label: '轻量下一步', activity: '留一个下次可以继续的话题', scene: '随时可以调整的小小下一站', mentions: 0, score: 0 },
];

function textMessages(match) {
  return Array.isArray(match?.messages)
    ? match.messages.filter((message) => message?.type === 'text' && typeof message.content === 'string' && message.content.trim())
    : [];
}

export function rankExclusiveTopics(match) {
  const messages = textMessages(match);
  const ranked = TOPICS.map((topic) => {
    let mentions = 0;
    let score = 0;
    messages.forEach((message, index) => {
      const hits = topic.keywords.reduce((total, keyword) => total + (message.content.includes(keyword) ? 1 : 0), 0);
      if (!hits) return;
      mentions += 1;
      score += hits + (messages.length > 1 ? index / (messages.length - 1) : 1) * 0.35;
    });
    return { ...topic, mentions, score };
  }).filter((topic) => topic.mentions > 0)
    .sort((left, right) => right.score - left.score || right.mentions - left.mentions);
  return [...ranked, ...FALLBACK_TOPICS].slice(0, 4);
}

export function exclusiveSeriesForId(value) {
  return EXCLUSIVE_SERIES_CATALOG.find((series) => series.seriesId === value) ?? null;
}

export function requireExclusiveSeries(value) {
  const series = typeof value === 'string' ? exclusiveSeriesForId(value.trim()) : null;
  if (!series) {
    const error = new Error('Unsupported exclusive game series');
    error.status = 400;
    error.code = 'INVALID_GAME_SERIES';
    throw error;
  }
  return series;
}

export function publicExclusiveSeriesCatalog() {
  return EXCLUSIVE_SERIES_CATALOG.map((series) => ({
    seriesId: series.seriesId,
    templateKey: series.templateKey,
    title: series.title,
    shortTitle: series.shortTitle,
    icon: series.icon,
    tone: series.tone,
    eyebrow: series.eyebrow,
    description: series.description,
    duration: series.duration,
    tags: [...series.tags],
  }));
}

function source(topic) {
  return topic.mentions > 0
    ? `来自公开聊天里出现过的「${topic.label}」`
    : `从安全的「${topic.label}」开始，不调用私密资料`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].slice(0, 4);
}

function options(values, fallbacks) {
  return unique([...values, ...fallbacks]).slice(0, 4);
}

function question(id, label, questionSource, prompt, questionOptions, matchedFollowUp, differentFollowUp) {
  return { id, label, source: questionSource, prompt, options: questionOptions, matchedFollowUp, differentFollowUp };
}

function courtside(topics) {
  return [
    question('courtside-tipoff', '第一节 · 选主场', source(topics[0]), '如果今天由 TA 安排轻松时光，第一站更可能放在哪里？', options(topics.slice(0, 3).map((topic) => topic.activity), ['找家店坐坐', '边走边聊', '宅家充电', '临场决定']), '第一球想到一起了。这个主场有没有一个更具体的画面？', '这次判断不同，却发现了新战术。为什么这一站更吸引你？'),
    question('courtside-timeout', '第二节 · 暂停暗号', '把公开聊过的日常节奏变成一张队友说明书', 'TA 状态不在线时，最舒服的“暂停战术”更像哪一种？', ['先听 TA 说一会儿', '发点好玩的转移注意', '给一点安静空间', '直接问现在需要什么'], '暂停暗号对上了。你通常会怎样表达自己的状态？', '战术不同也能配合。什么信号会让你知道该靠近还是留白？'),
    question('courtside-buzzer', '第三节 · 绝杀配合', source(topics[1]), '只留一次轻松的配合机会，TA 更愿意把它用在哪件小事上？', options(topics.slice(1).map((topic) => topic.activity), ['交换一首循环歌曲', '分享一张今日照片', '把一个话题聊完', '约下次继续']), '这记球两个人都看懂了。可以从哪个最小步骤开始？', '一个想投篮、一个想助攻。怎样调整会让两个人都舒服？'),
  ];
}

function archaeology(topics) {
  return [
    question('archaeology-highlight', '第一铲 · 话题碎片', '从完整公开聊天中整理主题，不判断哪一段是真实高光', '回看这段聊天，哪类内容更值得继续追问？', options(topics.map((topic) => topic.label), ['彼此的日常', '一个想补完的故事', '轻松玩笑', '新的兴趣']), '你们捡起了同一块碎片。它最值得继续问的细节是什么？', '原来你们各自收藏了不同片段。你想先听哪一个？'),
    question('archaeology-open-loop', '第二铲 · 想继续的支线', source(topics[0]), '如果只能认领一个想继续聊的话题，TA 会先选哪一个？', options(topics.map((topic) => `继续聊${topic.label}`), ['补完一个小故事', '交换最近的新发现', '留一个下次问题', '聊聊今天']), '这个话题两个人都想继续。现在最想补问哪一句？', '你们标记了两条支线。可以先听听 TA 为什么选了这一条。'),
    question('archaeology-caption', '第三铲 · 一句话注释', '给当前聊天留一句不夸张、也不下结论的注释', 'TA 会给目前的聊天状态贴上哪张便签？', ['越聊越自然', '还有很多待解锁', '慢一点也很舒服', '偶尔卡住但愿意继续'], '阶段注释也对上了。是什么小事让你有这种感觉？', '两张便签都可以是真的。你希望下一段聊天更靠近哪种状态？'),
  ];
}

function weekendStudio(topics) {
  return [
    question('studio-opening', '第一幕 · 开场镜头', source(topics[0]), '如果把半天空闲拍成一支短片，TA 会选哪个开场？', options(topics.map((topic) => topic.scene), ['睡到自然醒再决定', '先聊聊再临场发挥', '各忙一会儿晚点继续', '从一顿饭慢慢开始']), '开场镜头一致。你脑海里的时间和场景是什么？', '两种开场可以剪在一起。哪一种更像你理想中的节奏？'),
    question('studio-pace', '第二幕 · 节奏选择', '不把共同计划做成任务清单，先对齐舒服程度', '这支“周末片”的节奏，TA 更可能选哪一种？', ['只安排一个重点', '两件小事刚刚好', '多体验几个地方', '完全随缘不做计划'], '节奏感对上了。你觉得“刚刚好”的一天通常什么样？', '节奏不同不等于不能同行。你最希望保留的自由度是什么？'),
    question('studio-ending', '第三幕 · 彩蛋结尾', source(topics[1]), '结束前留一个可选彩蛋，TA 最想选什么？', ['分享一张当天照片', '交换一首此刻的歌', '留一个下次问题', '再散步或聊十分钟'], '彩蛋也选到一起了。这个小动作可以怎样自然开始？', '彩蛋可以有两个版本。你愿意先试哪一个？'),
  ];
}

function contrastLab(topics) {
  return [
    question('contrast-recharge', '样本一 · 充电方式', source(topics[0]), '忙碌的一天结束后，TA 更可能用哪种方式恢复电量？', ['一个人安静待会儿', '找熟悉的人聊聊', '出门动一动', '投入一件小爱好'], '你捕捉到了 TA 的充电方式。最近一次这样回血是什么时候？', '反差样本出现了。这个答案和平时给人的印象有什么不同？'),
    question('contrast-spontaneous', '样本二 · 临时起意', source(topics[1]), '面对当天才出现的一项轻松安排，TA 最可能怎样反应？', ['有兴趣就立刻开始', '先看精力再决定', '更喜欢提前知道', '熟悉的人发起更容易答应'], '临时起意的阈值也猜中了。什么样的安排最容易让你答应？', '这条边界值得记住。提前多久会让你觉得更舒服？'),
    question('contrast-soft-spot', '样本三 · 小小偏爱', '只聊普通日常，不把答案上升为人格判断', '哪种不起眼的小事最容易让 TA 心情变好？', options(topics.map((topic) => topic.activity), ['收到一句具体回应', '发现一家顺路小店', '计划外多一点空闲', '有人记得刚聊过的小事']), '这份小偏爱被看见了。最近一次因此开心是什么时候？', '原来还有这个小偏爱。你还会被什么普通小事治愈？'),
  ];
}

function futureTrailer(topics) {
  return [
    question('trailer-next-episode', '预告一 · 下一集', source(topics[0]), '如果你们的聊天要更新“下一集”，TA 更想先看到什么内容？', options(topics.map((topic) => `继续聊${topic.label}`), ['补完一个没讲完的话题', '交换一天里的小瞬间', '玩一局轻量游戏', '自然聊天不赶进度']), '下一集标题想到一起了。最小的一步可以从什么开始？', '两条内容线都可以保留。你更想先听 TA 解释哪一条？'),
    question('trailer-day-off', '预告二 · 同框方式', source(topics[1]), '假设以后刚好都有空，TA 更喜欢怎样共度一段时间？', ['一起做一件具体的事', '边走边聊不设目标', '各做各的也很自在', '先短暂相处，舒服再继续'], '相处方式对上了。什么细节会让那段时间更自然？', '未来不必一次定稿。哪种折中版本会让两个人都轻松？'),
    question('trailer-easter-egg', '预告三 · 片尾彩蛋', '只生成低压力的下一步，不催促关系表态', '如果给今天留一个片尾彩蛋，TA 会选哪一个？', ['晚点分享一首歌', '明天分享一张照片', '记住一个下次问题', '说一句今天聊得不错'], '彩蛋同步出现了。这个可以很自然地放进下一条消息。', '两个彩蛋都很轻。你愿意把自己的版本告诉 TA 吗？'),
  ];
}

function promptArcade(topics) {
  return [
    question('arcade-opening', '第一关 · 主题入口', source(topics[0]), '如果这局从一个轻松主题开场，TA 最可能先点哪一个？', options(topics.map((topic) => topic.label), ['周末灵感', '日常小事', '最近兴趣', '聊天彩蛋']), '第一关触发了相同入口。这个主题里最想先分享哪件事？', '你们打开了两条支线。为什么这一条更吸引你？'),
    question('arcade-rhythm', '第二关 · 相处节奏', '把玩法落在可当场解释的日常偏好，不判断人格或关系', 'TA 玩双人小游戏时，更喜欢哪一种节奏？', ['快速凭直觉选择', '慢一点想清楚', '轮流带对方探索', '边玩边聊原因'], '节奏同步了。什么细节会让这种互动更舒服？', '不同节奏也可以组队。怎样组合会让两个人都自在？'),
    question('arcade-bonus', '第三关 · 彩蛋出口', source(topics[1]), '完成这局后，TA 更想把哪个彩蛋留进聊天？', options(topics.slice(1).map((topic) => `继续聊${topic.label}`), ['交换一个最近发现', '补完一个小故事', '留一道下次问题', '分享今天的小瞬间']), '彩蛋也选到一起了。可以从哪一句自然开始？', '两个彩蛋都值得保留。你想先听 TA 讲哪一个？'),
  ];
}

const QUESTION_BUILDERS = {
  courtside,
  'chat-archaeology': archaeology,
  'weekend-studio': weekendStudio,
  'contrast-lab': contrastLab,
  'future-trailer': futureTrailer,
  'prompt-arcade': promptArcade,
};

export function buildExclusiveSeriesPrompt(match, seriesId) {
  const series = requireExclusiveSeries(seriesId);
  const topics = rankExclusiveTopics(match);
  const publicTopicLine = topics.filter((topic) => topic.mentions > 0).map((topic) => topic.label).join('、') || '周末安排、日常节奏';
  const count = textMessages(match).length;
  if (series.seriesId === 'prompt-arcade') {
    return `做一个以「${publicTopicLine}」为轻量视觉灵感、真正可以操作的双人街机小游戏。默认选择篮球投篮与移动篮筐的 sport/basketball-duel；如果玩家编辑的偏好明确要求竞技、合作、冒险或策略，再选择对应固定 preset。必须有持续动画、即时操作和清楚反馈，不能做成问答、滑卡或文字选择题。试玩模式由沙箱本地 AI 接管另一角色，正式联机只服从服务端权威状态。当前可参考 ${count} 条公开聊天，只抽象安全主题，不把聊天原文或个人资料写进代码。`;
  }
  return `请生成「${series.title}」专属双人小游戏。\n\n已读取 ${count} 条公开文本聊天；可使用的公开主题：${publicTopicLine}。\n\n系列 ID：${series.seriesId}\n内容模板：${series.generationBrief}\n\n引擎固定为 ${PROMPT_GAME_ENGINE}，固定生成 3 轮。每轮必须选择 card-grid、swipe-deck、mood-dial、orbit-pick 之一：swipe-deck 恰好 2 个选项，mood-dial / orbit-pick 为 3-4 个选项，card-grid 为 2-4 个选项。还要生成受限 presentation token 与 ending 文案。只输出指定 JSON，绝不输出 HTML、CSS、JavaScript、URL、自定义组件或动作规则。只使用公开聊天和服务端允许的非敏感信号，不输出匹配度、输赢或人格结论，不替用户表白、承诺、交换联系方式或自动发送消息。`;
}

export function buildExclusiveMechanics(seriesId) {
  const series = requireExclusiveSeries(seriesId);
  return {
    kind: 'exclusive-series',
    seriesId: series.seriesId,
    templateKey: series.templateKey,
    engine: PROMPT_GAME_ENGINE,
    matchedEyebrow: series.matchedEyebrow,
    matchedTitle: series.matchedTitle,
    differentEyebrow: series.differentEyebrow,
    differentTitle: series.differentTitle,
    resultUnit: series.resultUnit,
  };
}

export function buildExclusiveFallbackGame(match, seriesId, gameLabel = '专属小游戏', selection = {}) {
  const series = requireExclusiveSeries(seriesId);
  const topics = rankExclusiveTopics(match);
  const observed = topics.filter((topic) => topic.mentions > 0);
  const topicLine = observed.length ? observed.slice(0, 2).map((topic) => `「${topic.label}」`).join('和') : null;
  const prompt = typeof selection?.prompt === 'string' ? selection.prompt : '';
  const planned = applyPromptGamePlan(QUESTION_BUILDERS[series.seriesId](topics), prompt, series.seriesId);
  return {
    schemaVersion: PROMPT_GAME_SCHEMA_VERSION,
    engine: PROMPT_GAME_ENGINE,
    id: randomUUID(),
    matchId: match.match_id,
    templateId: 'custom',
    seriesId: series.seriesId,
    gameType: gameLabel,
    title: series.title,
    eyebrow: `${series.eyebrow} · 专属小游戏`,
    description: series.description,
    whyItFits: topicLine
      ? `从你们公开聊过的${topicLine}开始，三轮都没有标准答案。`
      : '当前明确共同主题不多，因此从通用暖场题开始，不伪造聊天依据。',
    estimatedMinutes: series.seriesId === 'chat-archaeology' ? 4 : 3,
    topics: topics.slice(0, 3).map((topic) => topic.label),
    presentation: planned.presentation,
    questions: planned.questions,
    ending: {
      headline: `收下 3 ${series.resultUnit}`,
      summary: '同频和不同答案都会变成下一段聊天的入口，这局没有输赢，也不评价匹配度。',
      chatPrompt: planned.questions.at(-1).differentFollowUp,
    },
    mechanics: buildExclusiveMechanics(series.seriesId),
    generatedBy: 'fallback',
    generatedAt: new Date().toISOString(),
  };
}
