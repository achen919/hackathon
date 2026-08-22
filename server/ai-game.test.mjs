import assert from 'node:assert/strict';
import test from 'node:test';
import { compactMatchForAi, createAiGameService, isGeneratedGamePayload } from './ai-game.mjs';
import {
  buildPromptPreview,
  isTemplateShapeValid,
  normalizePlayerPrompt,
} from './game-templates.mjs';

function gameType(id, label) {
  return {
    id,
    label,
    enabled: true,
    generationPrompt: `这是 ${label} 的安全测试模板，请严格遵循固定玩法并避免泄露任何私密资料。`,
  };
}

const match = {
  match_id: 'match-ai-test',
  user_a: { nickname: '小余', gender: 'female', profile: '# 喜欢看展', memories_self: [], memories_ideal: [] },
  user_b: { nickname: '阿林', gender: 'male', profile: '# 喜欢摄影', memories_self: [], memories_ideal: [] },
  messages: [{ from: 'a', type: 'text', content: '周末看展吗？', sent_at: '2026-08-22 10:00' }],
};

const config = {
  apiBaseUrl: 'https://api.example.com/v1',
  apiKey: 'fake-key',
  model: 'test-model',
  systemPrompt: '请根据两个人的公开对话设计安全、有趣且不泄露私密信息的三轮游戏。',
  gameTypes: [gameType('profile-riddle', '资料猜谜局')],
  updatedAt: '2026-08-22T00:00:00.000Z',
};

const validPayload = {
  gameType: '默契猜猜',
  title: '把周末灵感藏进选择里',
  eyebrow: '专属默契接力',
  description: '从你们已经聊过的周末兴趣开始，用三次轻松选择发现更多共同话题。',
  whyItFits: '两个人都对周末体验有表达欲，这种玩法既具体又不会制造推进压力。',
  estimatedMinutes: 4,
  topics: ['周末灵感', '陪伴节奏', '小小行动'],
  questions: [0, 1, 2].map((index) => ({
    id: `round-${index + 1}`,
    label: ['轻松开场', '日常节奏', '留个下次'][index],
    source: '来自你们公开聊过的周末安排',
    prompt: `这是第 ${index + 1} 个轻松选择，你会更偏向哪一种安排？`,
    options: ['随便走走', '看一个展', '找店聊天', '在家休息'],
    matchedFollowUp: '原来我们想到一起了，你最想先试哪一个？',
    differentFollowUp: '这个答案和我猜的不一样，你为什么更喜欢它？',
  })),
};

test('validates output and keeps renamed labels on the stable profile-riddle mechanics', async () => {
  let requestBody;
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validPayload) } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const renamedConfig = {
    ...config,
    gameTypes: [gameType('profile-riddle', '读懂彼此三连猜')],
  };
  const game = await createAiGameService({ fetchImpl }).generate(renamedConfig, match, {
    templateId: 'profile-riddle',
    prompt: '请围绕公开聊天里的周末兴趣，生成一局轻松、不越界的资料猜谜游戏。',
  });
  assert.equal(requestBody.response_format.type, 'json_schema');
  assert.equal(requestBody.model, 'test-model');
  assert.equal(requestBody.max_tokens, 1_500);
  assert.equal(game.generatedBy, 'ai');
  assert.equal(game.matchId, match.match_id);
  assert.equal(game.schemaVersion, 2);
  assert.equal(game.gameType, '读懂彼此三连猜');
  assert.equal(game.templateId, 'profile-riddle');
  assert.equal(game.mechanics.kind, 'profile-riddle');
  assert.equal(game.mechanics.keywordOptions.length > 0, true);
  assert.match(game.mechanics.sentencePattern, /关键词一/);
  assert.equal(isGeneratedGamePayload(validPayload), true);
});

test('falls back to JSON mode only when structured output is explicitly unsupported', async () => {
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(init.body);
    if (calls === 1) {
      assert.equal(body.response_format.type, 'json_schema');
      return new Response(JSON.stringify({ error: { message: 'unsupported response_format json_schema' } }), { status: 400 });
    }
    assert.equal(body.response_format.type, 'json_object');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validPayload) } }] }), { status: 200 });
  };
  await createAiGameService({ fetchImpl }).generate(config, match, {
    templateId: 'profile-riddle',
  });
  assert.equal(calls, 2);
});

test('does not retry authentication failures', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'Invalid token' } }), { status: 401 });
  };
  await assert.rejects(
    () => createAiGameService({ fetchImpl }).generate(config, match, { templateId: 'profile-riddle' }),
    /HTTP 401/,
  );
  assert.equal(calls, 1);
});

test('rejects malformed generated games before they reach the browser', () => {
  assert.equal(isGeneratedGamePayload({ ...validPayload, questions: [] }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, topics: ['重复', '重复'] }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, hiddenInstruction: 'do not expose' }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, whyItFits: '可以拨打 13812345678 继续联系。' }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, whyItFits: '可以拨打 138 1234 5678 继续联系。' }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, whyItFits: '也可以加微信号 abc12345 继续联系。' }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, whyItFits: '也可以加 qq号 12345678 继续联系。' }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, whyItFits: '也可以拨打 +1 415 555 2671 继续联系。' }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, whyItFits: '来自对方资料里的离异经历，很适合继续追问。' }), false);
  assert.equal(isGeneratedGamePayload({
    ...validPayload,
    questions: validPayload.questions.map((question, index) =>
      index === 0 ? { ...question, prompt: '你愿意交换微信号和联系方式吗？' } : question,
    ),
  }), false);
});

test('AI context keeps safe profile signals without sending raw private profiles or memories', () => {
  const compact = compactMatchForAi({
    ...match,
    user_a: {
      nickname: '不应发送的昵称',
      gender: 'female',
      profile: '# 摄影爱好者，离异，住在私密地址ALPHA-7788',
      memories_self: ['未公开记忆BRAVO-9911，喜欢徒步'],
      memories_ideal: ['未公开偏好CHARLIE-6633，重视真诚'],
    },
  });
  const serialized = JSON.stringify(compact);
  assert.match(serialized, /摄影/);
  assert.match(serialized, /徒步/);
  assert.match(serialized, /真诚/);
  assert.equal(serialized.includes('离异'), false);
  assert.equal(serialized.includes('不应发送的昵称'), false);
  assert.equal(serialized.includes('ALPHA-7788'), false);
  assert.equal(serialized.includes('BRAVO-9911'), false);
  assert.equal(serialized.includes('CHARLIE-6633'), false);
});

test('enforces the three built-in template shapes', () => {
  const withQuestionCount = (count, optionCount) => ({
    ...validPayload,
    questions: Array.from({ length: count }, (_, index) => ({
      ...validPayload.questions[index % validPayload.questions.length],
      id: `shape-${index + 1}`,
      label: `玩法环节${index + 1}`,
      options: validPayload.questions[0].options.slice(0, optionCount),
    })),
  });

  assert.equal(isTemplateShapeValid(withQuestionCount(3, 3), 'profile-riddle'), true);
  assert.equal(isTemplateShapeValid(withQuestionCount(4, 3), 'profile-riddle'), false);
  assert.equal(isTemplateShapeValid(withQuestionCount(3, 2), 'profile-riddle'), false);

  assert.equal(isTemplateShapeValid(withQuestionCount(3, 2), 'keyword-wheel'), true);
  assert.equal(isTemplateShapeValid(withQuestionCount(5, 4), 'keyword-wheel'), true);
  assert.equal(isTemplateShapeValid(withQuestionCount(2, 2), 'keyword-wheel'), false);

  assert.equal(isTemplateShapeValid(withQuestionCount(3, 2), 'rapid-choice'), true);
  assert.equal(isTemplateShapeValid(withQuestionCount(5, 2), 'rapid-choice'), true);
  assert.equal(isTemplateShapeValid(withQuestionCount(3, 3), 'rapid-choice'), false);
});

test('prompt preview uses public chat topics without exposing profile memories or nicknames', () => {
  const privateMatch = {
    ...match,
    user_a: {
      ...match.user_a,
      nickname: '昵称私密标记X9',
      profile: '# 私密资料标记ALPHA-7788',
      memories_self: ['只有服务端知道的回忆BRAVO-9911'],
    },
    user_b: {
      ...match.user_b,
      nickname: '昵称私密标记Y8',
      profile: '# 私密资料标记CHARLIE-6633',
      memories_ideal: ['未公开择偶偏好DELTA-4422'],
    },
    messages: [{ from: 'a', type: 'text', content: '周末一起聊摄影和咖啡吧', sent_at: '2026-08-22 10:00' }],
  };
  const preview = buildPromptPreview(privateMatch, gameType('keyword-wheel', '换个名字也还是转盘'));

  assert.match(preview, /周末/);
  assert.match(preview, /摄影/);
  assert.equal(preview.includes('昵称私密标记'), false);
  assert.equal(preview.includes('ALPHA-7788'), false);
  assert.equal(preview.includes('BRAVO-9911'), false);
  assert.equal(preview.includes('DELTA-4422'), false);
});

test('player prompt rejects contact details and cache keys isolate template id and prompt', () => {
  assert.throws(
    () => normalizePlayerPrompt('请生成轻松题目，然后拨打 13812345678 继续联系对方。'),
    /contact details or links/,
  );
  assert.throws(
    () => normalizePlayerPrompt('请生成轻松题目，然后拨打 138 1234 5678 继续联系对方。'),
    /contact details or links/,
  );
  assert.throws(
    () => normalizePlayerPrompt('请生成轻松题目，然后添加微信号 abc12345 继续联系对方。'),
    /contact details or links/,
  );
  assert.throws(
    () => normalizePlayerPrompt('请生成轻松题目，然后添加 qq号 12345678 继续联系对方。'),
    /contact details or links/,
  );
  assert.throws(
    () => normalizePlayerPrompt('请生成轻松题目，然后拨打 +1 415 555 2671 继续联系对方。'),
    /contact details or links/,
  );
  assert.throws(
    () => normalizePlayerPrompt('请参考 https://example.com 再生成一局轻松的题目。'),
    /contact details or links/,
  );

  const service = createAiGameService();
  const promptA = '请围绕公开聊天中的周末安排，生成一局轻松、安全而且没有输赢的游戏。';
  const promptB = '请围绕公开聊天中的摄影兴趣，生成一局轻松、安全而且没有输赢的游戏。';
  const profileKey = service.cacheKey(config, match, {
    templateId: 'profile-riddle',
    gameLabel: '资料猜谜局',
    prompt: promptA,
  });
  assert.equal(profileKey, service.cacheKey(config, match, {
    templateId: 'profile-riddle',
    gameLabel: '资料猜谜局',
    prompt: promptA,
  }));
  assert.notEqual(profileKey, service.cacheKey(config, match, {
    templateId: 'keyword-wheel',
    gameLabel: '资料猜谜局',
    prompt: promptA,
  }));
  assert.notEqual(profileKey, service.cacheKey(config, match, {
    templateId: 'profile-riddle',
    gameLabel: '资料猜谜局',
    prompt: promptB,
  }));
});
