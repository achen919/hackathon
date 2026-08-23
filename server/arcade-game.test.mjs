import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  ARCADE_GAME_ENGINE,
  ARCADE_GAME_KINDS,
  ARCADE_GAME_PRESETS,
  ARCADE_GAME_SCHEMA_VERSION,
  FALLBACK_ARCADE_DOCUMENT,
  applyArcadeAction,
  arcadePresetForPrompt,
  arcadeSessionProjection,
  assertArcadeGameDefinition,
  buildArcadeFallbackGame,
  buildArcadeGameDefinition,
  createArcadeSession,
  isArcadeGamePayload,
} from './arcade-game.mjs';

const match = { match_id: 'arcade-test-match', messages: [] };

function payload(overrides = {}) {
  return {
    title: '默契篮球移动篮筐挑战',
    eyebrow: '双人运动挑战',
    description: '一人调整投篮角度和力度，另一人左右移动篮筐完成即时攻防。',
    whyItFits: '把共同感兴趣的运动变成一次真正需要双方操作的轻量小游戏。',
    estimatedMinutes: 1,
    topics: ['篮球运动', '双人攻防'],
    kind: 'sport',
    preset: 'basketball-duel',
    theme: 'sunset',
    difficulty: 'normal',
    tuning: { durationSeconds: 45, speedPercent: 100, targetScore: 5, maxRounds: 10 },
    document: FALLBACK_ARCADE_DOCUMENT,
    ...overrides,
  };
}

test('accepts only the five paired preset kinds and expands server-owned roles and numeric params', () => {
  const pairs = [
    ['competition', 'dash-duel'],
    ['cooperation', 'tandem-rescue'],
    ['sport', 'basketball-duel'],
    ['adventure', 'relic-expedition'],
    ['strategy', 'grid-command'],
  ];
  assert.deepEqual([...ARCADE_GAME_KINDS], pairs.map(([kind]) => kind));
  assert.deepEqual([...ARCADE_GAME_PRESETS], pairs.map(([, preset]) => preset));
  for (const [kind, preset] of pairs) {
    const candidate = payload({ kind, preset });
    assert.equal(isArcadeGamePayload(candidate), true, preset);
    const definition = buildArcadeGameDefinition(candidate, {
      id: `game-${preset}`,
      matchId: 'match-safe',
      generatedBy: 'ai',
    });
    assert.equal(definition.schemaVersion, ARCADE_GAME_SCHEMA_VERSION);
    assert.equal(definition.engine, ARCADE_GAME_ENGINE);
    assert.equal(definition.arcade.kind, kind);
    assert.equal(definition.arcade.preset, preset);
    assert.equal(definition.arcade.roles.length, 2);
    assert.equal(Number.isInteger(definition.arcade.params.durationMs), true);
    assert.deepEqual(assertArcadeGameDefinition(definition), definition);
  }
  assert.equal(isArcadeGamePayload(payload({ kind: 'strategy', preset: 'basketball-duel' })), false);
});

test('rejects executable fields, forged controls, external references, and out-of-range tuning', () => {
  assert.equal(isArcadeGamePayload({ ...payload(), javascript: 'alert(1)' }), false);
  assert.equal(isArcadeGamePayload(payload({ title: '<img src=x onerror=alert(1)>' })), false);
  assert.equal(isArcadeGamePayload(payload({ whyItFits: '请打开 https://evil.example 后继续这一局。' })), false);
  assert.equal(isArcadeGamePayload(payload({ tuning: { ...payload().tuning, speedPercent: 500 } })), false);
  assert.equal(isArcadeGamePayload(payload({
    document: FALLBACK_ARCADE_DOCUMENT.replace('draw()})();', "fetch('/leak');draw()})();"),
  })), false);
  for (const dangerous of [
    'eval("1")',
    'new Function("return 1")()',
    'Function("return 1")()',
    'WebAssembly.compile(bytes)',
    'new SharedArrayBuffer(32)',
    'Atomics.wait(view,0,0)',
    'queueMicrotask(spin)',
    'globalThis["loc"+"ation"]="/escape"',
    'while(true){}',
    'for(;;){}',
    'document.write("x")',
    'stage.innerHTML="x"',
    'stage.outerHTML',
    'stage.insertAdjacentHTML("beforeend","x")',
    'new DOMParser()',
    'window.open("/escape")',
    'location="/escape"',
    'window.location.href="/escape"',
    'parent.document.body',
    'top.location="/escape"',
    'opener.postMessage({})',
  ]) {
    assert.equal(isArcadeGamePayload(payload({
      document: FALLBACK_ARCADE_DOCUMENT.replace('draw()})();', `${dangerous};draw()})();`),
    })), false, dangerous);
  }
  assert.equal(isArcadeGamePayload(payload({
    document: FALLBACK_ARCADE_DOCUMENT.replace("'use strict';", ''),
  })), false);
  assert.equal(isArcadeGamePayload(payload({
    document: FALLBACK_ARCADE_DOCUMENT.replace('</body>', '<script>\'use strict\';</script></body>'),
  })), false);
  assert.equal(isArcadeGamePayload(payload({
    document: FALLBACK_ARCADE_DOCUMENT.replace('<canvas id="stage"', '<canvas onclick="shoot()" id="stage"'),
  })), false);

  const valid = buildArcadeGameDefinition(payload(), {
    id: 'safe-basketball-game', matchId: 'safe-match', generatedBy: 'ai',
  });
  assert.throws(
    () => assertArcadeGameDefinition({
      ...valid,
      arcade: {
        ...valid.arcade,
        roles: valid.arcade.roles.map((role, index) => index === 0
          ? { ...role, controls: [...role.controls, 'eval-javascript'] }
          : role),
      },
    }),
    /Invalid safe arcade-v1/,
  );
  assert.throws(
    () => assertArcadeGameDefinition({ ...valid, renderer: '<canvas onclick=run()>' }),
    /Invalid safe arcade-v1/,
  );
});

test('fallback runtime bootstraps PairPlay and provides a local-opponent preview mode', () => {
  assert.match(FALLBACK_ARCADE_DOCUMENT, /game\.bootstrap-ready/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /playMode==='preview'/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /previewState/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /Math\.sin\(now\/620\)/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /grid-template-rows:minmax\(0,1fr\) auto/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /setPointerCapture/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /keeperPointerMove/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /按住向左/u);
  assert.doesNotMatch(FALLBACK_ARCADE_DOCUMENT, /等待双方进入游戏/u);
});

test('basketball documents must expose a real mobile pointer control path', () => {
  assert.equal(isArcadeGamePayload(payload()), true);
  assert.equal(isArcadeGamePayload(payload({
    document: FALLBACK_ARCADE_DOCUMENT.replaceAll('pointermove', 'mousemove'),
  })), false);
  assert.equal(isArcadeGamePayload(payload({
    document: FALLBACK_ARCADE_DOCUMENT.replaceAll('setPointerCapture', 'capturePointer'),
  })), false);
});

test('keeps persisted schema v4 basketball invitations readable after the mobile gate', () => {
  const current = buildArcadeGameDefinition(payload(), {
    id: 'persisted-basketball-v4', matchId: 'persisted-match', generatedBy: 'fallback',
  });
  const legacyDocument = current.artifact.document
    .replaceAll('pointermove', 'mousemove')
    .replaceAll('setPointerCapture', 'capturePointer');
  const persisted = {
    ...current,
    artifact: {
      ...current.artifact,
      document: legacyDocument,
      codeHash: createHash('sha256').update(legacyDocument).digest('hex'),
    },
  };
  assert.deepEqual(assertArcadeGameDefinition(persisted), persisted);
});

test('classifies prompts across all presets and defaults the prompt arcade to basketball', () => {
  assert.equal(arcadePresetForPrompt('做一个有人投篮、有人移动篮筐的篮球游戏'), 'basketball-duel');
  assert.equal(arcadePresetForPrompt('想玩双人同步合作救援'), 'tandem-rescue');
  assert.equal(arcadePresetForPrompt('做一个探索遗迹的冒险'), 'relic-expedition');
  assert.equal(arcadePresetForPrompt('来一局九宫格策略对抗'), 'grid-command');
  assert.equal(arcadePresetForPrompt('做一个竞速冲线比赛'), 'dash-duel');
  assert.equal(arcadePresetForPrompt('给我们来一个真正能玩的小游戏'), 'basketball-duel');
  assert.equal(buildArcadeFallbackGame(match).arcade.preset, 'basketball-duel');
});

test('runs an authoritative basketball frame with roles, sequenced input, and private projections', () => {
  const definition = buildArcadeFallbackGame(match);
  const session = createArcadeSession(definition, ['player-a', 'player-b'], 'player-a', 1_000);
  assert.equal(session.phase, 'waiting');

  assert.equal(applyArcadeAction(definition, session, 'player-a', {
    type: 'arcade-ready', seq: 0,
  }, 1_000).ok, true);
  assert.equal(applyArcadeAction(definition, session, 'player-b', {
    type: 'arcade-ready', seq: 0,
  }, 1_000).ok, true);
  assert.equal(session.phase, 'countdown');

  const countdownTrigger = applyArcadeAction(definition, session, 'player-a', {
    type: 'arcade-input', seq: 1, control: 'shoot', value: 1,
  }, 1_500);
  assert.equal(countdownTrigger.code, 'COUNTDOWN_ACTIVE');
  assert.equal(session.lastSeqByParticipant['player-a'], 0);

  assert.equal(applyArcadeAction(definition, session, 'player-a', {
    type: 'arcade-input', seq: 1, control: 'aim', value: 0.3,
  }, 2_001).ok, true);
  assert.equal(applyArcadeAction(definition, session, 'player-a', {
    type: 'arcade-input', seq: 2, control: 'power', value: 0.8,
  }, 2_001).ok, true);
  assert.equal(applyArcadeAction(definition, session, 'player-b', {
    type: 'arcade-input', seq: 1, control: 'move', value: -1,
  }, 2_001).ok, true);
  assert.equal(applyArcadeAction(definition, session, 'player-a', {
    type: 'arcade-input', seq: 3, control: 'shoot', value: 1,
  }, 2_001).ok, true);
  assert.equal(session.frame.ball.inFlight, true);
  assert.equal(session.frame.shots.taken, 1);

  assert.equal(applyArcadeAction(definition, session, 'player-b', {
    type: 'arcade-input', seq: 2, control: 'shoot', value: 1,
  }, 2_050).code, 'WRONG_GAME_ROLE');
  assert.equal(applyArcadeAction(definition, session, 'player-b', {
    type: 'arcade-input', seq: 2, control: 'move', value: 1,
  }, 2_050).code, 'ACTION_THROTTLED');
  assert.equal(applyArcadeAction(definition, session, 'player-a', {
    type: 'arcade-input', seq: 4, control: 'aim', value: -0.2,
  }, 2_050).code, 'ACTION_THROTTLED');
  assert.equal(applyArcadeAction(definition, session, 'player-a', {
    type: 'arcade-input', seq: 3, control: 'aim', value: 0,
  }, 2_050).code, 'STALE_ACTION');

  const advanced = applyArcadeAction(definition, session, 'player-b', {
    type: 'arcade-tick', seq: 2,
  }, 2_501);
  assert.equal(advanced.ok, true);
  assert.equal(session.frame.tick > 0, true);
  assert.equal(session.frame.remainingMs < definition.arcade.params.durationMs, true);

  const shooterView = arcadeSessionProjection(definition, session, 'player-a');
  const keeperView = arcadeSessionProjection(definition, session, 'player-b');
  assert.equal(shooterView.self.role, 'shooter');
  assert.equal(keeperView.self.role, 'keeper');
  assert.deepEqual(shooterView.self.input, { aim: 0.3, power: 0.8, shoot: 1 });
  assert.deepEqual(keeperView.self.input, { move: -1 });
  assert.deepEqual(shooterView.events, keeperView.events);
  assert.equal(shooterView.events.some((event) => event.actorRole === 'shooter' && event.control === 'shoot'), true);
  assert.equal(JSON.stringify(shooterView.events).includes('player-a'), false);
  assert.equal(JSON.stringify(shooterView.events).includes('player-b'), false);
  assert.equal('assignments' in shooterView, false);
  assert.equal('inputsByParticipant' in shooterView, false);
  assert.equal(JSON.stringify(keeperView).includes('"aim":0.3'), false);
});

test('runs bounded authoritative actions for competition, cooperation, adventure, and strategy presets', () => {
  const cases = [
    {
      kind: 'competition', preset: 'dash-duel',
      actions: [
        ['a', { type: 'arcade-input', seq: 1, control: 'boost', value: 1 }],
      ],
      check: (frame) => assert.equal(frame.score.primary, 1),
    },
    {
      kind: 'cooperation', preset: 'tandem-rescue',
      actions: [
        ['a', { type: 'arcade-input', seq: 1, control: 'sync', value: 1 }],
        ['b', { type: 'arcade-input', seq: 1, control: 'sync', value: 1 }],
      ],
      check: (frame) => assert.equal(frame.score.team, 1),
    },
    {
      kind: 'adventure', preset: 'relic-expedition',
      actions: [
        ['a', { type: 'arcade-input', seq: 1, control: 'jump', value: 1 }],
        ['b', { type: 'arcade-input', seq: 1, control: 'guard', value: 1 }],
      ],
      check: (frame) => assert.deepEqual(frame.score, { primary: 1, secondary: 1, team: 1 }),
    },
    {
      kind: 'strategy', preset: 'grid-command',
      actions: [
        ['a', { type: 'arcade-input', seq: 1, control: 'select', value: 7 }],
        ['b', { type: 'arcade-input', seq: 1, control: 'select', value: 2 }],
        ['a', { type: 'arcade-input', seq: 2, control: 'commit', value: 1 }],
        ['b', { type: 'arcade-input', seq: 2, control: 'commit', value: 1 }],
      ],
      check: (frame) => {
        assert.equal(frame.score.primary, 1);
        assert.equal(frame.round, 2);
      },
    },
  ];
  for (const item of cases) {
    const definition = buildArcadeGameDefinition(payload({ kind: item.kind, preset: item.preset }), {
      id: `game-${item.preset}`, matchId: 'generic-engine-match', generatedBy: 'ai',
    });
    const session = createArcadeSession(definition, ['a', 'b'], 'a', 0);
    assert.equal(applyArcadeAction(definition, session, 'a', { type: 'arcade-ready', seq: 0 }, 0).ok, true);
    assert.equal(applyArcadeAction(definition, session, 'b', { type: 'arcade-ready', seq: 0 }, 0).ok, true);
    for (const [participantId, action] of item.actions) {
      assert.equal(applyArcadeAction(definition, session, participantId, action, 1_001).ok, true, item.preset);
    }
    item.check(session.frame);
    const left = arcadeSessionProjection(definition, session, 'a');
    const right = arcadeSessionProjection(definition, session, 'b');
    assert.deepEqual(left.events, right.events);
    assert.equal(left.events.some((event) => event.actorRole === definition.arcade.roles[0].id), true);
    assert.equal(JSON.stringify(left.events).includes('"a"'), false);
  }
});
