import type {
  CarnivalExclusiveGameDefinition,
  CarnivalExclusiveInteraction,
  CarnivalExclusivePresentationScene,
} from '../carnival-types';
import type { MatchPayload } from '../types';

const PUBLIC_TOPICS = [
  '博物馆', '逛展', '徒步', '爬山', '露营', '散步', '骑行', '做饭', '摄影', '旅行',
  '咖啡', '电影', '音乐', '阅读', '运动', '游戏', '宠物', '周末', '早餐', '夜宵',
] as const;

type Presentation = CarnivalExclusiveGameDefinition['presentation'];
type InteractionKind = CarnivalExclusiveInteraction['kind'];

const DEFAULT_INTERACTIONS: InteractionKind[] = ['swipe-deck', 'mood-dial', 'orbit-pick'];

function publicTopics(match: MatchPayload) {
  const publicChat = match.messages
    .filter((message) => message.type === 'text')
    .map((message) => message.content)
    .join(' ');
  return PUBLIC_TOPICS.filter((topic) => publicChat.includes(topic)).slice(0, 3);
}

function requestedInteractions(prompt: string) {
  const safePrompt = prompt.replace(
    /(?:不要|别用|不想(?:要)?|拒绝)(?:普通)?(?:滑卡|滑动|左右|二选一|转盘|刻度|指针|仪表|星球|宇宙|轨道|星座|星星|泡泡|卡牌|翻牌|票根|宫格|卡片)/gu,
    '',
  );
  const candidates: Array<{ kind: InteractionKind; index: number }> = [
    { kind: 'swipe-deck', index: safePrompt.search(/(?:滑卡|滑动|左滑|右滑|左右|二选一)/u) },
    { kind: 'mood-dial', index: safePrompt.search(/(?:转盘|刻度|指针|仪表|温度|量表|旋钮)/u) },
    // Treat broad words such as “宇宙/星空” as visual-theme hints only. An
    // orbit interaction is selected when the brief names an actual orbit UI
    // element, so “宇宙主题，依次滑卡、刻度、星球轨道” keeps that order.
    { kind: 'orbit-pick', index: safePrompt.search(/(?:星球|轨道|星座|环绕|泡泡|节点)/u) },
    { kind: 'card-grid', index: safePrompt.search(/(?:卡牌|翻牌|票根|宫格|卡片)/u) },
  ];
  const matches = candidates.filter((item) => item.index >= 0);
  const requested = matches.sort((left, right) => left.index - right.index).map((item) => item.kind);
  if (requested.length === 1) return [requested[0], requested[0], requested[0]];
  if (requested.length > 1) {
    return [...requested, ...DEFAULT_INTERACTIONS.filter((kind) => !requested.includes(kind))].slice(0, 3);
  }
  return DEFAULT_INTERACTIONS;
}

function presentationFor(prompt: string): Presentation {
  if (/(?:宇宙|星球|星座|星空|未来|轨道)/u.test(prompt)) {
    return { tone: 'blue', scene: 'cosmos', motion: 'orbit', revealEffect: 'stars' };
  }
  if (/(?:电影|短片|预告|镜头|片场)/u.test(prompt)) {
    return { tone: 'mint', scene: 'cinema', motion: 'float', revealEffect: 'spotlight' };
  }
  if (/(?:实验|反差|量表|仪表|刻度)/u.test(prompt)) {
    return { tone: 'gold', scene: 'lab', motion: 'pulse', revealEffect: 'ripple' };
  }
  if (/(?:篮球|球场|比赛|运动|热血)/u.test(prompt)) {
    return { tone: 'coral', scene: 'court', motion: 'pop', revealEffect: 'confetti' };
  }
  if (/(?:考古|侦探|线索|档案|解谜)/u.test(prompt)) {
    return { tone: 'violet', scene: 'archive', motion: 'slide', revealEffect: 'cards' };
  }
  return { tone: 'blue', scene: 'cosmos', motion: 'pop', revealEffect: 'stars' };
}

function interactionFor(kind: InteractionKind, prompt: string, index: number): CarnivalExclusiveInteraction {
  if (kind === 'card-grid') return { kind, variant: /(?:票根|电影|车票)/u.test(prompt) ? 'tickets' : 'tiles' };
  if (kind === 'swipe-deck') return { kind, variant: /(?:堆叠|卡牌|滑卡)/u.test(prompt) || index % 2 === 1 ? 'stack' : 'split' };
  if (kind === 'mood-dial') return { kind, variant: /(?:方向|指南针)/u.test(prompt) ? 'compass' : 'meter' };
  return { kind, variant: /(?:泡泡|气泡)/u.test(prompt) ? 'bubbles' : 'constellation' };
}

function titleFor(scene: CarnivalExclusivePresentationScene) {
  if (scene === 'cinema') return '今晚的双人短片';
  if (scene === 'lab') return '心动反差实验室';
  if (scene === 'court') return '默契球场三连拍';
  if (scene === 'archive') return '聊天线索解锁局';
  return '星轨上的三次选择';
}

/**
 * Compiles a player's free-form brief into the same safe, declarative v3
 * contract used by AI games. Raw prompt text and private profile fields are
 * never copied into the result; only allow-listed visual and interaction hints
 * plus public chat topics are used.
 */
export function buildDemoPromptGame(match: MatchPayload, prompt: string): CarnivalExclusiveGameDefinition {
  const topics = publicTopics(match);
  const primaryTopic = topics[0] ?? '周末';
  const presentation = presentationFor(prompt);
  const interactions = requestedInteractions(prompt);
  const baseQuestions = [
    {
      id: 'opening-signal',
      label: `${primaryTopic}开场`,
      source: topics.length > 0 ? `来自公开聊过的「${primaryTopic}」` : '当前共同主题不多，从轻松日常开始',
      prompt: `如果把「${primaryTopic}」变成今天的开场，你更想从哪边进入？`,
      options: ['先听一个故事', '先分享自己的', '从一个小问题开始', '先留个轻松彩蛋'],
      matchedFollowUp: '你们选了同一个开场。这种方式最吸引你的是什么？',
      differentFollowUp: '你们从不同方向进入。为什么这个开场更像你？',
    },
    {
      id: 'conversation-rhythm',
      label: '聊天温度',
      source: '只描述当下聊天节奏，不分析人格',
      prompt: '现在的聊天温度，更接近哪一格？',
      options: ['轻松试探', '有点好奇', '渐入佳境', '想多听一点'],
      matchedFollowUp: '这一格你们感受很像。是哪个聊天瞬间让它升温了？',
      differentFollowUp: '你们的温度感受不同。各自想怎样让下一句更自然？',
    },
    {
      id: 'next-orbit',
      label: '下一站轨道',
      source: '从公开话题挑一个低压力续聊方向',
      prompt: '这局结束后，你最想让聊天飘向哪个方向？',
      options: [topics[1] ? `继续聊${topics[1]}` : '交换一个周末灵感', topics[2] ? `听听 TA 的${topics[2]}故事` : '分享最近的小确幸', '聊一个还没问过的好奇', '先把这份默契收好'],
      matchedFollowUp: '你们想去同一个方向。谁愿意先用一句话开场？',
      differentFollowUp: '这里出现了两条好走的支线。先选哪一条，为什么？',
    },
  ];

  return {
    schemaVersion: 3,
    templateId: 'custom',
    seriesId: 'prompt-arcade',
    engine: 'exclusive-choice-v1',
    generatedBy: 'fallback',
    title: titleFor(presentation.scene),
    description: `根据公开聊天里的「${primaryTopic}」线索，用三种可玩交互一起完成轻松破冰。`,
    presentation,
    ending: {
      headline: '你们的三轮小游戏已点亮',
      summary: '同频和不同都是下一段聊天的入口，这局没有输赢。',
      chatPrompt: '刚才哪一个选择最让你想问问对方为什么？',
    },
    questions: baseQuestions.map((question, index) => {
      const interaction = interactionFor(interactions[index], prompt, index);
      return {
        ...question,
        options: question.options.slice(0, interaction.kind === 'swipe-deck' ? 2 : 4),
        interaction,
      };
    }),
  };
}
