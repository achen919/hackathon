import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildCarnivalFallbackGame } from './carnival-games.mjs';
import { createCarnivalHttpHandler } from './carnival-http.mjs';
import { createCarnivalService } from './carnival-service.mjs';
import { createMemoryConfigStore } from './config-store.mjs';

async function withCarnival(run, { configStore = createMemoryConfigStore(), aiService } = {}) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'carnival-http-test-'));
  const service = createCarnivalService({ stateDir: temporaryRoot });
  const handler = createCarnivalHttpHandler({
    service,
    configStore,
    ...(aiService ? { aiService } : {}),
  });
  const server = createServer(async (request, response) => {
    if (!(await handler(request, response))) {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function jsonRequest(baseUrl, path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: baseUrl } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function pairedUsers(baseUrl) {
  const first = await jsonRequest(baseUrl, '/api/carnival/join', {
    method: 'POST', body: { nickname: '小雨', gender: 'female' },
  });
  const second = await jsonRequest(baseUrl, '/api/carnival/join', {
    method: 'POST', body: { nickname: '阿川', gender: 'male' },
  });
  assert.equal(first.response.status, 201);
  assert.equal(first.payload.state.status, 'queued');
  assert.equal(second.response.status, 201);
  assert.equal(second.payload.state.status, 'matched');
  const refreshed = await jsonRequest(baseUrl, '/api/carnival/state', { token: first.payload.token });
  assert.equal(refreshed.payload.status, 'matched');
  return {
    a: { token: first.payload.token, id: refreshed.payload.self.participantId },
    b: { token: second.payload.token, id: second.payload.state.self.participantId },
  };
}

async function unlock(baseUrl, users) {
  for (let index = 0; index < 10; index += 1) {
    const user = index % 2 === 0 ? users.a : users.b;
    const result = await jsonRequest(baseUrl, '/api/carnival/messages', {
      method: 'POST', token: user.token, body: { content: `第 ${index + 1} 条消息，聊聊周末和电影` },
    });
    assert.equal(result.response.status, 201);
  }
}

test('carnival pairs opposite genders and unlocks games after ten total text messages', async () => {
  await withCarnival(async (baseUrl) => {
    const users = await pairedUsers(baseUrl);
    const locked = await jsonRequest(baseUrl, '/api/carnival/prompt', {
      method: 'POST', token: users.a.token, body: { templateId: 'profile-riddle' },
    });
    assert.equal(locked.response.status, 409);
    assert.equal(locked.payload.code, 'INVITE_LOCKED');

    await unlock(baseUrl, users);
    const [stateA, stateB] = await Promise.all([
      jsonRequest(baseUrl, '/api/carnival/state', { token: users.a.token }),
      jsonRequest(baseUrl, '/api/carnival/state', { token: users.b.token }),
    ]);
    for (const { payload } of [stateA, stateB]) {
      assert.equal(payload.canInvite, true);
      assert.equal(payload.room.textMessageCount, 10);
      assert.equal(payload.room.inviteThreshold, 10);
      assert.equal(payload.room.messages.length, 10);
    }
  });
});

test('simultaneous invitations remain separate and clicking an id opens that exact game', async () => {
  await withCarnival(async (baseUrl) => {
    const users = await pairedUsers(baseUrl);
    await unlock(baseUrl, users);
    const [profilePrompt, wheelPrompt] = await Promise.all([
      jsonRequest(baseUrl, '/api/carnival/prompt', {
        method: 'POST', token: users.a.token, body: { templateId: 'profile-riddle' },
      }),
      jsonRequest(baseUrl, '/api/carnival/prompt', {
        method: 'POST', token: users.b.token, body: { templateId: 'keyword-wheel' },
      }),
    ]);
    assert.equal(profilePrompt.response.status, 200);
    assert.match(profilePrompt.payload.prompt, /10 条|公开聊天/);

    const [profile, wheel] = await Promise.all([
      jsonRequest(baseUrl, '/api/carnival/invites', {
        method: 'POST', token: users.a.token,
        headers: { 'Idempotency-Key': 'profile-invite-key-00001' },
        body: { templateId: 'profile-riddle', prompt: profilePrompt.payload.prompt },
      }),
      jsonRequest(baseUrl, '/api/carnival/invites', {
        method: 'POST', token: users.b.token,
        headers: { 'Idempotency-Key': 'wheel-invite-key-000001' },
        body: { templateId: 'keyword-wheel', prompt: wheelPrompt.payload.prompt },
      }),
    ]);
    assert.equal(profile.response.status, 201);
    assert.equal(wheel.response.status, 201);
    assert.notEqual(profile.payload.invite.inviteId, wheel.payload.invite.inviteId);

    const state = await jsonRequest(baseUrl, '/api/carnival/state', { token: users.a.token });
    assert.equal(state.payload.room.invites.length, 2);
    assert.deepEqual(
      new Set(state.payload.room.invites.map((invite) => invite.templateId)),
      new Set(['profile-riddle', 'keyword-wheel']),
    );

    const openedProfile = await jsonRequest(baseUrl, '/api/carnival/games/action', {
      method: 'POST', token: users.b.token,
      body: { inviteId: profile.payload.invite.inviteId, action: 'join' },
    });
    const openedWheel = await jsonRequest(baseUrl, '/api/carnival/games/action', {
      method: 'POST', token: users.a.token,
      body: { inviteId: wheel.payload.invite.inviteId, action: 'join' },
    });
    assert.equal(openedProfile.payload.invite.templateId, 'profile-riddle');
    assert.equal(openedProfile.payload.invite.game.definition.templateId, 'profile-riddle');
    assert.equal(openedWheel.payload.invite.templateId, 'keyword-wheel');
    assert.equal(openedWheel.payload.invite.game.definition.templateId, 'keyword-wheel');
  });
});

test('profile answers remain private until both participants submit', async () => {
  await withCarnival(async (baseUrl) => {
    const users = await pairedUsers(baseUrl);
    await unlock(baseUrl, users);
    const preview = await jsonRequest(baseUrl, '/api/carnival/prompt', {
      method: 'POST', token: users.a.token, body: { templateId: 'profile-riddle' },
    });
    const created = await jsonRequest(baseUrl, '/api/carnival/invites', {
      method: 'POST', token: users.a.token,
      headers: { 'Idempotency-Key': 'private-profile-key-001' },
      body: { templateId: 'profile-riddle', prompt: preview.payload.prompt },
    });
    const inviteId = created.payload.invite.inviteId;
    await jsonRequest(baseUrl, '/api/carnival/games/action', {
      method: 'POST', token: users.b.token, body: { inviteId, action: 'join' },
    });
    const first = await jsonRequest(baseUrl, '/api/carnival/games/action', {
      method: 'POST', token: users.a.token,
      body: {
        inviteId,
        action: 'profile-riddle.submit',
        payload: { keywords: ['真诚', '有趣', '细腻'], sentence: '我觉得你真诚、有趣，而且很细腻。' },
      },
    });
    assert.equal(first.response.status, 200);
    const peerView = await jsonRequest(baseUrl, '/api/carnival/state', { token: users.b.token });
    const peerInvite = peerView.payload.room.invites.find((invite) => invite.inviteId === inviteId);
    assert.equal(peerInvite.game.definition.phase, 'collecting');
    assert.equal(JSON.stringify(peerInvite).includes('我觉得你真诚'), false);

    const second = await jsonRequest(baseUrl, '/api/carnival/games/action', {
      method: 'POST', token: users.b.token,
      body: {
        inviteId,
        action: 'profile-riddle.submit',
        payload: { keywords: ['会倾听', '有分寸', '有计划'], sentence: '我猜你会倾听、有分寸，也很有计划。' },
      },
    });
    assert.equal(second.response.status, 200);
    assert.equal(second.payload.invite.game.definition.phase, 'revealed');
    assert.match(JSON.stringify(second.payload.invite.game.definition.revealedSubmissions), /我觉得你真诚/);
    assert.match(JSON.stringify(second.payload.invite.game.definition.revealedSubmissions), /我猜你会倾听/);
  });
});

test('rapid-choice fallback is accepted and a completed idempotent retry does not call AI twice', async () => {
  let aiCalls = 0;
  const configStore = createMemoryConfigStore({ apiKey: 'test-only-provider-key' });
  const aiService = {
    async generate(_config, match, selection) {
      aiCalls += 1;
      return buildCarnivalFallbackGame(match, selection.templateId, selection.gameLabel);
    },
  };
  await withCarnival(async (baseUrl) => {
    const users = await pairedUsers(baseUrl);
    await unlock(baseUrl, users);
    const preview = await jsonRequest(baseUrl, '/api/carnival/prompt', {
      method: 'POST', token: users.a.token, body: { templateId: 'rapid-choice' },
    });
    const request = {
      method: 'POST',
      token: users.a.token,
      headers: { 'Idempotency-Key': 'rapid-idempotency-key-0001' },
      body: { templateId: 'rapid-choice', prompt: preview.payload.prompt },
    };
    const first = await jsonRequest(baseUrl, '/api/carnival/invites', request);
    const replay = await jsonRequest(baseUrl, '/api/carnival/invites', request);
    assert.equal(first.response.status, 201);
    assert.equal(replay.response.status, 201);
    assert.equal(first.payload.invite.templateId, 'rapid-choice');
    assert.equal(first.payload.invite.inviteId, replay.payload.invite.inviteId);
    assert.equal(first.payload.invite.game.definition.questions.length, 4);
    assert.equal(aiCalls, 1);
    const joined = await jsonRequest(baseUrl, '/api/carnival/games/action', {
      method: 'POST', token: users.b.token,
      body: { inviteId: first.payload.invite.inviteId, action: 'join' },
    });
    assert.equal(joined.response.status, 200);
    assert.equal(joined.payload.invite.game.definition.phase, 'answering');
    assert.equal(joined.payload.invite.game.definition.roundSeconds, 5);
    assert.equal(Number.isFinite(joined.payload.invite.game.definition.self.deadlineAtMs), true);
  }, { configStore, aiService });
});

test('carnival mutations reject cross-origin requests and invalid bearer tokens', async () => {
  await withCarnival(async (baseUrl) => {
    const crossOrigin = await fetch(`${baseUrl}/api/carnival/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ nickname: '测试', gender: 'female' }),
    });
    assert.equal(crossOrigin.status, 403);
    const unauthorized = await jsonRequest(baseUrl, '/api/carnival/state', { token: 'x'.repeat(32) });
    assert.equal(unauthorized.response.status, 401);
    assert.equal(JSON.stringify(unauthorized.payload).includes('x'.repeat(20)), false);
  });
});
