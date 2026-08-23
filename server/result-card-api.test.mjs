import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApiHandler } from './api.mjs';
import { createMemoryConfigStore } from './config-store.mjs';

const requestBody = {
  game: {
    id: 'game-1',
    matchId: 'match-1',
    templateId: 'rapid-choice',
    gameType: 'Rapid choice',
    title: 'Two tiny choices',
    description: 'A safe game',
  },
  result: { type: 'rapid-choice', questions: [], answers: { a: [], b: [] } },
  players: { a: { nickname: 'A' }, b: { nickname: 'B' } },
  conversation: [{ speaker: 'a', content: '我们都喜欢海边散步。' }],
};

async function withServer(handler, run) {
  const server = createServer(async (request, response) => {
    if (!(await handler(request, response))) { response.statusCode = 404; response.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test('result-card endpoint returns a fallback card and enforces same origin', async () => {
  let receivedInput;
  const resultCardService = { create: async (_config, input) => {
    receivedInput = input;
    return ({
    id: 'card-1', gameId: input.game.id, gameTitle: input.game.title, templateId: input.game.templateId,
    status: 'fallback', badge: 'Done', headline: 'Text', score: 80, summary: 'Summary', highlights: ['One'],
    nextPrompt: 'Next', generatedBy: 'fallback', createdAt: new Date().toISOString(),
    });
  } };
  await withServer(createApiHandler({ configStore: createMemoryConfigStore(), resultCardService }), async (baseUrl) => {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json', Origin: baseUrl };
    const response = await fetch(`${baseUrl}/api/games/result-card`, { method: 'POST', headers, body: JSON.stringify(requestBody) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).card.gameId, 'game-1');
    assert.deepEqual(receivedInput.conversation, requestBody.conversation);

    const crossOrigin = await fetch(`${baseUrl}/api/games/result-card`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: JSON.stringify(requestBody) });
    assert.equal(crossOrigin.status, 403);

    const invalidConversation = await fetch(`${baseUrl}/api/games/result-card`, {
      method: 'POST', headers, body: JSON.stringify({ ...requestBody, conversation: [{ speaker: 'c', content: 'bad' }] }),
    });
    assert.equal(invalidConversation.status, 400);
  });
});
