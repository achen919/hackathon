import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameResultService } from './result-card.mjs';

const input = {
  game: {
    id: 'game-1',
    matchId: 'match-1',
    templateId: 'rapid-choice',
    gameType: 'Rapid choice',
    title: 'Two tiny choices',
    description: 'A safe game',
  },
  result: {
    type: 'rapid-choice',
    questions: [{ id: 'q1' }],
    answers: { a: [0], b: [1] },
  },
  players: { a: { nickname: 'A' }, b: { nickname: 'B' } },
};

test('result service returns a local card when AI is not configured', async () => {
  let calls = 0;
  const service = createGameResultService({ fetchImpl: async () => { calls += 1; throw new Error('should not call provider'); } });
  const card = await service.create({ apiKey: '', imageApiKey: '', imageModel: 'seedream-5.0-pro' }, input);
  assert.equal(calls, 0);
  assert.equal(card.generatedBy, 'fallback');
  assert.equal(card.status, 'fallback');
  assert.equal(card.gameId, 'game-1');
  assert.equal(card.score, 80);
});

test('result service evaluates text and generates a base64 background with configured models', async () => {
  const requests = [];
  const service = createGameResultService({
    fetchImpl: async (url, options) => {
      requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      if (url.endsWith('/chat/completions')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          badge: '默契在线', headline: '你们很会接住彼此', score: 91,
          summary: '这局把不同答案变成了具体的聊天入口。',
          highlights: ['先完成了共同体验', '保留了继续追问的空间'],
          nextPrompt: '哪一题最让你意外？', backgroundPrompt: '抽象暖色光影，无文字。',
        }) } }] }));
      }
      return new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }));
    },
  });
  const card = await service.create({
    apiKey: 'text-secret',
    apiBaseUrl: 'https://provider.example/v1',
    model: 'chat-model',
    imageApiBaseUrl: 'https://tokendance.space/gateway/ark/v3',
    imageApiRoute: '/images/generations',
    imageApiKey: 'image-secret',
    imageProtocol: 'ark:image-generations',
    imageModel: 'seedream-5.0-pro',
  }, input);
  assert.equal(card.generatedBy, 'ai');
  assert.equal(card.status, 'ready');
  assert.equal(card.score, 91);
  assert.equal(card.backgroundUrl, 'data:image/png;base64,aGVsbG8=');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.model, 'chat-model');
  assert.equal(requests[0].headers.Authorization, 'Bearer text-secret');
  assert.equal(requests[1].url, 'https://tokendance.space/gateway/ark/v3/images/generations');
  assert.equal(requests[1].headers.Authorization, 'Bearer image-secret');
  assert.equal(requests[1].body.model, 'seedream-5.0-pro');
  assert.equal(requests[1].body.size, '2K');
  assert.equal(requests[1].body.output_format, 'png');
  assert.equal(requests[1].body.response_format, 'b64_json');
  assert.equal(requests[1].body.watermark, false);
  assert.equal('n' in requests[1].body, false);
});

test('image errors do not remove the evaluated text card', async () => {
  let call = 0;
  const service = createGameResultService({
    fetchImpl: async (url) => {
      call += 1;
      if (url.endsWith('/chat/completions')) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ headline: 'Text survives', score: 77 }) } }] }));
      return new Response('bad image', { status: 503 });
    },
  });
  const card = await service.create({
    apiKey: 'secret',
    apiBaseUrl: 'https://provider.example',
    model: 'chat',
    imageApiBaseUrl: 'https://images.example/custom',
    imageApiRoute: '/generate',
    imageApiKey: 'image-secret',
    imageProtocol: 'openai:image-generations',
    imageModel: 'image',
  }, input);
  assert.equal(call, 2);
  assert.equal(card.generatedBy, 'ai');
  assert.equal(card.status, 'ready');
  assert.equal(card.headline, 'Text survives');
  assert.equal(card.backgroundUrl, undefined);
});

test('image generation can use a configurable OpenAI-compatible route', async () => {
  const requests = [];
  const service = createGameResultService({
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/card.png' }] }));
    },
  });
  const card = await service.generateBackground({
    imageApiBaseUrl: 'https://images.example/custom/v9',
    imageApiRoute: '/render/card',
    imageApiKey: 'image-secret',
    imageProtocol: 'openai:image-generations',
    imageModel: 'image-model',
  }, { backgroundPrompt: 'abstract background' });
  assert.equal(requests[0].url, 'https://images.example/custom/v9/render/card');
  assert.equal(requests[0].body.size, '1024x1024');
  assert.equal(requests[0].body.n, 1);
  assert.equal(card.backgroundUrl, 'https://cdn.example/card.png');
});
