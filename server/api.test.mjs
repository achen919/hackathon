import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { hashAdminPassword } from './admin-auth.mjs';
import { createApiHandler } from './api.mjs';
import { createMemoryConfigStore } from './config-store.mjs';

const validMatch = {
  match_id: 'test-match',
  match_status: 'MATCH_STATUS_MATCHED',
  message_count: 0,
  user_a: {
    nickname: 'A',
    gender: 'female',
    profile: '# A',
    memories_self: [],
    memories_ideal: [],
  },
  user_b: {
    nickname: 'B',
    gender: 'male',
    profile: '# B',
    memories_self: [],
    memories_ideal: [],
  },
  messages: [],
};

async function withServer(handler, run) {
  const server = createServer(async (request, response) => {
    if (!(await handler(request, response))) {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('health reports configured service without exposing the token', async () => {
  await withServer(createApiHandler({ token: 'server-secret' }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(JSON.stringify(body).includes('server-secret'), false);
  });
});

test('match endpoint refuses to run without a server-side token', async () => {
  await withServer(createApiHandler({ token: '' }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/match`);
    assert.equal(response.status, 503);
  });
});

test('match endpoint validates and returns the upstream payload', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify(validMatch), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  await withServer(createApiHandler({ token: 'secret', fetchImpl }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/match`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-data-source'), 'intellimatch');
    assert.ok(response.headers.get('x-game-context-id'));
    assert.deepEqual(await response.json(), validMatch);
  });
});

test('match endpoint rejects malformed upstream data', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 });

  await withServer(createApiHandler({ token: 'secret', fetchImpl }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/match`);
    assert.equal(response.status, 502);
  });
});

test('match endpoint rate limits repeated requests by client address', async () => {
  const fetchImpl = async () => new Response(JSON.stringify(validMatch), { status: 200 });

  await withServer(
    createApiHandler({ token: 'secret', fetchImpl, rateLimit: 1 }),
    async (baseUrl) => {
      assert.equal((await fetch(`${baseUrl}/api/match`)).status, 200);
      const response = await fetch(`${baseUrl}/api/match`);
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('ratelimit-remaining'), '0');
      assert.ok(Number(response.headers.get('retry-after')) > 0);
    },
  );
});

test('admin session protects config and never returns the provider key', async () => {
  const password = 'independent-admin-password';
  const adminPasswordHash = await hashAdminPassword(password);
  const configStore = createMemoryConfigStore();
  await withServer(
    createApiHandler({ token: 'secret', adminPasswordHash, configStore }),
    async (baseUrl) => {
      assert.equal((await fetch(`${baseUrl}/api/admin/config`)).status, 401);

      const login = await fetch(`${baseUrl}/api/admin/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ password }),
      });
      assert.equal(login.status, 200);
      const loginBody = await login.json();
      const cookie = login.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie?.startsWith('__Host-hackathon_admin='));
      assert.ok(loginBody.csrfToken);

      const providerKey = 'test-admin-provider-key';
      const update = await fetch(`${baseUrl}/api/admin/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: baseUrl,
          Cookie: cookie,
          'X-CSRF-Token': loginBody.csrfToken,
        },
        body: JSON.stringify({
          apiBaseUrl: 'https://api.example.com/v1',
          apiKey: providerKey,
          model: 'test-model',
          systemPrompt: '请生成尊重双方边界并且不会泄露私密信息的三轮破冰游戏。'.repeat(4),
          gameTypes: ['默契猜猜'],
        }),
      });
      const rawUpdate = await update.text();
      assert.equal(update.status, 200);
      assert.equal(rawUpdate.includes(providerKey), false);

      const config = await fetch(`${baseUrl}/api/admin/config`, { headers: { Cookie: cookie } });
      const rawConfig = await config.text();
      assert.equal(config.status, 200);
      assert.equal(rawConfig.includes(providerKey), false);
      assert.equal(JSON.parse(rawConfig).apiKeyConfigured, true);
    },
  );
});

test('admin mutations require both same origin and CSRF token', async () => {
  const password = 'independent-admin-password';
  const adminPasswordHash = await hashAdminPassword(password);
  await withServer(
    createApiHandler({ token: 'secret', adminPasswordHash, configStore: createMemoryConfigStore() }),
    async (baseUrl) => {
      const login = await fetch(`${baseUrl}/api/admin/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ password }),
      });
      const cookie = login.headers.get('set-cookie')?.split(';')[0];
      const body = {
        apiBaseUrl: 'https://api.example.com',
        model: 'test-model',
        systemPrompt: '安全提示词'.repeat(30),
        gameTypes: ['默契猜猜'],
      };
      assert.equal((await fetch(`${baseUrl}/api/admin/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: cookie },
        body: JSON.stringify(body),
      })).status, 403);
      assert.equal((await fetch(`${baseUrl}/api/admin/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: cookie },
        body: JSON.stringify(body),
      })).status, 403);
    },
  );
});

test('AI game endpoint accepts only same-origin server-issued contexts and returns validated service output', async () => {
  const configStore = createMemoryConfigStore({ apiKey: 'fake-key', updatedAt: 'test' });
  const game = {
    schemaVersion: 1,
    id: 'game-id',
    matchId: validMatch.match_id,
    gameType: '默契猜猜',
    title: '专属破冰小局',
    eyebrow: 'AI 专属',
    description: '根据双方聊天生成的三轮轻量选择游戏。',
    whyItFits: '公开聊天里有自然共同点，适合从轻松选择继续。',
    estimatedMinutes: 3,
    topics: ['周末', '日常'],
    questions: [],
    generatedBy: 'ai',
    generatedAt: new Date().toISOString(),
  };
  const aiService = {
    cacheKey: () => 'test-cache-key',
    generate: async () => game,
    listModels: async () => [],
  };
  await withServer(
    createApiHandler({
      token: 'secret',
      configStore,
      aiService,
      fetchImpl: async () => new Response(JSON.stringify(validMatch), { status: 200 }),
    }),
    async (baseUrl) => {
      const matchResponse = await fetch(`${baseUrl}/api/match`);
      const contextId = matchResponse.headers.get('x-game-context-id');
      assert.ok(contextId);

      assert.equal((await fetch(`${baseUrl}/api/games/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId }),
      })).status, 403);

      const response = await fetch(`${baseUrl}/api/games/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ contextId }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).game, game);
    },
  );
});

test('AI generation coalesces fresh requests and busy responses do not consume the global budget', async () => {
  const configStore = createMemoryConfigStore({ apiKey: 'fake-key', updatedAt: 'test' });
  let matchNumber = 0;
  let providerCalls = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const aiService = {
    cacheKey: (_config, match) => match.match_id,
    generate: async (_config, match) => {
      providerCalls += 1;
      if (providerCalls === 1) await firstGate;
      return {
        schemaVersion: 1,
        id: `game-${match.match_id}`,
        matchId: match.match_id,
        gameType: '默契猜猜',
        title: '专属破冰小局',
        eyebrow: 'AI 专属',
        description: '根据双方聊天生成的三轮轻量选择游戏。',
        whyItFits: '公开聊天里有自然共同点，适合从轻松选择继续。',
        estimatedMinutes: 3,
        topics: ['周末', '日常'],
        questions: [],
        generatedBy: 'ai',
        generatedAt: new Date().toISOString(),
      };
    },
    listModels: async () => [],
  };
  await withServer(
    createApiHandler({
      token: 'secret',
      configStore,
      aiService,
      aiMaxConcurrency: 1,
      aiHourlyLimit: 2,
      fetchImpl: async () => new Response(JSON.stringify({
        ...validMatch,
        match_id: `match-${++matchNumber}`,
      }), { status: 200 }),
    }),
    async (baseUrl) => {
      const contexts = [];
      for (let index = 0; index < 3; index += 1) {
        const response = await fetch(`${baseUrl}/api/match`);
        contexts.push(response.headers.get('x-game-context-id'));
      }
      const generate = (contextId, fresh = false) => fetch(`${baseUrl}/api/games/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ contextId, fresh }),
      });

      const first = generate(contexts[0], true);
      while (providerCalls === 0) await new Promise((resolve) => setImmediate(resolve));
      const coalesced = generate(contexts[0], true);
      assert.equal((await generate(contexts[1], true)).status, 503);
      releaseFirst();
      assert.equal((await first).status, 200);
      assert.equal((await coalesced).status, 200);
      assert.equal(providerCalls, 1);
      assert.equal((await generate(contexts[2], true)).status, 200);
      assert.equal(providerCalls, 2);
    },
  );
});

test('AI generation limits forced refreshes per server-issued match context', async () => {
  const configStore = createMemoryConfigStore({ apiKey: 'fake-key', updatedAt: 'test' });
  let providerCalls = 0;
  const aiService = {
    cacheKey: () => 'refresh-limit-cache-key',
    generate: async () => {
      providerCalls += 1;
      return {
        schemaVersion: 1,
        id: `game-${providerCalls}`,
        matchId: validMatch.match_id,
        gameType: '默契猜猜',
        title: '专属破冰小局',
        eyebrow: 'AI 专属',
        description: '根据双方聊天生成的三轮轻量选择游戏。',
        whyItFits: '公开聊天里有自然共同点，适合从轻松选择继续。',
        estimatedMinutes: 3,
        topics: ['周末', '日常'],
        questions: [],
        generatedBy: 'ai',
        generatedAt: new Date().toISOString(),
      };
    },
    listModels: async () => [],
  };

  await withServer(
    createApiHandler({
      token: 'secret',
      configStore,
      aiService,
      aiFreshLimit: 1,
      aiHourlyLimit: 10,
      fetchImpl: async () => new Response(JSON.stringify(validMatch), { status: 200 }),
    }),
    async (baseUrl) => {
      const matchResponse = await fetch(`${baseUrl}/api/match`);
      const contextId = matchResponse.headers.get('x-game-context-id');
      assert.ok(contextId);
      const generate = (fresh) => fetch(`${baseUrl}/api/games/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ contextId, fresh }),
      });

      assert.equal((await generate(false)).status, 200);
      assert.equal((await generate(true)).status, 200);
      const limited = await generate(true);
      assert.equal(limited.status, 429);
      assert.equal((await limited.json()).code, 'AI_REFRESH_LIMIT');
      assert.equal(providerCalls, 2);
    },
  );
});
