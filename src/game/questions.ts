import type { GameQuestion, MatchPayload } from '../types';

const publicTopics = ['博物馆', '逛展', '徒步', '做饭', '摄影', '旅行', '咖啡', '电影', '运动', '阅读'];

function findPublicTopic(match: MatchPayload) {
  const chat = match.messages.map((message) => message.content).join(' ');
  return publicTopics.find((topic) => chat.includes(topic)) ?? '周末安排';
}

export function buildQuestionDeck(match: MatchPayload): GameQuestion[] {
  const topic = findPublicTopic(match);

  return [
    {
      id: 'free-afternoon',
      label: '轻松开场',
      source: `来自你们聊过的「${topic}」`,
      prompt: '如果突然多出半天空闲，TA 更可能怎么安排？',
      options: ['去看一个小展', '沿江随便走走', '找家店聊一下午', '宅家充电'],
      matchedFollowUp: '原来你也这么觉得。你心里有具体想去的地方吗？',
      differentFollowUp: '我原来猜错啦。是什么让你更喜欢这个安排？',
    },
    {
      id: 'tired-evening',
      label: '日常节奏',
      source: '一张不涉及隐私的陪伴偏好题',
      prompt: '忙完特别累的一天，TA 更希望收到哪种陪伴？',
      options: ['听我吐槽五分钟', '发点好玩的转移注意', '先让我安静一会儿', '看当天心情'],
      matchedFollowUp: '这个答案很实用。你平时会直接告诉对方自己的状态吗？',
      differentFollowUp: '这个答案和我想的不一样，但挺有用。你会怎么表达这种需要？',
    },
    {
      id: 'tiny-plan',
      label: '留个下次',
      source: '把聊天变成一个低压力的小行动',
      prompt: '如果把今天的聊天延长一小时，TA 更愿意一起做什么？',
      options: ['互换一首循环歌曲', '分享一张今日照片', '再来一道问题', '继续随便聊聊'],
      matchedFollowUp: '看来这件小事可以马上开始。要不要就从你先来？',
      differentFollowUp: '我们想的不一样也挺好。你为什么更想选这个？',
    },
  ];
}
