import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { hashAdminPassword } from './admin-auth.mjs';
import { createApiHandler } from './api.mjs';
import { createMemoryConfigStore } from './config-store.mjs';
import { buildExclusiveFallbackGame } from './exclusive-series.mjs';
import { isPromptGameDefinition } from './prompt-game.mjs';
import {
  attachFallbackGeneratedTemplateRenderer,
  publicGeneratedTemplateGame,
} from './generated-template-game.mjs';

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

const GAME_LABELS = {
  'profile-riddle': '资料猜谜局',
  'keyword-wheel': '关键词深挖',
  'rapid-choice': '极限2选1',
  custom: '专属小游戏',
};

function gameType(id, label = GAME_LABELS[id]) {
  return {
    id,
    label,
    enabled: true,
    generationPrompt: `这是 ${label} 的安全测试模板，请严格遵循固定玩法并避免泄露任何私密资料。`,
  };
}

function generatedGame(matchId, templateId = 'profile-riddle', label = GAME_LABELS[templateId]) {
  const game = {
    schemaVersion: 2,
    id: `game-${matchId}-${templateId}`,
    matchId,
    gameType: label,
    templateId,
    mechanics: templateId === 'rapid-choice'
      ? { kind: 'rapid-choice', roundSeconds: 5 }
      : { kind: templateId },
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
  return templateId === 'custom' ? game : attachFallbackGeneratedTemplateRenderer(game);
}

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

test('admin session protects config and never returns either provider key', async () => {
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
      const imageProviderKey = 'test-admin-image-provider-key';
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
          imageApiBaseUrl: 'https://tokendance.space/gateway/ark/v3',
          imageApiRoute: '/images/generations',
          imageApiKey: imageProviderKey,
          imageProtocol: 'ark:image-generations',
          imageModel: 'seedream-5.0-pro',
          systemPrompt: '请生成尊重双方边界并且不会泄露私密信息的三轮破冰游戏。'.repeat(4),
          gameTypes: [gameType('profile-riddle')],
        }),
      });
      const rawUpdate = await update.text();
      assert.equal(update.status, 200);
      assert.equal(rawUpdate.includes(providerKey), false);
      assert.equal(rawUpdate.includes(imageProviderKey), false);

      const config = await fetch(`${baseUrl}/api/admin/config`, { headers: { Cookie: cookie } });
      const rawConfig = await config.text();
      assert.equal(config.status, 200);
      assert.equal(rawConfig.includes(providerKey), false);
      assert.equal(rawConfig.includes(imageProviderKey), false);
      assert.equal(JSON.parse(rawConfig).apiKeyConfigured, true);
      assert.equal(JSON.parse(rawConfig).imageApiKeyConfigured, true);
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
        gameTypes: [gameType('profile-riddle')],
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
  const game = generatedGame(validMatch.match_id);
  let receivedSelection;
  const aiService = {
    cacheKey: () => 'test-cache-key',
    generate: async (_config, _match, selection) => {
      receivedSelection = selection;
      return game;
    },
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
        body: JSON.stringify({ contextId, templateId: 'profile-riddle' }),
      })).status, 403);

      const response = await fetch(`${baseUrl}/api/games/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ contextId, templateId: 'profile-riddle' }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).game, publicGeneratedTemplateGame(game, '/api/games/runtime'));
      assert.equal(receivedSelection.templateId, 'profile-riddle');
      assert.equal(receivedSelection.gameLabel, '资料猜谜局');
      assert.equal(typeof receivedSelection.prompt, 'string');
    },
  );
});

test('prompt endpoint uses a stable template id and exposes only safe public-chat context', async () => {
  const privateMatch = {
    ...validMatch,
    message_count: 1,
    user_a: {
      ...validMatch.user_a,
      nickname: '昵称私密标记A77',
      profile: '# 私密资料标记PROFILE-A-7788',
      memories_self: ['未公开回忆MEMORY-A-9911'],
    },
    user_b: {
      ...validMatch.user_b,
      nickname: '昵称私密标记B66',
      profile: '# 私密资料标记PROFILE-B-6633',
      memories_ideal: ['未公开偏好IDEAL-B-4422'],
    },
    messages: [{
      from: 'a',
      type: 'text',
      content: '周末可以聊聊摄影和咖啡',
      sent_at: '2026-08-22 10:00',
    }],
  };
  const renamedLabel = '我们眼中的彼此';
  const configStore = createMemoryConfigStore({
    gameTypes: [gameType('profile-riddle', renamedLabel)],
  });

  await withServer(
    createApiHandler({
      token: 'secret',
      configStore,
      fetchImpl: async () => new Response(JSON.stringify(privateMatch), { status: 200 }),
    }),
    async (baseUrl) => {
      const matchResponse = await fetch(`${baseUrl}/api/match`);
      const contextId = matchResponse.headers.get('x-game-context-id');
      assert.ok(contextId);

      const response = await fetch(`${baseUrl}/api/games/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ contextId, templateId: 'profile-riddle' }),
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.templateId, 'profile-riddle');
      assert.equal(body.label, renamedLabel);
      assert.equal(body.available, true);
      assert.equal(body.maxLength, 1_500);
      assert.match(body.prompt, /周末/);
      assert.match(body.prompt, /摄影/);
      assert.equal(body.prompt.includes('昵称私密标记'), false);
      assert.equal(body.prompt.includes('PROFILE-A-7788'), false);
      assert.equal(body.prompt.includes('MEMORY-A-9911'), false);
      assert.equal(body.prompt.includes('IDEAL-B-4422'), false);
    },
  );
});

test('custom template requires a stable series id and forwards it to AI', async () => {
  let providerCalls = 0;
  let receivedSelection;
  const aiService = {
    cacheKey: (_config, _match, selection) => `custom-${selection.seriesId}`,
    generate: async (_config, _match, selection) => {
      providerCalls += 1;
      receivedSelection = selection;
      return {
        ...buildExclusiveFallbackGame(_match, selection.seriesId, selection.gameLabel, {
          prompt: selection.prompt,
        }),
        generatedBy: 'ai',
      };
    },
    listModels: async () => [],
  };
  await withServer(
    createApiHandler({
      token: 'secret',
      configStore: createMemoryConfigStore({
        apiKey: 'fake-key',
        gameTypes: [gameType('profile-riddle'), gameType('custom')],
      }),
      aiService,
      fetchImpl: async () => new Response(JSON.stringify(validMatch), { status: 200 }),
    }),
    async (baseUrl) => {
      const matchResponse = await fetch(`${baseUrl}/api/match`);
      const contextId = matchResponse.headers.get('x-game-context-id');
      const missing = await fetch(`${baseUrl}/api/games/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ contextId, templateId: 'custom' }),
      });
      assert.equal(missing.status, 400);
      assert.equal((await missing.json()).code, 'INVALID_GAME_SERIES');

      const response = await fetch(`${baseUrl}/api/games/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ contextId, templateId: 'custom', seriesId: 'courtside' }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).game.seriesId, 'courtside');
      assert.equal(providerCalls, 1);
      assert.equal(receivedSelection.seriesId, 'courtside');
    },
  );
});

test('prompt arcade stays playable without an AI key and compiles edited prompts into isolated v4 runtimes', async () => {
  const privateMatch = {
    ...validMatch,
    message_count: 2,
    user_a: {
      ...validMatch.user_a,
      profile: '# 私密资料标记PROFILE-A-7788，也喜欢摄影',
      memories_self: ['未公开回忆MEMORY-A-9911'],
    },
    user_b: {
      ...validMatch.user_b,
      profile: '# 私密资料标记PROFILE-B-6633，也喜欢咖啡',
      memories_ideal: ['未公开偏好IDEAL-B-4422'],
    },
    messages: [
      { from: 'a', type: 'text', content: '周末可以聊聊摄影', sent_at: '2026-08-23 10:00' },
      { from: 'b', type: 'text', content: '我也喜欢咖啡和电影', sent_at: '2026-08-23 10:01' },
    ],
  };
  let providerCalls = 0;
  let capacityCalls = 0;
  const aiService = {
    cacheKey: (_config, match, selection) => `${match.match_id}\0${selection.templateId}\0${selection.seriesId}\0${selection.prompt}`,
    generate: async () => {
      providerCalls += 1;
      throw new Error('AI must not run without a key');
    },
    listModels: async () => [],
  };
  const aiGate = {
    acquire() {
      capacityCalls += 1;
      throw new Error('AI capacity must not be consumed by a local fallback');
    },
  };

  await withServer(
    createApiHandler({
      token: 'secret',
      configStore: createMemoryConfigStore({
        apiKey: '',
        gameTypes: [gameType('profile-riddle'), gameType('custom')],
      }),
      aiService,
      aiGate,
      fetchImpl: async () => new Response(JSON.stringify(privateMatch), { status: 200 }),
    }),
    async (baseUrl) => {
      const matchResponse = await fetch(`${baseUrl}/api/match`);
      const contextId = matchResponse.headers.get('x-game-context-id');
      assert.ok(contextId);

      const promptResponse = await fetch(`${baseUrl}/api/games/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ contextId, templateId: 'custom', seriesId: 'prompt-arcade' }),
      });
      const promptPreview = await promptResponse.json();
      assert.equal(promptResponse.status, 200);
      assert.equal(promptPreview.templateId, 'custom');
      assert.equal(promptPreview.seriesId, 'prompt-arcade');
      assert.match(promptPreview.prompt, /拍照记录/);
      assert.match(promptPreview.prompt, /咖啡小坐/);
      assert.equal(JSON.stringify(promptPreview).includes('PROFILE-A-7788'), false);
      assert.equal(JSON.stringify(promptPreview).includes('MEMORY-A-9911'), false);

      const generate = (prompt) => fetch(`${baseUrl}/api/games/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ contextId, templateId: 'custom', seriesId: 'prompt-arcade', prompt }),
      });
      const cosmicPrompt = '做一个宇宙星空主题，三轮都用左右滑卡的二选一，围绕双方公开聊过的摄影与咖啡，保持轻松无输赢。';
      const cosmicResponse = await generate(cosmicPrompt);
      const cosmic = await cosmicResponse.json();
      assert.equal(cosmicResponse.status, 200);
      assert.equal(cosmic.fallback, true);
      assert.equal(cosmic.providerUnavailable, 'AI_NOT_CONFIGURED');
      assert.equal(cosmic.cached, false);
      assert.equal(cosmic.game.schemaVersion, 4);
      assert.equal(cosmic.game.engine, 'arcade-v1');
      assert.equal(cosmic.game.arcade.preset, 'basketball-duel');
      assert.equal(cosmic.game.artifact.document, undefined);
      assert.match(cosmic.game.artifact.runtimePath, /^\/api\/games\/runtime\/artifact_/);
      assert.equal(JSON.stringify(cosmic.game).includes(cosmicPrompt), false);
      assert.equal(JSON.stringify(cosmic.game).includes('PROFILE-A-7788'), false);
      assert.equal(JSON.stringify(cosmic.game).includes('IDEAL-B-4422'), false);

      const runtime = await fetch(`${baseUrl}${cosmic.game.artifact.runtimePath}`);
      const runtimeDocument = await runtime.text();
      assert.equal(runtime.status, 200);
      assert.match(runtime.headers.get('content-security-policy'), /sandbox allow-scripts/);
      assert.match(runtime.headers.get('content-security-policy'), /script-src 'sha256-/);
      assert.doesNotMatch(runtime.headers.get('content-security-policy'), /script-src 'unsafe-inline'/);
      assert.equal(runtime.headers.get('x-arcade-code-hash'), cosmic.game.artifact.codeHash);
      assert.equal(runtime.headers.get('x-arcade-presentation-only'), '1');
      assert.match(runtimeDocument, /^<!doctype html>/);

      const cachedResponse = await generate(cosmicPrompt);
      const cached = await cachedResponse.json();
      assert.equal(cachedResponse.status, 200);
      assert.equal(cached.cached, true);
      assert.equal(cached.fallback, true);
      assert.equal(cached.game.id, cosmic.game.id);
      const cachedRuntime = await fetch(`${baseUrl}${cached.game.artifact.runtimePath}`);
      assert.equal(cachedRuntime.status, 200);
      assert.equal(cachedRuntime.headers.get('x-arcade-code-hash'), cached.game.artifact.codeHash);

      const strategyPrompt = '做一个真正能操作的九宫格策略对抗小游戏，只参考公开聊天，不给双方关系下结论。';
      const strategyResponse = await generate(strategyPrompt);
      const strategy = await strategyResponse.json();
      assert.equal(strategyResponse.status, 200);
      assert.equal(strategy.game.arcade.kind, 'strategy');
      assert.equal(strategy.game.arcade.preset, 'grid-command');

      const builtIn = await fetch(`${baseUrl}/api/games/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ contextId, templateId: 'profile-riddle' }),
      });
      assert.equal(builtIn.status, 200);
      const builtInBody = await builtIn.json();
      assert.equal(builtInBody.fallback, true);
      assert.equal(builtInBody.providerUnavailable, 'AI_NOT_CONFIGURED');
      assert.equal(builtInBody.game.generatedBy, 'fallback');
      assert.equal(builtInBody.game.renderer.artifact.document, undefined);
      const builtInRuntime = await fetch(`${baseUrl}${builtInBody.game.renderer.artifact.runtimePath}`);
      assert.equal(builtInRuntime.status, 200);
      assert.equal(builtInRuntime.headers.get('x-generated-code-hash'), builtInBody.game.renderer.artifact.codeHash);
      assert.equal(providerCalls, 0);
      assert.equal(capacityCalls, 0);
    },
  );
});

test('prompt arcade and built-in generated templates fall back on provider authentication failure', async () => {
  const upstreamUrl = 'https://match.example.test/case';
  let providerCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url) === upstreamUrl) return new Response(JSON.stringify(validMatch), { status: 200 });
    providerCalls += 1;
    return new Response(JSON.stringify({ error: { message: 'invalid key' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await withServer(
    createApiHandler({
      token: 'secret',
      upstreamUrl,
      fetchImpl,
      configStore: createMemoryConfigStore({
        apiBaseUrl: 'https://ai.example.test',
        apiKey: 'bad-key',
        gameTypes: [gameType('profile-riddle'), gameType('custom')],
      }),
    }),
    async (baseUrl) => {
      const matchResponse = await fetch(`${baseUrl}/api/match`);
      const contextId = matchResponse.headers.get('x-game-context-id');
      assert.ok(contextId);
      const prompt = '做一个未来星球主题的三轮轨道选择游戏，只使用双方已经公开聊过的轻松内容。';
      const generate = (templateId, extra = {}) => fetch(`${baseUrl}/api/games/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ contextId, templateId, ...extra }),
      });

      const customResponse = await generate('custom', { seriesId: 'prompt-arcade', prompt });
      const custom = await customResponse.json();
      assert.equal(customResponse.status, 200);
      assert.equal(custom.fallback, true);
      assert.equal(custom.providerUnavailable, 'AI_AUTH_FAILED');
      assert.equal(custom.game.schemaVersion, 4);
      assert.equal(custom.game.engine, 'arcade-v1');
      assert.equal(custom.game.artifact.document, undefined);
      assert.equal(custom.game.arcade.preset, 'basketball-duel');
      assert.equal(providerCalls, 1);

      const cachedResponse = await generate('custom', { seriesId: 'prompt-arcade', prompt });
      const cached = await cachedResponse.json();
      assert.equal(cachedResponse.status, 200);
      assert.equal(cached.cached, true);
      assert.equal(cached.fallback, true);
      assert.equal(providerCalls, 1);

      const builtInResponse = await generate('profile-riddle');
      const builtIn = await builtInResponse.json();
      assert.equal(builtInResponse.status, 200);
      assert.equal(builtIn.fallback, true);
      assert.equal(builtIn.providerUnavailable, 'AI_AUTH_FAILED');
      assert.equal(builtIn.game.renderer.engine, 'generated-template-v1');
      assert.equal(builtIn.game.renderer.artifact.document, undefined);
      assert.equal(providerCalls, 2);
    },
  );
});

test('generation rejects player prompts containing contact details before calling AI', async () => {
  let providerCalls = 0;
  const aiService = {
    cacheKey: () => 'invalid-prompt-must-not-be-cached',
    generate: async () => {
      providerCalls += 1;
      return generatedGame(validMatch.match_id);
    },
    listModels: async () => [],
  };
  await withServer(
    createApiHandler({
      token: 'secret',
      configStore: createMemoryConfigStore({ apiKey: 'fake-key' }),
      aiService,
      fetchImpl: async () => new Response(JSON.stringify(validMatch), { status: 200 }),
    }),
    async (baseUrl) => {
      const matchResponse = await fetch(`${baseUrl}/api/match`);
      const contextId = matchResponse.headers.get('x-game-context-id');
      const response = await fetch(`${baseUrl}/api/games/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({
          contextId,
          templateId: 'profile-riddle',
          prompt: '请生成轻松题目，完成后拨打 13812345678 联系对方继续游戏。',
        }),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 'INVALID_GAME_PROMPT');
      assert.equal(providerCalls, 0);
    },
  );
});

test('generation cache is isolated by stable template id and edited prompt', async () => {
  let providerCalls = 0;
  const selections = [];
  const aiService = {
    cacheKey: (_config, _match, selection) => `${selection.templateId}\0${selection.prompt}`,
    generate: async (_config, match, selection) => {
      providerCalls += 1;
      selections.push(selection);
      return generatedGame(match.match_id, selection.templateId, selection.gameLabel);
    },
    listModels: async () => [],
  };
  await withServer(
    createApiHandler({
      token: 'secret',
      configStore: createMemoryConfigStore({
        apiKey: 'fake-key',
        gameTypes: [gameType('profile-riddle'), gameType('rapid-choice')],
      }),
      aiService,
      fetchImpl: async () => new Response(JSON.stringify(validMatch), { status: 200 }),
    }),
    async (baseUrl) => {
      const matchResponse = await fetch(`${baseUrl}/api/match`);
      const contextId = matchResponse.headers.get('x-game-context-id');
      assert.ok(contextId);
      const promptA = '请围绕公开聊天中的周末安排，生成一局轻松、安全而且没有输赢的游戏。';
      const promptB = '请围绕公开聊天中的摄影兴趣，生成一局轻松、安全而且没有输赢的游戏。';
      const generate = (templateId, prompt) => fetch(`${baseUrl}/api/games/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ contextId, templateId, prompt }),
      });

      const first = await generate('profile-riddle', promptA);
      const same = await generate('profile-riddle', promptA);
      const otherTemplate = await generate('rapid-choice', promptA);
      const otherPrompt = await generate('profile-riddle', promptB);

      assert.equal(first.status, 200);
      assert.equal((await first.json()).cached, false);
      assert.equal(same.status, 200);
      assert.equal((await same.json()).cached, true);
      assert.equal(otherTemplate.status, 200);
      assert.equal((await otherTemplate.json()).cached, false);
      assert.equal(otherPrompt.status, 200);
      assert.equal((await otherPrompt.json()).cached, false);
      assert.equal(providerCalls, 3);
      assert.deepEqual(selections.map(({ templateId, prompt }) => ({ templateId, prompt })), [
        { templateId: 'profile-riddle', prompt: promptA },
        { templateId: 'rapid-choice', prompt: promptA },
        { templateId: 'profile-riddle', prompt: promptB },
      ]);
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
      return generatedGame(match.match_id);
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
        body: JSON.stringify({ contextId, templateId: 'profile-riddle', fresh }),
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
      return { ...generatedGame(validMatch.match_id), id: `game-${providerCalls}` };
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
        body: JSON.stringify({ contextId, templateId: 'profile-riddle', fresh }),
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
