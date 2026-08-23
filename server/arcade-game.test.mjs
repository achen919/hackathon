import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Script as VmScript } from 'node:vm';
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
  supportsArcadePresentationOnly,
} from './arcade-game.mjs';

const match = { match_id: 'arcade-test-match', messages: [] };
const PRESET_PAIRS = [
  ['competition', 'dash-duel'],
  ['cooperation', 'tandem-rescue'],
  ['sport', 'basketball-duel'],
  ['adventure', 'relic-expedition'],
  ['strategy', 'grid-command'],
];

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
  assert.deepEqual([...ARCADE_GAME_KINDS], PRESET_PAIRS.map(([kind]) => kind));
  assert.deepEqual([...ARCADE_GAME_PRESETS], PRESET_PAIRS.map(([, preset]) => preset));
  for (const [kind, preset] of PRESET_PAIRS) {
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
  assert.match(FALLBACK_ARCADE_DOCUMENT, /function dragMove/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /按住向左/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /presentationOnly/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /pairplay-presentation/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /controls\.hidden=presentationOnly/u);
  assert.equal(supportsArcadePresentationOnly(FALLBACK_ARCADE_DOCUMENT), true);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /冲刺加速/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /同步脉冲/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /跳跃探索/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /举盾防护/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /for\(let index=0;index<9/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /落点 /u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /mode==='dash-duel'/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /mode==='tandem-rescue'/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /mode==='relic-expedition'/u);
  assert.match(FALLBACK_ARCADE_DOCUMENT, /mode==='grid-command'/u);
  assert.doesNotMatch(FALLBACK_ARCADE_DOCUMENT, /等待双方进入游戏/u);
  const script = FALLBACK_ARCADE_DOCUMENT.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.equal(typeof script, 'string');
  assert.doesNotThrow(() => new VmScript(script));
});

test('new documents for all five presets must expose their complete mobile control path', () => {
  const controlsByPreset = {
    'dash-duel': ['move', 'boost'],
    'tandem-rescue': ['move', 'sync'],
    'basketball-duel': ['aim', 'power', 'shoot', 'move'],
    'relic-expedition': ['move', 'jump', 'guard'],
    'grid-command': ['select', 'commit'],
  };
  for (const [kind, preset] of PRESET_PAIRS) {
    const candidate = payload({ kind, preset });
    assert.equal(isArcadeGamePayload(candidate), true, preset);
    for (const control of controlsByPreset[preset]) {
      assert.equal(isArcadeGamePayload({
        ...candidate,
        document: candidate.document.replaceAll(`'${control}'`, `'missing-${control}'`),
      }), false, `${preset} requires ${control}`);
    }
    assert.equal(isArcadeGamePayload({
      ...candidate,
      document: candidate.document.replaceAll('setPointerCapture', 'capturePointer'),
    }), false, `${preset} requires pointer capture`);
    assert.equal(isArcadeGamePayload({
      ...candidate,
      document: candidate.document.replaceAll('pointerdown', 'mousedown'),
    }), false, `${preset} requires pointerdown`);
    assert.equal(isArcadeGamePayload({
      ...candidate,
      document: candidate.document.replaceAll('touch-action', 'touch-behavior'),
    }), false, `${preset} requires touch-action`);
    assert.equal(isArcadeGamePayload({
      ...candidate,
      document: candidate.document.replace('pairplay-presentation', 'legacy-presentation'),
    }), false, `${preset} requires host-only presentation contract`);
    assert.equal(isArcadeGamePayload({
      ...candidate,
      document: candidate.document.replaceAll('controls.hidden=presentationOnly', 'controls.hidden=false'),
    }), false, `${preset} must hide generated controls in host-only mode`);
    const withoutPointerMove = {
      ...candidate,
      document: candidate.document.replaceAll('pointermove', 'mousemove'),
    };
    assert.equal(isArcadeGamePayload(withoutPointerMove), preset === 'grid-command', `${preset} move gesture`);
  }
});

test('keeps persisted schema v4 invitations for all five presets readable after the mobile gate', () => {
  for (const [kind, preset] of PRESET_PAIRS) {
    const current = buildArcadeGameDefinition(payload({ kind, preset }), {
      id: `persisted-${preset}-v4`, matchId: 'persisted-match', generatedBy: 'fallback',
    });
    const legacyDocument = current.artifact.document
      .replaceAll('pointermove', 'mousemove')
      .replaceAll('setPointerCapture', 'capturePointer')
      .replaceAll('touch-action', 'touch-behavior')
      .replace('pairplay-presentation', 'legacy-presentation')
      .replaceAll('controls.hidden=presentationOnly', 'controls.hidden=false');
    const persisted = {
      ...current,
      artifact: {
        ...current.artifact,
        document: legacyDocument,
        codeHash: createHash('sha256').update(legacyDocument).digest('hex'),
      },
    };
    assert.deepEqual(assertArcadeGameDefinition(persisted), persisted, preset);
    assert.equal(supportsArcadePresentationOnly(legacyDocument), false, preset);
  }
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
  assert.equal(applyArcadeAction(definition, session, 'player-b', {
    type: 'arcade-input', seq: 2, control: 'move', value: 0,
  }, 2_050).ok, true, 'an emergency release must bypass the continuous-input throttle');
  assert.equal(session.inputsByParticipant['player-b'].move, 0);
  assert.equal(applyArcadeAction(definition, session, 'player-a', {
    type: 'arcade-input', seq: 4, control: 'aim', value: -0.2,
  }, 2_050).code, 'ACTION_THROTTLED');
  assert.equal(applyArcadeAction(definition, session, 'player-a', {
    type: 'arcade-input', seq: 3, control: 'aim', value: 0,
  }, 2_050).code, 'STALE_ACTION');

  const advanced = applyArcadeAction(definition, session, 'player-b', {
    type: 'arcade-tick', seq: 3,
  }, 2_501);
  assert.equal(advanced.ok, true);
  assert.equal(session.frame.tick > 0, true);
  assert.equal(session.frame.remainingMs < definition.arcade.params.durationMs, true);

  const shooterView = arcadeSessionProjection(definition, session, 'player-a');
  const keeperView = arcadeSessionProjection(definition, session, 'player-b');
  assert.equal(shooterView.self.role, 'shooter');
  assert.equal(keeperView.self.role, 'keeper');
  assert.deepEqual(shooterView.self.input, { aim: 0.3, power: 0.8, shoot: 1 });
  assert.deepEqual(keeperView.self.input, { move: 0 });
  assert.deepEqual(shooterView.events, keeperView.events);
  assert.equal(shooterView.events.some((event) => event.actorRole === 'shooter' && event.control === 'shoot'), true);
  assert.equal(JSON.stringify(shooterView.events).includes('player-a'), false);
  assert.equal(JSON.stringify(shooterView.events).includes('player-b'), false);
  assert.equal('assignments' in shooterView, false);
  assert.equal('inputsByParticipant' in shooterView, false);
  assert.equal(JSON.stringify(keeperView).includes('"aim":0.3'), false);
});

test('normalizes persisted generic frames and advances public positions from authoritative move input', () => {
  const movablePresets = [
    ['competition', 'dash-duel'],
    ['cooperation', 'tandem-rescue'],
    ['adventure', 'relic-expedition'],
  ];
  for (const [kind, preset] of movablePresets) {
    const definition = buildArcadeGameDefinition(payload({ kind, preset }), {
      id: `moving-${preset}`, matchId: 'moving-match', generatedBy: 'ai',
    });
    const session = createArcadeSession(definition, ['a', 'b'], 'a', 0);
    delete session.frame.positions;
    delete session.frame.movement;
    delete session.frame.grid;
    delete session.generic;
    session.lastContinuousAtByParticipant.a = 900;

    const legacyView = arcadeSessionProjection(definition, session, 'a');
    const startX = Math.round(definition.arcade.params.arenaWidth * 0.14);
    assert.equal(legacyView.frame.positions.primary.x, startX, `${preset} legacy primary position`);
    assert.deepEqual(legacyView.frame.movement, { primary: 0, secondary: 0 });
    assert.equal(legacyView.frame.grid, null);

    assert.equal(applyArcadeAction(definition, session, 'a', { type: 'arcade-ready', seq: 0 }, 0).ok, true);
    assert.equal(applyArcadeAction(definition, session, 'b', { type: 'arcade-ready', seq: 0 }, 0).ok, true);
    assert.equal(applyArcadeAction(definition, session, 'a', {
      type: 'arcade-input', seq: 1, control: 'move', value: 1,
    }, 1_001).ok, true, preset);
    assert.equal(session.frame.movement.primary, 1, `${preset} immediate movement feedback`);
    assert.equal(applyArcadeAction(definition, session, 'a', {
      type: 'arcade-tick', seq: 2,
    }, 1_501).ok, true);

    const movingView = arcadeSessionProjection(definition, session, 'a');
    assert.equal(movingView.frame.positions.primary.x > startX, true, `${preset} authoritative x movement`);
    assert.equal(movingView.frame.movement.primary, 1);
    assert.equal('assignments' in movingView, false);
    assert.equal('inputsByParticipant' in movingView, false);

    assert.equal(applyArcadeAction(definition, session, 'a', {
      type: 'arcade-input', seq: 3, control: 'move', value: 0,
    }, 1_601).ok, true);
    assert.equal(arcadeSessionProjection(definition, session, 'a').frame.movement.primary, 0);
  }
});

test('keeps grid selections private until both commits, then publishes and resets the round', () => {
  const definition = buildArcadeGameDefinition(payload({ kind: 'strategy', preset: 'grid-command' }), {
    id: 'private-grid-command', matchId: 'private-grid-match', generatedBy: 'ai',
  });
  const session = createArcadeSession(definition, ['a', 'b'], 'a', 0);
  assert.equal(applyArcadeAction(definition, session, 'a', { type: 'arcade-ready', seq: 0 }, 0).ok, true);
  assert.equal(applyArcadeAction(definition, session, 'b', { type: 'arcade-ready', seq: 0 }, 0).ok, true);
  assert.equal(applyArcadeAction(definition, session, 'a', {
    type: 'arcade-input', seq: 1, control: 'select', value: 7,
  }, 1_001).ok, true);

  let left = arcadeSessionProjection(definition, session, 'a');
  let right = arcadeSessionProjection(definition, session, 'b');
  assert.deepEqual(left.events.filter((event) => event.control === 'select').map((event) => event.value), [7]);
  assert.deepEqual(right.events.filter((event) => event.control === 'select'), []);
  assert.deepEqual(left.frame.event, { type: 'select', role: 'coral-commander' });
  assert.equal(right.frame.event, null);
  assert.equal(left.frame.grid, null);
  assert.equal(right.frame.grid, null);

  assert.equal(applyArcadeAction(definition, session, 'b', {
    type: 'arcade-input', seq: 1, control: 'select', value: 2,
  }, 1_001).ok, true);
  left = arcadeSessionProjection(definition, session, 'a');
  right = arcadeSessionProjection(definition, session, 'b');
  assert.deepEqual(left.events.filter((event) => event.control === 'select').map((event) => event.value), [7]);
  assert.deepEqual(right.events.filter((event) => event.control === 'select').map((event) => event.value), [2]);
  assert.equal(left.frame.event, null);
  assert.deepEqual(right.frame.event, { type: 'select', role: 'blue-commander' });
  assert.deepEqual(left.self.input, { select: 7 });
  assert.deepEqual(right.self.input, { select: 2 });

  assert.equal(applyArcadeAction(definition, session, 'a', {
    type: 'arcade-input', seq: 2, control: 'commit', value: 1,
  }, 1_101).ok, true);
  assert.equal(applyArcadeAction(definition, session, 'b', {
    type: 'arcade-input', seq: 2, control: 'commit', value: 1,
  }, 1_101).ok, true);

  left = arcadeSessionProjection(definition, session, 'a');
  right = arcadeSessionProjection(definition, session, 'b');
  assert.equal(left.frame.round, 2);
  assert.deepEqual(left.frame.score, { primary: 1, secondary: 0, team: 0 });
  assert.deepEqual(left.frame.grid, {
    round: 1,
    selections: { primary: 7, secondary: 2 },
    result: 'primary',
  });
  assert.deepEqual(right.frame.grid, left.frame.grid);
  assert.deepEqual(left.self.input, {});
  assert.deepEqual(right.self.input, {});
  assert.deepEqual(session.generic.selectedByParticipant, {});
  assert.deepEqual(session.generic.committedByParticipant, {});
  assert.deepEqual(left.events.filter((event) => event.control === 'select').map((event) => event.value), [7]);
  assert.deepEqual(right.events.filter((event) => event.control === 'select').map((event) => event.value), [2]);

  assert.equal(applyArcadeAction(definition, session, 'a', {
    type: 'arcade-input', seq: 3, control: 'select', value: 4,
  }, 1_201).ok, true);
  assert.deepEqual(arcadeSessionProjection(definition, session, 'a').self.input, { select: 4 });
  assert.deepEqual(arcadeSessionProjection(definition, session, 'b').self.input, {});
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
    if (item.preset === 'grid-command') assert.notDeepEqual(left.events, right.events);
    else assert.deepEqual(left.events, right.events);
    assert.equal(left.events.some((event) => event.actorRole === definition.arcade.roles[0].id), true);
    assert.equal(JSON.stringify(left.events).includes('"a"'), false);
  }
});
