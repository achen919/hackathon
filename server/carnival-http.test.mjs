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

async function withCarnival(run, {
  configStore = createMemoryConfigStore(),
  aiService,
  httpOptions = {},
} = {}) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'carnival-http-test-'));
  const service = createCarnivalService({ stateDir: temporaryRoot });
  const handler = createCarnivalHttpHandler({
    service,
    configStore,
    ...(aiService ? { aiService } : {}),
    ...httpOptions,
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
    await jsonRequest(baseUrl, '/api/carnival/messages', {
      method: 'POST', token: users.a.token, body: { content: '旅行时我很想去徒步和露营。' },
    });
    await jsonRequest(baseUrl, '/api/carnival/messages', {
      method: 'POST', token: users.b.token, body: { content: '最近想研究火锅和烘焙。' },
    });
    const preview = await jsonRequest(baseUrl, '/api/carnival/prompt', {
      method: 'POST', token: users.a.token, body: { templateId: 'profile-riddle' },
    });
    const created = await jsonRequest(baseUrl, '/api/carnival/invites', {
      method: 'POST', token: users.a.token,
      headers: { 'Idempotency-Key': 'private-profile-key-001' },
      body: { templateId: 'profile-riddle', prompt: preview.payload.prompt },
    });
    const inviteId = created.payload.invite.inviteId;
    const joined = await jsonRequest(baseUrl, '/api/carnival/games/action', {
      method: 'POST', token: users.b.token, body: { inviteId, action: 'join' },
    });
    const creatorState = await jsonRequest(baseUrl, '/api/carnival/state', { token: users.a.token });
    const creatorInvite = creatorState.payload.room.invites.find((invite) => invite.inviteId === inviteId);
    const creatorGroups = creatorInvite.game.definition.choiceGroups;
    const joinerGroups = joined.payload.invite.game.definition.choiceGroups;
    assert.deepEqual(creatorGroups.map((group) => group.options.length), [3, 3, 3]);
    assert.deepEqual(joinerGroups.map((group) => group.options.length), [3, 3, 3]);
    assert.notDeepEqual(creatorGroups, joinerGroups);
    assert.deepEqual(creatorInvite.game.definition.keywordOptions, creatorGroups.flatMap((group) => group.options));
    assert.deepEqual(joined.payload.invite.game.definition.keywordOptions, joinerGroups.flatMap((group) => group.options));
    const firstKeywords = creatorGroups.map((group) => group.options[0]);
    const secondKeywords = joinerGroups.map((group) => group.options[1]);
    const firstSentence = `我觉得阿川是一个${firstKeywords[0]}、${firstKeywords[1]}，而且${firstKeywords[2]}的人。`;
    const first = await jsonRequest(baseUrl, '/api/carnival/games/action', {
      method: 'POST', token: users.a.token,
      body: {
        inviteId,
        action: 'profile-riddle.submit',
        payload: { keywords: firstKeywords, sentence: '客户端不能覆盖这句话 unsafe_12345' },
      },
    });
    assert.equal(first.response.status, 200);
    const peerView = await jsonRequest(baseUrl, '/api/carnival/state', { token: users.b.token });
    const peerInvite = peerView.payload.room.invites.find((invite) => invite.inviteId === inviteId);
    assert.equal(peerInvite.game.definition.phase, 'collecting');
    assert.equal(JSON.stringify(peerInvite).includes(firstSentence), false);

    const second = await jsonRequest(baseUrl, '/api/carnival/games/action', {
      method: 'POST', token: users.b.token,
      body: {
        inviteId,
        action: 'profile-riddle.submit',
        payload: { keywords: secondKeywords },
      },
    });
    assert.equal(second.response.status, 200);
    assert.equal(second.payload.invite.game.definition.phase, 'revealed');
    assert.match(JSON.stringify(second.payload.invite.game.definition.revealedSubmissions), new RegExp(firstKeywords[0]));
    assert.match(JSON.stringify(second.payload.invite.game.definition.revealedSubmissions), new RegExp(secondKeywords[0]));
    const revealed = JSON.stringify(second.payload.invite.game.definition.revealedSubmissions);
    assert.equal(revealed.includes('unsafe_12345'), false);
    assert.match(revealed, /我觉得小雨是一个/);
    assert.match(revealed, /我觉得阿川是一个/);
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

test('custom HTTP flow preserves series and invite ids while keeping answers private until each guess', async () => {
  let aiCalls = 0;
  const configStore = createMemoryConfigStore({ apiKey: 'test-only-provider-key' });
  const aiService = {
    async generate(_config, match, selection) {
      aiCalls += 1;
      return buildCarnivalFallbackGame(match, selection.templateId, selection.gameLabel, {
        seriesId: selection.seriesId,
      });
    },
  };
  await withCarnival(async (baseUrl) => {
    const users = await pairedUsers(baseUrl);
    await unlock(baseUrl, users);
    const state = await jsonRequest(baseUrl, '/api/carnival/state', { token: users.a.token });
    const customType = state.payload.gameTypes.find((item) => item.templateId === 'custom');
    assert.equal(customType.available, true);
    assert.deepEqual(customType.series.map((item) => item.seriesId), [
      'courtside', 'chat-archaeology', 'weekend-studio', 'contrast-lab', 'future-trailer',
      'prompt-arcade',
    ]);

    const invalid = await jsonRequest(baseUrl, '/api/carnival/prompt', {
      method: 'POST', token: users.a.token,
      body: { templateId: 'custom', seriesId: 'missing' },
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.payload.code, 'INVALID_GAME_SERIES');

    const preview = await jsonRequest(baseUrl, '/api/carnival/prompt', {
      method: 'POST', token: users.a.token,
      body: { templateId: 'custom', seriesId: 'courtside' },
    });
    assert.equal(preview.response.status, 200);
    assert.equal(preview.payload.templateId, 'custom');
    assert.equal(preview.payload.seriesId, 'courtside');
    assert.match(preview.payload.prompt, /courtside/);

    const inviteRequest = {
      method: 'POST', token: users.a.token,
      headers: { 'Idempotency-Key': 'exclusive-http-idempotency-01' },
      body: { templateId: 'custom', seriesId: 'courtside', prompt: preview.payload.prompt },
    };
    const created = await jsonRequest(baseUrl, '/api/carnival/invites', inviteRequest);
    const replay = await jsonRequest(baseUrl, '/api/carnival/invites', inviteRequest);
    assert.equal(created.response.status, 201);
    assert.equal(replay.response.status, 201);
    assert.equal(created.payload.invite.inviteId, replay.payload.invite.inviteId);
    assert.equal(created.payload.invite.templateId, 'custom');
    assert.equal(created.payload.invite.seriesId, 'courtside');
    assert.equal(created.payload.invite.game.definition.series.templateKey, 'exclusive_game_courtside_v1');
    assert.equal(aiCalls, 1);
    const inviteId = created.payload.invite.inviteId;

    const joined = await jsonRequest(baseUrl, '/api/carnival/games/action', {
      method: 'POST', token: users.b.token,
      body: { inviteId, action: 'join' },
    });
    assert.equal(joined.response.status, 200);

    for (let roundIndex = 0; roundIndex < 3; roundIndex += 1) {
      const answerer = roundIndex % 2 === 0 ? users.a : users.b;
      const guesser = roundIndex % 2 === 0 ? users.b : users.a;
      const answererView = await jsonRequest(baseUrl, '/api/carnival/state', { token: answerer.token });
      const answererInvite = answererView.payload.room.invites.find((item) => item.inviteId === inviteId);
      const definition = answererInvite.game.definition;
      const questionId = definition.question.id;
      const optionCount = definition.question.options.length;
      const answer = roundIndex % optionCount;
      const guess = (answer + 1) % optionCount;
      assert.equal(definition.roundIndex, roundIndex);
      assert.equal(definition.protagonistId, 'a');
      assert.equal(definition.self.role, 'answerer');

      const answered = await jsonRequest(baseUrl, '/api/carnival/games/action', {
        method: 'POST', token: answerer.token,
        body: {
          inviteId,
          action: 'exclusive.answer',
          payload: {
            questionId,
            answer,
            requestId: `http-answer-round-${roundIndex}`,
            expectedRevision: definition.revision,
          },
        },
      });
      assert.equal(answered.response.status, 200);

      const guesserView = await jsonRequest(baseUrl, '/api/carnival/state', { token: guesser.token });
      const guesserInvite = guesserView.payload.room.invites.find((item) => item.inviteId === inviteId);
      assert.equal(guesserInvite.game.definition.phase, 'guessing');
      assert.equal(guesserInvite.game.definition.protagonistId, 'b');
      assert.equal(guesserInvite.game.definition.guesserId, 'a');
      assert.equal(guesserInvite.game.definition.revealedRound, null);
      assert.equal(JSON.stringify(guesserInvite).includes(`"answer":${answer}`), false);

      const guessed = await jsonRequest(baseUrl, '/api/carnival/games/action', {
        method: 'POST', token: guesser.token,
        body: {
          inviteId,
          action: 'exclusive.guess',
          payload: {
            questionId,
            guess,
            requestId: `http-guess-round-${roundIndex}`,
            expectedRevision: guesserInvite.game.definition.revision,
          },
        },
      });
      assert.equal(guessed.response.status, 200);
      assert.equal(guessed.payload.invite.game.definition.revealedRound.questionId, questionId);
      assert.equal(guessed.payload.invite.game.definition.revealedRound.answer, answer);

      const next = await jsonRequest(baseUrl, '/api/carnival/games/action', {
        method: 'POST', token: answerer.token,
        body: {
          inviteId,
          action: 'exclusive.next',
          payload: {
            questionId,
            requestId: `http-next-round-${roundIndex}`,
            expectedRevision: guessed.payload.invite.game.definition.revision,
          },
        },
      });
      assert.equal(next.response.status, 200);
      if (roundIndex < 2) {
        assert.equal(next.payload.invite.game.definition.roundIndex, roundIndex + 1);
      } else {
        assert.equal(next.payload.invite.status, 'completed');
        assert.equal(next.payload.invite.game.definition.phase, 'completed');
        assert.equal(next.payload.invite.game.definition.results.length, 3);
      }
    }
  }, { configStore, aiService });
});

test('custom invitation falls back to the same series when AI generation fails', async () => {
  const configStore = createMemoryConfigStore({ apiKey: 'test-only-provider-key' });
  const aiService = { async generate() { throw new Error('provider unavailable'); } };
  await withCarnival(async (baseUrl) => {
    const users = await pairedUsers(baseUrl);
    await unlock(baseUrl, users);
    const preview = await jsonRequest(baseUrl, '/api/carnival/prompt', {
      method: 'POST', token: users.a.token,
      body: { templateId: 'custom', seriesId: 'future-trailer' },
    });
    const created = await jsonRequest(baseUrl, '/api/carnival/invites', {
      method: 'POST', token: users.a.token,
      headers: { 'Idempotency-Key': 'exclusive-fallback-same-series' },
      body: { templateId: 'custom', seriesId: 'future-trailer', prompt: preview.payload.prompt },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.invite.seriesId, 'future-trailer');
    assert.equal(created.payload.invite.game.definition.seriesId, 'future-trailer');
    assert.equal(created.payload.invite.game.definition.generatedBy, 'fallback');
  }, { configStore, aiService });
});

test('custom invitation idempotency rejects changed series or prompt without another AI call', async () => {
  let aiCalls = 0;
  const configStore = createMemoryConfigStore({ apiKey: 'test-only-provider-key' });
  const aiService = {
    async generate(_config, match, selection) {
      aiCalls += 1;
      return buildCarnivalFallbackGame(match, selection.templateId, selection.gameLabel, {
        seriesId: selection.seriesId,
      });
    },
  };
  await withCarnival(async (baseUrl) => {
    const users = await pairedUsers(baseUrl);
    await unlock(baseUrl, users);
    const preview = await jsonRequest(baseUrl, '/api/carnival/prompt', {
      method: 'POST', token: users.a.token,
      body: { templateId: 'custom', seriesId: 'courtside' },
    });
    const idempotencyKey = 'exclusive-conflict-http-key-01';
    const first = await jsonRequest(baseUrl, '/api/carnival/invites', {
      method: 'POST', token: users.a.token,
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { templateId: 'custom', seriesId: 'courtside', prompt: preview.payload.prompt },
    });
    assert.equal(first.response.status, 201);
    assert.equal(aiCalls, 1);

    const changedSeries = await jsonRequest(baseUrl, '/api/carnival/invites', {
      method: 'POST', token: users.a.token,
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { templateId: 'custom', seriesId: 'future-trailer', prompt: preview.payload.prompt },
    });
    assert.equal(changedSeries.response.status, 409);
    assert.equal(changedSeries.payload.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(aiCalls, 1);

    const changedPrompt = await jsonRequest(baseUrl, '/api/carnival/invites', {
      method: 'POST', token: users.a.token,
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        templateId: 'custom',
        seriesId: 'courtside',
        prompt: `${preview.payload.prompt}\n请把题面表达得更轻松一些。`,
      },
    });
    assert.equal(changedPrompt.response.status, 409);
    assert.equal(changedPrompt.payload.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(aiCalls, 1);

    const state = await jsonRequest(baseUrl, '/api/carnival/state', { token: users.a.token });
    assert.equal(state.payload.room.invites.length, 1);
    assert.equal(state.payload.room.invites[0].inviteId, first.payload.invite.inviteId);
  }, { configStore, aiService });
});

test('arcade preview serves isolated runtime, reuses it byte-for-byte, and keeps source out of state JSON', async () => {
  let aiCalls = 0;
  const configStore = createMemoryConfigStore({ apiKey: 'test-only-provider-key' });
  const aiService = {
    async generate(_config, match, selection) {
      aiCalls += 1;
      return {
        ...buildCarnivalFallbackGame(match, selection.templateId, selection.gameLabel, {
          seriesId: selection.seriesId,
          prompt: selection.prompt,
        }),
        generatedBy: 'ai',
      };
    },
  };
  await withCarnival(async (baseUrl) => {
    const users = await pairedUsers(baseUrl);
    await unlock(baseUrl, users);
    const prompt = '请做一局宇宙轨道主题的双人选择游戏，用星球围绕的方式让我们猜彼此会怎么选。';
    const preview = await jsonRequest(baseUrl, '/api/carnival/game-preview', {
      method: 'POST',
      token: users.a.token,
      body: { templateId: 'custom', seriesId: 'prompt-arcade', prompt },
    });
    assert.equal(preview.response.status, 201);
    assert.match(preview.payload.previewToken, /^[A-Za-z0-9_-]{20,120}$/);
    assert.equal(Date.parse(preview.payload.expiresAt) > Date.now(), true);
    assert.equal(preview.payload.game.schemaVersion, 4);
    assert.equal(preview.payload.game.engine, 'arcade-v1');
    assert.equal(preview.payload.game.arcade.preset, 'basketball-duel');
    assert.equal(preview.payload.game.seriesId, 'prompt-arcade');
    assert.equal(preview.payload.game.generatedBy, 'ai');
    assert.equal(preview.payload.game.artifact.document, undefined);
    assert.match(preview.payload.game.artifact.runtimePath, /^\/api\/carnival\/games\/runtime\/artifact_/);
    assert.equal(JSON.stringify(preview.payload).includes('<!doctype html>'), false);
    assert.equal(aiCalls, 1);

    const previewRuntime = await fetch(`${baseUrl}${preview.payload.game.artifact.runtimePath}`);
    const previewDocument = await previewRuntime.text();
    assert.equal(previewRuntime.status, 200);
    assert.equal(previewRuntime.headers.get('cache-control'), 'no-store');
    assert.equal(previewRuntime.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(previewRuntime.headers.get('x-arcade-code-hash'), preview.payload.game.artifact.codeHash);
    assert.match(previewRuntime.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(previewRuntime.headers.get('content-security-policy'), /sandbox allow-scripts/);
    assert.match(previewRuntime.headers.get('content-security-policy'), /connect-src 'none'/);
    assert.match(previewRuntime.headers.get('content-security-policy'), /script-src 'sha256-/);
    assert.doesNotMatch(previewRuntime.headers.get('content-security-policy'), /script-src 'unsafe-inline'/);
    assert.match(previewRuntime.headers.get('content-security-policy'), /form-action 'none'/);
    assert.equal(previewRuntime.headers.get('origin-agent-cluster'), null);
    assert.match(previewDocument, /^<!doctype html>/);
    assert.match(previewDocument, /pairplay\s*:\s*1/);

    const inviteRequest = {
      method: 'POST',
      token: users.a.token,
      headers: { 'Idempotency-Key': 'prompt-preview-create-key-001' },
      body: {
        templateId: 'custom',
        seriesId: 'prompt-arcade',
        prompt,
        previewToken: preview.payload.previewToken,
      },
    };
    const created = await jsonRequest(baseUrl, '/api/carnival/invites', inviteRequest);
    const replay = await jsonRequest(baseUrl, '/api/carnival/invites', inviteRequest);
    assert.equal(created.response.status, 201);
    assert.equal(replay.response.status, 201);
    assert.equal(replay.payload.invite.inviteId, created.payload.invite.inviteId);
    assert.equal(created.payload.invite.game.gameId, preview.payload.game.id);
    assert.equal(created.payload.invite.game.definition.engine, 'arcade-v1');
    assert.equal(created.payload.invite.game.definition.artifact.codeHash, preview.payload.game.artifact.codeHash);
    assert.equal(created.payload.invite.game.definition.artifact.document, undefined);
    assert.equal(aiCalls, 1);

    const inviteId = created.payload.invite.inviteId;
    const joined = await jsonRequest(baseUrl, '/api/carnival/games/action', {
      method: 'POST', token: users.b.token, body: { inviteId, action: 'join' },
    });
    assert.equal(joined.payload.invite.game.definition.self.role, 'keeper');
    const [readyA, readyB] = await Promise.all([
      jsonRequest(baseUrl, '/api/carnival/games/action', {
        method: 'POST', token: users.a.token,
        body: { inviteId, action: 'arcade.ready', payload: { seq: 0, requestId: 'http-arcade-ready-a-001' } },
      }),
      jsonRequest(baseUrl, '/api/carnival/games/action', {
        method: 'POST', token: users.b.token,
        body: { inviteId, action: 'arcade.ready', payload: { seq: 0, requestId: 'http-arcade-ready-b-001' } },
      }),
    ]);
    assert.equal(readyA.response.status, 200);
    assert.equal(readyB.response.status, 200);
    assert.equal(['waiting', 'countdown'].includes(readyA.payload.invite.game.definition.phase), true);
    assert.equal(readyB.payload.invite.game.definition.phase, 'countdown');
    const peerState = await jsonRequest(baseUrl, '/api/carnival/state', { token: users.b.token });
    assert.equal(JSON.stringify(peerState.payload).includes('<!doctype html>'), false);
    assert.equal(peerState.payload.room.invites[0].game.definition.artifact.codeHash, preview.payload.game.artifact.codeHash);
  }, { configStore, aiService });
});

test('rejects a preview when public chat changes while AI generation is in flight', async () => {
  let releaseGeneration;
  let markGenerationStarted;
  const generationStarted = new Promise((resolve) => { markGenerationStarted = resolve; });
  const generationRelease = new Promise((resolve) => { releaseGeneration = resolve; });
  const configStore = createMemoryConfigStore({ apiKey: 'test-only-provider-key' });
  const aiService = {
    async generate(_config, match, selection) {
      markGenerationStarted();
      await generationRelease;
      return buildCarnivalFallbackGame(match, selection.templateId, selection.gameLabel, {
        seriesId: selection.seriesId,
        prompt: selection.prompt,
      });
    },
  };
  await withCarnival(async (baseUrl) => {
    const users = await pairedUsers(baseUrl);
    await unlock(baseUrl, users);
    const pendingPreview = jsonRequest(baseUrl, '/api/carnival/game-preview', {
      method: 'POST', token: users.a.token,
      body: {
        templateId: 'custom',
        seriesId: 'prompt-arcade',
        prompt: '请生成一局星空轨道主题的双人选择游戏，让双方轻松猜彼此会选择哪一颗星球。',
      },
    });
    await generationStarted;
    const message = await jsonRequest(baseUrl, '/api/carnival/messages', {
      method: 'POST', token: users.b.token,
      body: { content: '生成期间又聊到了一部新电影。' },
    });
    assert.equal(message.response.status, 201);
    releaseGeneration();
    const preview = await pendingPreview;
    assert.equal(preview.response.status, 409);
    assert.equal(preview.payload.code, 'GAME_PREVIEW_STALE');
  }, { configStore, aiService });
});

test('prompt-game preview tokens reject forgery, cross-user use, changed input, stale chat, and duplicate sends', async () => {
  let aiCalls = 0;
  const configStore = createMemoryConfigStore({ apiKey: 'test-only-provider-key' });
  const aiService = {
    async generate(_config, match, selection) {
      aiCalls += 1;
      return buildCarnivalFallbackGame(match, selection.templateId, selection.gameLabel, {
        seriesId: selection.seriesId,
        prompt: selection.prompt,
      });
    },
  };
  await withCarnival(async (baseUrl) => {
    const users = await pairedUsers(baseUrl);
    await unlock(baseUrl, users);
    const prompt = '请生成一局电影票根风格的卡牌双人游戏，围绕公开聊天轻松猜猜对方的选择。';
    const makePreview = (user = users.a, value = prompt) => jsonRequest(baseUrl, '/api/carnival/game-preview', {
      method: 'POST', token: user.token,
      body: { templateId: 'custom', seriesId: 'prompt-arcade', prompt: value },
    });
    const sendPreview = (user, previewToken, key, overrides = {}) => jsonRequest(baseUrl, '/api/carnival/invites', {
      method: 'POST', token: user.token,
      headers: { 'Idempotency-Key': key },
      body: {
        templateId: 'custom', seriesId: 'prompt-arcade', prompt, previewToken, ...overrides,
      },
    });

    const bound = await makePreview();
    assert.equal(bound.response.status, 201);
    const crossUser = await sendPreview(users.b, bound.payload.previewToken, 'preview-cross-user-key-0001');
    assert.equal(crossUser.response.status, 403);
    assert.equal(crossUser.payload.code, 'GAME_PREVIEW_FORBIDDEN');
    const changedPrompt = await sendPreview(
      users.a,
      bound.payload.previewToken,
      'preview-changed-prompt-key-01',
      { prompt: `${prompt}\n再额外加入一条不同规则。` },
    );
    assert.equal(changedPrompt.response.status, 409);
    assert.equal(changedPrompt.payload.code, 'GAME_PREVIEW_MISMATCH');
    const changedSeries = await sendPreview(
      users.a,
      bound.payload.previewToken,
      'preview-changed-series-key-01',
      { seriesId: 'future-trailer' },
    );
    assert.equal(changedSeries.response.status, 409);
    assert.equal(changedSeries.payload.code, 'GAME_PREVIEW_MISMATCH');
    const forged = await sendPreview(users.a, 'forged_preview_token_1234567890', 'preview-forged-token-key-001');
    assert.equal(forged.response.status, 410);
    assert.equal(forged.payload.code, 'GAME_PREVIEW_EXPIRED');

    const stale = await makePreview();
    await jsonRequest(baseUrl, '/api/carnival/messages', {
      method: 'POST', token: users.b.token, body: { content: '预览之后新增的一条公开聊天。' },
    });
    const staleSend = await sendPreview(users.a, stale.payload.previewToken, 'preview-stale-chat-key-0001');
    assert.equal(staleSend.response.status, 409);
    assert.equal(staleSend.payload.code, 'GAME_PREVIEW_STALE');

    const [previewA, alternatePreviewA, previewB] = await Promise.all([
      makePreview(users.a),
      makePreview(users.a),
      makePreview(users.b),
    ]);
    const sentA = await sendPreview(users.a, previewA.payload.previewToken, 'preview-parallel-a-key-00001');
    const replayedA = await sendPreview(users.a, previewA.payload.previewToken, 'preview-parallel-a-key-00001');
    assert.equal(replayedA.response.status, 201);
    assert.equal(replayedA.payload.invite.inviteId, sentA.payload.invite.inviteId);
    const callsBeforeVersionConflict = aiCalls;
    const changedPreviewSameKey = await sendPreview(
      users.a,
      alternatePreviewA.payload.previewToken,
      'preview-parallel-a-key-00001',
    );
    assert.equal(changedPreviewSameKey.response.status, 409);
    assert.equal(changedPreviewSameKey.payload.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(aiCalls, callsBeforeVersionConflict);
    const afterConflict = await jsonRequest(baseUrl, '/api/carnival/state', { token: users.a.token });
    assert.equal(afterConflict.payload.room.invites.length, 1);

    const sentB = await sendPreview(users.b, previewB.payload.previewToken, 'preview-parallel-b-key-00001');
    assert.equal(sentA.response.status, 201);
    assert.equal(sentB.response.status, 201);
    assert.notEqual(sentA.payload.invite.inviteId, sentB.payload.invite.inviteId);
    const reusedWithNewKey = await sendPreview(users.a, previewA.payload.previewToken, 'preview-second-send-key-0001');
    assert.equal(reusedWithNewKey.response.status, 409);
    assert.equal(reusedWithNewKey.payload.code, 'GAME_PREVIEW_ALREADY_USED');
    assert.equal(aiCalls, 5);
  }, { configStore, aiService });
});

test('prompt-game preview tokens expire after five minutes', async () => {
  let timestamp = 1_900_000_000_000;
  let aiCalls = 0;
  const configStore = createMemoryConfigStore({ apiKey: 'test-only-provider-key' });
  const aiService = {
    async generate(_config, match, selection) {
      aiCalls += 1;
      return buildCarnivalFallbackGame(match, selection.templateId, selection.gameLabel, {
        seriesId: selection.seriesId,
        prompt: selection.prompt,
      });
    },
  };
  await withCarnival(async (baseUrl) => {
    const users = await pairedUsers(baseUrl);
    await unlock(baseUrl, users);
    const prompt = '请生成一局星空轨道主题的双人小游戏，让双方用星球卡片猜彼此的轻松偏好。';
    const preview = await jsonRequest(baseUrl, '/api/carnival/game-preview', {
      method: 'POST', token: users.a.token,
      body: { templateId: 'custom', seriesId: 'prompt-arcade', prompt },
    });
    assert.equal(preview.response.status, 201);
    assert.equal(Date.parse(preview.payload.expiresAt), timestamp + 5 * 60_000);
    timestamp += 5 * 60_000 + 1;
    const expired = await jsonRequest(baseUrl, '/api/carnival/invites', {
      method: 'POST', token: users.a.token,
      headers: { 'Idempotency-Key': 'preview-expired-send-key-001' },
      body: {
        templateId: 'custom', seriesId: 'prompt-arcade', prompt,
        previewToken: preview.payload.previewToken,
      },
    });
    assert.equal(expired.response.status, 410);
    assert.equal(expired.payload.code, 'GAME_PREVIEW_EXPIRED');
    assert.equal(aiCalls, 1);
  }, { configStore, aiService, httpOptions: { now: () => timestamp } });
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
