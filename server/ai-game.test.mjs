import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiGameService, isGeneratedGamePayload } from './ai-game.mjs';

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
  gameTypes: ['默契猜猜'],
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

test('validates and returns a strict Chat Completions game payload', async () => {
  let requestBody;
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validPayload) } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const game = await createAiGameService({ fetchImpl }).generate(config, match);
  assert.equal(requestBody.response_format.type, 'json_schema');
  assert.equal(requestBody.model, 'test-model');
  assert.equal(requestBody.max_tokens, 1_500);
  assert.equal(game.generatedBy, 'ai');
  assert.equal(game.matchId, match.match_id);
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
  await createAiGameService({ fetchImpl }).generate(config, match);
  assert.equal(calls, 2);
});

test('does not retry authentication failures', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'Invalid token' } }), { status: 401 });
  };
  await assert.rejects(() => createAiGameService({ fetchImpl }).generate(config, match), /HTTP 401/);
  assert.equal(calls, 1);
});

test('rejects malformed generated games before they reach the browser', () => {
  assert.equal(isGeneratedGamePayload({ ...validPayload, questions: [] }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, topics: ['重复', '重复'] }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, hiddenInstruction: 'do not expose' }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, whyItFits: '可以拨打 13812345678 继续联系。' }), false);
  assert.equal(isGeneratedGamePayload({
    ...validPayload,
    questions: validPayload.questions.map((question, index) =>
      index === 0 ? { ...question, prompt: '你愿意交换微信号和联系方式吗？' } : question,
    ),
  }), false);
});
