import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildArcadeFallbackGame } from './arcade-game.mjs';
import { createCarnivalService } from './carnival-service.mjs';
import { buildExclusiveFallbackGame } from './exclusive-series.mjs';

const PROMPT = '请根据双方公开聊天中的共同兴趣，生成一局轻松、安全、没有标准答案的双人破冰小游戏。';

function profileGame() {
  return {
    schemaVersion: 2,
    templateId: 'profile-riddle',
    title: '三个词里的第一印象',
    mechanics: {
      kind: 'profile-riddle',
      keywordOptions: ['真诚', '有趣', '细腻', '松弛', '好奇', '热爱生活'],
      sentencePattern: '我猜你是一个……的人。',
    },
  };
}

function wheelGame() {
  return {
    schemaVersion: 2,
    templateId: 'keyword-wheel',
    title: '转到哪里聊哪里',
    mechanics: {
      kind: 'keyword-wheel',
      segments: [
        { id: 's1', keyword: '周末', prompt: '理想周末是什么样？', followUp: '最近一次是什么时候？' },
        { id: 's2', keyword: '摄影', prompt: '最近拍过什么照片？', followUp: '为什么想记录它？' },
        { id: 's3', keyword: '旅行', prompt: '最想重游哪里？', followUp: '那里最吸引你的是什么？' },
      ],
    },
  };
}

function rapidGame(questionCount = 3) {
  return {
    schemaVersion: 2,
    templateId: 'rapid-choice',
    title: '五秒直觉二选一',
    mechanics: { kind: 'rapid-choice', roundSeconds: 5 },
    questions: Array.from({ length: questionCount }, (_, index) => ({
      id: `q${index + 1}`,
      prompt: `第 ${index + 1} 题，你会选择哪一种周末安排？`,
      options: [`选项 A${index + 1}`, `选项 B${index + 1}`],
    })),
  };
}

function exclusiveGame(seriesId = 'courtside') {
  return buildExclusiveFallbackGame({
    match_id: 'service-exclusive-match',
    user_a: { profile: '', memories_self: [], memories_ideal: [] },
    user_b: { profile: '', memories_self: [], memories_ideal: [] },
    messages: [
      { from: 'a', type: 'text', content: '周末一起聊电影和摄影。', sent_at: '2026-08-22T00:00:00Z' },
    ],
  }, seriesId);
}

function legacyExclusiveGame(seriesId = 'courtside') {
  const current = exclusiveGame(seriesId);
  const { engine: _engine, presentation: _presentation, ending: _ending, ...legacy } = current;
  const { engine: _mechanicsEngine, ...legacyMechanics } = current.mechanics;
  return {
    ...legacy,
    schemaVersion: 2,
    questions: current.questions.map(({ interaction: _interaction, ...question }) => ({
      ...question,
      options: question.options.length >= 3
        ? question.options
        : [...question.options, '换一个轻松方式'],
    })),
    mechanics: legacyMechanics,
  };
}

async function withStateDir(run, options = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), 'carnival-service-'));
  try {
    await run(stateDir, createCarnivalService({ stateDir, ...options }));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

async function pair(service, names = ['小林', '小余']) {
  const male = await service.join({ nickname: names[0], gender: 'male' });
  const female = await service.join({ nickname: names[1], gender: 'female' });
  const maleState = await service.getState(male.token);
  assert.equal(maleState.status, 'matched');
  assert.equal(female.state.status, 'matched');
  return {
    maleToken: male.token,
    femaleToken: female.token,
    maleId: maleState.self.participantId,
    femaleId: female.state.self.participantId,
  };
}

async function unlock(service, tokens) {
  let result;
  for (let index = 0; index < 10; index += 1) {
    const token = index % 2 === 0 ? tokens.maleToken : tokens.femaleToken;
    result = await service.sendMessage(token, {
      content: index === 0 ? '我周末喜欢摄影和散步。' : `这是第 ${index + 1} 条轻松聊天。`,
    });
    assert.equal(result.state.canInvite, index >= 9);
  }
  return result.state;
}

function hasCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

test('matches opposite genders FIFO and never exposes bearer tokens in participant state', async () => {
  await withStateDir(async (_stateDir, service) => {
    const firstMale = await service.join({ nickname: '先来的男生', gender: 'male' });
    const secondMale = await service.join({ nickname: '后来的男生', gender: 'male' });
    const female = await service.join({ nickname: '女生', gender: 'female' });

    assert.equal(female.state.status, 'matched');
    assert.equal(female.state.peer.participantId, firstMale.state.self.participantId);
    assert.equal((await service.getState(firstMale.token)).peer.participantId, female.state.self.participantId);
    assert.equal((await service.getState(secondMale.token)).status, 'queued');
    assert.equal(JSON.stringify(female.state).includes(female.token), false);
    assert.equal('token' in female.state.self, false);
    assert.equal(female.state.room.participants.length, 2);
  });
});

test('unlocks invitations at exactly ten text messages and builds a safe deterministic prompt', async () => {
  await withStateDir(async (_stateDir, service) => {
    const players = await pair(service);
    await assert.rejects(
      () => service.buildPrompt(players.maleToken, { templateId: 'profile-riddle' }),
      hasCode('INVITE_LOCKED'),
    );
    const state = await unlock(service, players);
    assert.equal(state.messageCount, 10);
    assert.equal(state.unlockAt, 10);
    assert.equal(state.room.textMessageCount, 10);
    assert.equal(state.room.inviteThreshold, 10);
    assert.equal(state.room.messages.length, 10);
    assert.equal(state.canInvite, true);

    const preview = await service.buildPrompt(players.femaleToken, { templateId: 'profile-riddle' });
    assert.equal(preview.templateId, 'profile-riddle');
    assert.match(preview.prompt, /摄影/);
    assert.match(preview.prompt, /不要引用联系方式/);
  });
});

test('serializes concurrent independent invites and deduplicates mobile retries per creator key', async () => {
  await withStateDir(async (_stateDir, service) => {
    const players = await pair(service);
    await unlock(service, players);
    const profileRequest = {
      templateId: 'profile-riddle',
      prompt: PROMPT,
      game: profileGame(),
      idempotencyKey: 'profile-double-click-key-001',
    };
    const wheelRequest = {
      templateId: 'keyword-wheel',
      prompt: PROMPT,
      game: wheelGame(),
      idempotencyKey: 'wheel-double-click-key-0001',
    };
    const [profile, wheel] = await Promise.all([
      service.createInvite(players.maleToken, profileRequest),
      service.createInvite(players.femaleToken, wheelRequest),
    ]);

    assert.notEqual(profile.invite.inviteId, wheel.invite.inviteId);
    assert.equal(profile.invite.creatorId, players.maleId);
    assert.equal(wheel.invite.creatorId, players.femaleId);
    assert.equal(profile.invite.game.definition.mechanics.kind, 'profile-riddle');
    assert.equal(wheel.invite.game.definition.mechanics.kind, 'keyword-wheel');

    const retried = await service.createInvite(players.maleToken, profileRequest);
    assert.equal(retried.reused, true);
    assert.equal(retried.invite.inviteId, profile.invite.inviteId);
    assert.equal(retried.state.invites.length, 2);
    assert.equal(retried.state.room.invites.length, 2);
    assert.equal(retried.state.messageCount, 10);
    assert.equal(retried.state.messages.filter((item) => item.type === 'invite').length, 2);
    assert.equal(retried.state.room.messages.length, 10);
  });
});

test('binds preview-backed invitation idempotency to a hashed preview version', async () => {
  await withStateDir(async (stateDir, service) => {
    const players = await pair(service);
    await unlock(service, players);
    const previewVersionHash = 'a'.repeat(43);
    const request = {
      templateId: 'custom',
      seriesId: 'courtside',
      prompt: PROMPT,
      game: exclusiveGame('courtside'),
      idempotencyKey: 'preview-version-service-key-01',
      previewVersionHash,
    };
    const created = await service.createInvite(players.maleToken, request);
    const replayed = await service.createInvite(players.maleToken, request);
    assert.equal(replayed.reused, true);
    assert.equal(replayed.invite.inviteId, created.invite.inviteId);

    await assert.rejects(
      () => service.createInvite(players.maleToken, {
        ...request,
        previewVersionHash: 'b'.repeat(43),
      }),
      hasCode('IDEMPOTENCY_CONFLICT'),
    );
    assert.equal((await service.getState(players.maleToken)).invites.length, 1);
    const persisted = await readFile(join(stateDir, 'carnival-state.json'), 'utf8');
    assert.equal(persisted.includes(previewVersionHash), false);
  });
});

test('keeps profile sentences and keywords private until both participants submit', async () => {
  await withStateDir(async (_stateDir, service) => {
    const players = await pair(service);
    await unlock(service, players);
    const created = await service.createInvite(players.maleToken, {
      templateId: 'profile-riddle', prompt: PROMPT, game: profileGame(),
    });
    const inviteId = created.invite.inviteId;
    await service.joinInvite(players.femaleToken, inviteId);
    await assert.rejects(
      () => service.gameAction(players.maleToken, inviteId, {
        type: 'profile-submit',
        keywords: ['真诚', '有趣', '好奇'],
        sentence: '我猜你很真诚，可以加微信号 unsafe_12345 继续聊。',
      }),
      hasCode('INVALID_ACTION'),
    );
    await service.gameAction(players.maleToken, inviteId, {
      type: 'profile-submit',
      keywords: ['真诚', '有趣', '好奇'],
      sentence: '我猜你是一个真诚、有趣，而且愿意探索新东西的人。',
    });

    const femaleView = (await service.getInvite(players.femaleToken, inviteId)).invite;
    const hiddenPeerAction = femaleView.actions.find((action) => action.type === 'profile-submit');
    assert.equal(femaleView.status, 'playing');
    assert.equal(femaleView.progress.peerSubmitted, true);
    assert.equal(femaleView.privateState.keywords, null);
    assert.equal(femaleView.privateState.sentence, null);
    assert.equal(femaleView.reveal, null);
    assert.equal(hiddenPeerAction.hidden, true);
    assert.equal('payload' in hiddenPeerAction, false);

    const completed = await service.gameAction(players.femaleToken, inviteId, {
      type: 'profile-submit',
      keywords: ['细腻', '松弛', '热爱生活'],
      sentence: '我猜你是一个细腻、松弛，也很懂得享受生活的人。',
    });
    assert.equal(completed.invite.status, 'completed');
    assert.equal(
      completed.invite.reveal.answers[players.maleId].sentence,
      '我猜你是一个真诚、有趣，而且愿意探索新东西的人。',
    );
    assert.deepEqual(
      completed.invite.reveal.answers[players.femaleId].keywords,
      ['细腻', '松弛', '热爱生活'],
    );

    const outsiders = await pair(service, ['另一位男生', '另一位女生']);
    await assert.rejects(
      () => service.getInvite(outsiders.maleToken, inviteId),
      hasCode('INVITE_NOT_FOUND'),
    );
  });
});

test('shares a server-selected wheel result with both participants', async () => {
  await withStateDir(async (_stateDir, service) => {
    const players = await pair(service);
    await unlock(service, players);
    const created = await service.createInvite(players.maleToken, {
      templateId: 'keyword-wheel', prompt: PROMPT, game: wheelGame(),
    });
    await service.joinInvite(players.femaleToken, created.invite.inviteId);
    await service.gameAction(players.maleToken, created.invite.inviteId, { type: 'wheel-spin' });

    const peerView = (await service.getInvite(players.femaleToken, created.invite.inviteId)).invite;
    assert.equal(peerView.shared.lastSpin.segment.id, 's2');
    assert.equal(peerView.shared.lastSpin.segment.keyword, '摄影');
    assert.deepEqual(peerView.actions.at(-1).payload, { segmentId: 's2' });
  }, { randomInt: () => 1 });
});

test('auto-starts five-second rapid rounds, times out late choices, and hides peer answers until completion', async () => {
  let timestamp = 50_000;
  await withStateDir(async (_stateDir, service) => {
    const players = await pair(service);
    await unlock(service, players);
    const created = await service.createInvite(players.maleToken, {
      templateId: 'rapid-choice', prompt: PROMPT, game: rapidGame(3),
    });
    const inviteId = created.invite.inviteId;
    const joined = await service.joinInvite(players.femaleToken, inviteId);
    assert.equal(joined.invite.privateState.currentQuestionId, 'q1');
    assert.equal(joined.invite.privateState.deadlineAt, timestamp + 5_000);
    const maleStarted = (await service.getInvite(players.maleToken, inviteId)).invite;
    assert.equal(maleStarted.privateState.currentQuestionId, 'q1');

    timestamp += 5_751;
    const late = await service.gameAction(players.maleToken, inviteId, {
      type: 'rapid-answer', questionId: 'q1', answer: 0,
    });
    assert.equal(late.action.payload.answer, 'timeout');
    assert.equal(late.action.payload.late, true);
    await service.gameAction(players.maleToken, inviteId, {
      type: 'rapid-answer', questionId: 'q2', answer: 1,
    });
    await service.gameAction(players.maleToken, inviteId, {
      type: 'rapid-answer', questionId: 'q3', answer: 0,
    });
    await service.gameAction(players.femaleToken, inviteId, {
      type: 'rapid-answer', questionId: 'q1', answer: 1,
    });
    await service.gameAction(players.femaleToken, inviteId, {
      type: 'rapid-answer', questionId: 'q2', answer: 0,
    });

    const beforeReveal = (await service.getInvite(players.femaleToken, inviteId)).invite;
    assert.equal(beforeReveal.reveal, null);
    assert.equal(beforeReveal.progress.peerAnswered, 3);
    assert.equal(
      beforeReveal.actions.filter((action) => action.actorId === players.maleId && action.type === 'rapid-answer')
        .every((action) => action.hidden && !('payload' in action)),
      true,
    );

    const completed = await service.gameAction(players.femaleToken, inviteId, {
      type: 'rapid-answer', questionId: 'q3', answer: 1,
    });
    assert.equal(completed.invite.status, 'completed');
    assert.equal(completed.invite.reveal.answers[players.maleId].answers.q1, 'timeout');
    assert.equal(completed.invite.reveal.answers[players.femaleId].answers.q3, 1);
  }, { now: () => timestamp });
});

test('runs custom series as a private alternating three-round server state machine', async () => {
  await withStateDir(async (_stateDir, service) => {
    const players = await pair(service);
    await unlock(service, players);
    const game = exclusiveGame('courtside');
    assert.equal(game.schemaVersion, 3);
    assert.equal(game.engine, 'exclusive-choice-v1');
    const created = await service.createInvite(players.maleToken, {
      templateId: 'custom',
      seriesId: 'courtside',
      prompt: PROMPT,
      game,
      idempotencyKey: 'exclusive-courtside-key-001',
    });
    const inviteId = created.invite.inviteId;
    let joined = await service.joinInvite(players.femaleToken, inviteId);
    assert.equal(joined.invite.seriesId, 'courtside');
    assert.equal(joined.invite.progress.answererId, players.maleId);
    assert.equal(joined.invite.progress.guesserId, players.femaleId);
    assert.equal(joined.invite.game.definition.presentation.scene, 'court');
    assert.equal(joined.invite.game.definition.questions[0].interaction.kind, 'card-grid');
    assert.equal(typeof joined.invite.game.definition.ending.chatPrompt, 'string');

    await assert.rejects(
      () => service.gameAction(players.femaleToken, inviteId, {
        type: 'exclusive-guess', questionId: game.questions[0].id, guess: 1,
        requestId: 'guess-too-early-001', expectedRevision: joined.invite.revision,
      }),
      hasCode('ANSWER_NOT_READY'),
    );
    await assert.rejects(
      () => service.gameAction(players.femaleToken, inviteId, {
        type: 'exclusive-answer', questionId: game.questions[0].id, answer: 1,
        requestId: 'wrong-answer-role-01', expectedRevision: joined.invite.revision,
      }),
      hasCode('WRONG_GAME_ROLE'),
    );

    for (let roundIndex = 0; roundIndex < game.questions.length; roundIndex += 1) {
      const question = game.questions[roundIndex];
      const answererToken = roundIndex % 2 === 0 ? players.maleToken : players.femaleToken;
      const guesserToken = roundIndex % 2 === 0 ? players.femaleToken : players.maleToken;
      const answererId = roundIndex % 2 === 0 ? players.maleId : players.femaleId;
      const guesserId = roundIndex % 2 === 0 ? players.femaleId : players.maleId;
      const beforeAnswer = (await service.getInvite(answererToken, inviteId)).invite;
      const answerRequest = `exclusive-answer-round-${roundIndex}`;
      const answered = await service.gameAction(answererToken, inviteId, {
        type: 'exclusive-answer',
        questionId: question.id,
        answer: roundIndex % question.options.length,
        requestId: answerRequest,
        expectedRevision: beforeAnswer.revision,
      });
      const replay = await service.gameAction(answererToken, inviteId, {
        type: 'exclusive-answer',
        questionId: question.id,
        answer: roundIndex % question.options.length,
        requestId: answerRequest,
        expectedRevision: beforeAnswer.revision,
      });
      assert.equal(replay.reused, true);
      assert.equal(replay.action.id, answered.action.id);

      const guesserView = (await service.getInvite(guesserToken, inviteId)).invite;
      assert.equal(guesserView.progress.answerSubmitted, true);
      assert.equal(guesserView.privateState.answers[question.id], undefined);
      assert.equal(guesserView.reveal, null);
      const hiddenAnswer = guesserView.actions.find(
        (action) => action.type === 'exclusive-answer' && action.payload?.questionId === question.id ||
          action.type === 'exclusive-answer' && action.hidden,
      );
      assert.equal(hiddenAnswer.hidden, true);
      assert.equal('payload' in hiddenAnswer, false);

      const beforeGuess = (await service.getInvite(guesserToken, inviteId)).invite;
      const guessed = await service.gameAction(guesserToken, inviteId, {
        type: 'exclusive-guess',
        questionId: question.id,
        guess: (roundIndex + 1) % question.options.length,
        requestId: `exclusive-guess-round-${roundIndex}`,
        expectedRevision: beforeGuess.revision,
      });
      const result = guessed.invite.shared.exclusive.revealedRounds[roundIndex];
      assert.equal(result.questionId, question.id);
      assert.equal(result.answererId, answererId);
      assert.equal(result.guesserId, guesserId);
      assert.equal(Number.isInteger(result.answer), true);
      assert.equal(Number.isInteger(result.guess), true);

      const beforeNext = (await service.getInvite(answererToken, inviteId)).invite;
      const advanced = await service.gameAction(answererToken, inviteId, {
        type: 'exclusive-next',
        questionId: question.id,
        requestId: `exclusive-next-round-${roundIndex}`,
        expectedRevision: beforeNext.revision,
      });
      if (roundIndex < game.questions.length - 1) {
        assert.equal(advanced.invite.progress.roundIndex, roundIndex + 1);
        assert.equal(advanced.invite.progress.answererId, guesserId);
      } else {
        assert.equal(advanced.invite.status, 'completed');
        assert.equal(advanced.invite.reveal.rounds.length, 3);
      }
    }
  });
});

test('runs persisted arcade v4 with isolated roles, concurrent actor sequences, bounded events, and capability runtime', async () => {
  let timestamp = 100_000;
  await withStateDir(async (stateDir, service) => {
    const players = await pair(service);
    await unlock(service, players);
    const game = buildArcadeFallbackGame({ match_id: 'arcade-service-match', messages: [] }, '专属小游戏', {
      prompt: '做一个一人投篮、一人移动篮筐的篮球游戏',
    });
    const created = await service.createInvite(players.maleToken, {
      templateId: 'custom',
      seriesId: 'prompt-arcade',
      prompt: PROMPT,
      game,
      idempotencyKey: 'arcade-service-invite-key-01',
    });
    const inviteId = created.invite.inviteId;
    assert.equal(created.invite.game.definition.schemaVersion, 4);
    assert.equal(created.invite.game.definition.engine, 'arcade-v1');
    assert.equal(created.invite.game.definition.arcade.preset, 'basketball-duel');
    assert.equal(created.invite.game.definition.artifact.document, undefined);
    assert.match(created.invite.game.definition.artifact.runtimePath, /^\/api\/carnival\/games\/runtime\/artifact_/);
    assert.equal(JSON.stringify(created.invite).includes('<!doctype html>'), false);

    const runtime = await service.getArcadeArtifact(game.artifact.artifactId);
    assert.equal(runtime.codeHash, game.artifact.codeHash);
    assert.match(runtime.document, /^<!doctype html>/);

    const joined = await service.joinInvite(players.femaleToken, inviteId);
    assert.equal(joined.invite.progress.selfRole, 'keeper');
    assert.equal((await service.getInvite(players.maleToken, inviteId)).invite.progress.selfRole, 'shooter');

    await Promise.all([
      service.gameAction(players.maleToken, inviteId, {
        type: 'arcade-ready', seq: 0, requestId: 'arcade-ready-male-0001',
      }),
      service.gameAction(players.femaleToken, inviteId, {
        type: 'arcade-ready', seq: 0, requestId: 'arcade-ready-female-01',
      }),
    ]);
    timestamp += 1_001;
    const beforeInputs = (await service.getInvite(players.maleToken, inviteId)).invite.revision;
    const [aimed, moved] = await Promise.all([
      service.gameAction(players.maleToken, inviteId, {
        type: 'arcade-input', seq: 1, control: 'aim', value: 0.25,
        requestId: 'arcade-aim-male-000001', expectedRevision: -999,
      }),
      service.gameAction(players.femaleToken, inviteId, {
        type: 'arcade-input', seq: 1, control: 'move', value: -1,
        requestId: 'arcade-move-female-001', expectedRevision: -999,
      }),
    ]);
    assert.equal(aimed.invite.revision > beforeInputs, true);
    assert.equal(moved.invite.revision > beforeInputs, true);
    const shot = await service.gameAction(players.maleToken, inviteId, {
      type: 'arcade-input', seq: 2, control: 'shoot', value: 1,
      requestId: 'arcade-shoot-male-0001',
    });
    assert.equal(shot.invite.shared.arcade.frame.ball.inFlight, true);
    const ballAtShot = shot.invite.shared.arcade.frame.ball;
    timestamp += 500;
    const polled = (await service.getInvite(players.maleToken, inviteId)).invite;
    assert.equal(polled.shared.arcade.frame.tick > shot.invite.shared.arcade.frame.tick, true);
    assert.notDeepEqual(polled.shared.arcade.frame.ball, ballAtShot);
    const replay = await service.gameAction(players.maleToken, inviteId, {
      type: 'arcade-input', seq: 1, control: 'aim', value: 0.25,
      requestId: 'arcade-aim-male-000001', expectedRevision: 0,
    });
    assert.equal(replay.reused, true);
    await assert.rejects(
      () => service.gameAction(players.maleToken, inviteId, {
        type: 'arcade-input', seq: 3, control: 'power', value: 0.9,
        requestId: 'arcade-aim-male-000001',
      }),
      hasCode('IDEMPOTENCY_CONFLICT'),
    );

    const femaleView = (await service.getInvite(players.femaleToken, inviteId)).invite;
    assert.deepEqual(femaleView.privateState.input, { move: -1 });
    const peerAimEvent = femaleView.shared.arcade.events.find((event) => event.control === 'aim');
    assert.deepEqual(peerAimEvent, {
      cursor: 3,
      eventId: 'event-3',
      seq: 1,
      actorRole: 'shooter',
      type: 'input',
      control: 'aim',
      value: 0.25,
      serverAt: timestamp - 500,
    });
    assert.equal(JSON.stringify(femaleView.shared.arcade.events).includes(players.maleId), false);
    const hiddenPeerInput = femaleView.actions.find((entry) => entry.type === 'arcade-input' && entry.actorId === players.maleId);
    assert.equal(hiddenPeerInput.hidden, true);
    assert.equal('payload' in hiddenPeerInput, false);

    const strategyGame = buildArcadeFallbackGame({ match_id: 'arcade-strategy-match', messages: [] }, '专属小游戏', {
      prompt: '做一个九宫格策略对抗小游戏',
    });
    const strategy = await service.createInvite(players.femaleToken, {
      templateId: 'custom', seriesId: 'prompt-arcade', prompt: PROMPT,
      game: strategyGame, idempotencyKey: 'arcade-strategy-invite-key-01',
    });
    await service.joinInvite(players.maleToken, strategy.invite.inviteId);
    await service.gameAction(players.femaleToken, strategy.invite.inviteId, {
      type: 'arcade-ready', seq: 0, requestId: 'strategy-ready-female-001',
    });
    const isolatedBasketball = (await service.getInvite(players.femaleToken, inviteId)).invite;
    const isolatedStrategy = (await service.getInvite(players.femaleToken, strategy.invite.inviteId)).invite;
    assert.equal(isolatedBasketball.shared.arcade.events.some((event) => event.actorRole.includes('commander')), false);
    assert.equal(isolatedStrategy.shared.arcade.events.length, 1);
    assert.equal(isolatedStrategy.shared.arcade.events[0].actorRole, 'coral-commander');

    for (let index = 2; index < 70; index += 1) {
      timestamp += 50;
      await service.gameAction(players.femaleToken, inviteId, {
        type: 'arcade-tick', seq: index, requestId: `arcade-tick-female-${index}`,
      });
    }
    const bounded = (await service.getInvite(players.femaleToken, inviteId)).invite;
    assert.equal(bounded.actions.length, 64);
    assert.equal(bounded.revision > 64, true);

    const persisted = await readFile(join(stateDir, 'carnival-state.json'), 'utf8');
    assert.match(persisted, /<!doctype html>/);
    const restored = createCarnivalService({ stateDir, now: () => timestamp });
    const restoredView = (await restored.getInvite(players.maleToken, inviteId)).invite;
    assert.equal(restoredView.progress.selfRole, 'shooter');
    assert.equal(restoredView.game.definition.artifact.document, undefined);
    assert.equal(restoredView.game.definition.artifact.codeHash, game.artifact.codeHash);
  }, { now: () => timestamp });
});

test('accepts persisted v2 custom games and strictly rejects forged v3 runtime fields', async () => {
  await withStateDir(async (stateDir, service) => {
    const players = await pair(service);
    await unlock(service, players);
    const legacyGame = legacyExclusiveGame('future-trailer');
    const legacy = await service.createInvite(players.maleToken, {
      templateId: 'custom',
      seriesId: 'future-trailer',
      prompt: PROMPT,
      game: legacyGame,
      idempotencyKey: 'legacy-custom-v2-restore-key',
    });
    assert.equal(legacy.invite.game.definition.schemaVersion, 2);
    assert.equal(legacy.invite.game.definition.engine, undefined);

    const restored = createCarnivalService({ stateDir });
    const restoredInvite = (await restored.getInvite(players.femaleToken, legacy.invite.inviteId)).invite;
    assert.equal(restoredInvite.game.definition.schemaVersion, 2);
    assert.equal(restoredInvite.game.definition.questions[0].interaction, undefined);

    const valid = exclusiveGame('courtside');
    const forgedGames = [
      { ...valid, engine: 'javascript-v1' },
      { ...valid, presentation: { ...valid.presentation, scene: 'https://evil.example' } },
      { ...valid, ending: { ...valid.ending, chatPrompt: '<script>alert(1)</script>' } },
      {
        ...valid,
        questions: valid.questions.map((question, index) => index === 0
          ? { ...question, interaction: { kind: 'card-grid', variant: 'stack' } }
          : question),
      },
    ];
    for (const [index, game] of forgedGames.entries()) {
      await assert.rejects(
        () => restored.createInvite(players.maleToken, {
          templateId: 'custom',
          seriesId: 'courtside',
          prompt: PROMPT,
          game,
          idempotencyKey: `forged-v3-runtime-key-${index}`.padEnd(24, 'x'),
        }),
        hasCode('INVALID_GAME'),
      );
    }
    const state = await restored.getState(players.maleToken);
    assert.equal(state.invites.length, 1);
  });
});

test('custom actions use an invite-local revision that is unaffected by writes in another room', async () => {
  await withStateDir(async (_stateDir, service) => {
    const players = await pair(service, ['主房间男生', '主房间女生']);
    await unlock(service, players);
    const game = exclusiveGame('courtside');
    const created = await service.createInvite(players.maleToken, {
      templateId: 'custom',
      seriesId: 'courtside',
      prompt: PROMPT,
      game,
      idempotencyKey: 'invite-local-revision-key-001',
    });
    const inviteId = created.invite.inviteId;
    const joined = await service.joinInvite(players.femaleToken, inviteId);
    const inviteRevision = joined.invite.revision;
    const globalRevision = joined.state.revision;

    const otherRoom = await pair(service, ['另一个房间男生', '另一个房间女生']);
    await service.sendMessage(otherRoom.maleToken, { content: '另一个房间发生了一次完全无关的写操作。' });
    const afterOtherWrite = await service.getState(players.maleToken);
    assert.equal(afterOtherWrite.revision > globalRevision, true);
    assert.equal(
      afterOtherWrite.invites.find((invite) => invite.inviteId === inviteId).revision,
      inviteRevision,
    );

    const answered = await service.gameAction(players.maleToken, inviteId, {
      type: 'exclusive-answer',
      questionId: game.questions[0].id,
      answer: 1,
      requestId: 'other-room-write-answer-001',
      expectedRevision: inviteRevision,
    });
    assert.equal(answered.invite.progress.answerSubmitted, true);
    assert.equal(answered.invite.revision, inviteRevision + 1);
  });
});

test('custom action request ids reject reuse with a different action or payload', async () => {
  await withStateDir(async (_stateDir, service) => {
    const players = await pair(service);
    await unlock(service, players);
    const game = exclusiveGame('contrast-lab');
    const created = await service.createInvite(players.maleToken, {
      templateId: 'custom',
      seriesId: 'contrast-lab',
      prompt: PROMPT,
      game,
      idempotencyKey: 'action-fingerprint-invite-key-01',
    });
    const inviteId = created.invite.inviteId;
    const joined = await service.joinInvite(players.femaleToken, inviteId);
    const questionId = game.questions[0].id;
    const requestId = 'same-action-request-id-001';
    const answered = await service.gameAction(players.maleToken, inviteId, {
      type: 'exclusive-answer',
      questionId,
      answer: 0,
      requestId,
      expectedRevision: joined.invite.revision,
    });

    await assert.rejects(
      () => service.gameAction(players.maleToken, inviteId, {
        type: 'exclusive-answer',
        questionId,
        answer: 1,
        requestId,
        expectedRevision: answered.invite.revision,
      }),
      hasCode('IDEMPOTENCY_CONFLICT'),
    );
    await assert.rejects(
      () => service.gameAction(players.maleToken, inviteId, {
        type: 'exclusive-next',
        questionId,
        requestId,
        expectedRevision: answered.invite.revision,
      }),
      hasCode('IDEMPOTENCY_CONFLICT'),
    );

    const unchanged = (await service.getInvite(players.maleToken, inviteId)).invite;
    assert.equal(unchanged.actions.length, 1);
    assert.equal(unchanged.revision, answered.invite.revision);
  });
});

test('restores unrevealed custom answers without leaking them and keeps simultaneous series invites isolated', async () => {
  await withStateDir(async (stateDir, service) => {
    const players = await pair(service);
    await unlock(service, players);
    const [courtside, trailer] = await Promise.all([
      service.createInvite(players.maleToken, {
        templateId: 'custom', seriesId: 'courtside', prompt: PROMPT,
        game: exclusiveGame('courtside'), idempotencyKey: 'multi-courtside-key-0001',
      }),
      service.createInvite(players.femaleToken, {
        templateId: 'custom', seriesId: 'future-trailer', prompt: PROMPT,
        game: exclusiveGame('future-trailer'), idempotencyKey: 'multi-trailer-key-000001',
      }),
    ]);
    assert.notEqual(courtside.invite.inviteId, trailer.invite.inviteId);
    await service.joinInvite(players.femaleToken, courtside.invite.inviteId);
    await service.joinInvite(players.maleToken, trailer.invite.inviteId);
    const fresh = (await service.getInvite(players.maleToken, courtside.invite.inviteId)).invite;
    const questionId = courtside.invite.game.definition.questions[0].id;
    await service.gameAction(players.maleToken, courtside.invite.inviteId, {
      type: 'exclusive-answer', questionId, answer: 2,
      requestId: 'persist-answer-custom-01', expectedRevision: fresh.revision,
    });

    const restored = createCarnivalService({ stateDir });
    const femaleView = await restored.getState(players.femaleToken);
    const restoredCourt = femaleView.invites.find((invite) => invite.inviteId === courtside.invite.inviteId);
    const restoredTrailer = femaleView.invites.find((invite) => invite.inviteId === trailer.invite.inviteId);
    assert.equal(restoredCourt.progress.answerSubmitted, true);
    assert.equal(restoredCourt.privateState.answers[questionId], undefined);
    assert.equal(JSON.stringify(restoredCourt).includes('"answer":2'), false);
    assert.equal(restoredTrailer.seriesId, 'future-trailer');
    assert.equal(restoredTrailer.progress.answerSubmitted, false);
    assert.equal(restoredTrailer.actions.length, 0);

    const beforeGuess = (await restored.getInvite(players.femaleToken, courtside.invite.inviteId)).invite;
    const revealed = await restored.gameAction(players.femaleToken, courtside.invite.inviteId, {
      type: 'exclusive-guess', questionId, guess: 1,
      requestId: 'persist-guess-custom-01', expectedRevision: beforeGuess.revision,
    });
    assert.equal(revealed.invite.shared.exclusive.revealedRounds[0].answer, 2);
    const untouched = (await restored.getInvite(players.femaleToken, trailer.invite.inviteId)).invite;
    assert.equal(untouched.actions.length, 0);
    assert.equal(untouched.progress.roundIndex, 0);
  });
});

test('restores rooms and private progress from disk while persisting only token hashes', async () => {
  await withStateDir(async (stateDir, firstService) => {
    const players = await pair(firstService);
    await unlock(firstService, players);
    const request = {
      templateId: 'profile-riddle',
      prompt: PROMPT,
      game: profileGame(),
      idempotencyKey: 'persisted-profile-key-0001',
    };
    const created = await firstService.createInvite(players.maleToken, request);
    const inviteId = created.invite.inviteId;
    await firstService.joinInvite(players.femaleToken, inviteId);
    await firstService.gameAction(players.maleToken, inviteId, {
      type: 'profile-submit',
      keywords: ['真诚', '有趣', '好奇'],
      sentence: '我猜你是一个真诚、有趣，而且总能发现新鲜事物的人。',
    });
    const raw = await readFile(join(stateDir, 'carnival-state.json'), 'utf8');
    assert.equal(raw.includes(players.maleToken), false);
    assert.equal(raw.includes(players.femaleToken), false);
    assert.equal(raw.includes(request.idempotencyKey), false);
    assert.match(raw, /tokenHash/);

    const restored = createCarnivalService({ stateDir });
    const state = await restored.getState(players.femaleToken);
    assert.equal(state.status, 'matched');
    assert.equal(state.invites[0].progress.peerSubmitted, true);
    assert.equal(state.invites[0].reveal, null);
    const retried = await restored.createInvite(players.maleToken, request);
    assert.equal(retried.reused, true);
    assert.equal(retried.invite.inviteId, inviteId);
    assert.equal(retried.state.invites.length, 1);
    assert.equal(retried.state.revision, state.revision);
    const completed = await restored.gameAction(players.femaleToken, inviteId, {
      type: 'profile-submit',
      keywords: ['细腻', '松弛', '热爱生活'],
      sentence: '我猜你是一个细腻、松弛，也很会感受日常幸福的人。',
    });
    assert.equal(completed.invite.status, 'completed');
  });
});

test('enforces identity, content, capacity, game-shape, and expiry limits', async () => {
  let timestamp = 10_000;
  await withStateDir(async (_stateDir, service) => {
    await assert.rejects(
      () => service.join({ nickname: '未知', gender: 'other' }),
      hasCode('INVALID_GENDER'),
    );
    await assert.rejects(
      () => service.join({ nickname: '太'.repeat(41), gender: 'male' }),
      hasCode('INVALID_INPUT'),
    );
    const players = await pair(service);
    await assert.rejects(
      () => service.sendMessage(players.maleToken, { content: '长'.repeat(1_001) }),
      hasCode('INVALID_INPUT'),
    );
    await assert.rejects(
      () => service.createInvite(players.maleToken, {
        templateId: 'profile-riddle', prompt: PROMPT, game: profileGame(),
      }),
      hasCode('INVITE_LOCKED'),
    );
    await unlock(service, players);
    await assert.rejects(
      () => service.createInvite(players.maleToken, {
        templateId: 'rapid-choice', prompt: PROMPT, game: rapidGame(2),
      }),
      hasCode('INVALID_GAME'),
    );
    await assert.rejects(
      () => service.createInvite(players.maleToken, {
        templateId: 'profile-riddle', prompt: PROMPT, game: profileGame(), idempotencyKey: 'too-short',
      }),
      hasCode('INVALID_INPUT'),
    );
    await assert.rejects(
      () => service.createInvite(players.maleToken, {
        templateId: 'profile-riddle',
        prompt: '请生成游戏，完成后联系手机号 138 1234 5678 继续沟通。',
        game: profileGame(),
      }),
      hasCode('INVALID_INPUT'),
    );
    await assert.rejects(
      () => service.createInvite(players.maleToken, {
        templateId: 'profile-riddle',
        prompt: PROMPT,
        game: { ...profileGame(), description: '详情见 https://unsafe.example' },
      }),
      hasCode('INVALID_GAME'),
    );
    const safeMetadata = await service.createInvite(players.maleToken, {
      templateId: 'profile-riddle',
      prompt: PROMPT,
      game: {
        ...profileGame(),
        id: '123456789',
        matchId: 'room_123456789',
        generatedAt: '2026-08-22T12:34:56.000Z',
      },
    });
    assert.equal(safeMetadata.invite.templateId, 'profile-riddle');
    await assert.rejects(
      () => service.join({ nickname: '容量之外', gender: 'male' }),
      hasCode('CARNIVAL_FULL'),
    );
  }, { maxParticipants: 2, now: () => timestamp });

  await withStateDir(async (stateDir, service) => {
    const queued = await service.join({ nickname: '会过期', gender: 'male' });
    timestamp += 1_001;
    await assert.rejects(() => service.getState(queued.token), hasCode('UNAUTHORIZED'));
    assert.equal((await readFile(join(stateDir, 'carnival-state.json'), 'utf8')).includes('会过期'), false);
  }, { queueTtlMs: 1_000, now: () => timestamp });
});

test('prunes expired invites and rooms without leaving reusable session tokens', async () => {
  let timestamp = 200_000;
  await withStateDir(async (_stateDir, service) => {
    const players = await pair(service);
    await unlock(service, players);
    await service.createInvite(players.maleToken, {
      templateId: 'keyword-wheel', prompt: PROMPT, game: wheelGame(),
    });
    timestamp += 1_001;
    const state = await service.getState(players.femaleToken);
    assert.equal(state.invites.length, 0);
    assert.equal(state.messages.filter((item) => item.type === 'invite').length, 0);
    assert.equal(state.messageCount, 10);
  }, { inviteTtlMs: 1_000, now: () => timestamp });

  await withStateDir(async (_stateDir, service) => {
    const players = await pair(service);
    timestamp += 1_001;
    await assert.rejects(() => service.getState(players.maleToken), hasCode('UNAUTHORIZED'));
    await assert.rejects(() => service.getState(players.femaleToken), hasCode('UNAUTHORIZED'));
  }, { roomTtlMs: 1_000, now: () => timestamp });
});
