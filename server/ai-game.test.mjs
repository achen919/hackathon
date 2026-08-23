import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FALLBACK_ARCADE_DOCUMENT,
  isArcadeGamePayload,
} from './arcade-game.mjs';
import {
  compactMatchForAi,
  createAiGameService,
  isGeneratedGamePayload,
  isGeneratedProfileRiddlePayload,
  isGeneratedPromptGamePayload,
} from './ai-game.mjs';
import {
  buildPromptPreview,
  isTemplateShapeValid,
  normalizePlayerPrompt,
} from './game-templates.mjs';

function gameType(id, label) {
  return {
    id,
    label,
    enabled: true,
    generationPrompt: `这是 ${label} 的安全测试模板，请严格遵循固定玩法并避免泄露任何私密资料。`,
  };
}

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
  gameTypes: [gameType('profile-riddle', '资料猜谜局')],
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

const validProfileQuestionsA = [
  {
    id: 'profile-social-state',
    label: '小猜测一',
    source: '根据公开资料延伸的轻松行为候选',
    prompt: '凭第一感觉，选一个更像 TA 的日常片段。',
    options: ['熟了以后话很多', '人多时先观察', '更喜欢一对一聊'],
    matchedFollowUp: '这条猜得挺准。愿意补充一个具体的小故事吗？',
    differentFollowUp: '这条猜反了也很好聊。你实际更接近哪种情况？',
  },
  {
    id: 'profile-travel',
    label: '小猜测二',
    source: '根据公开资料延伸的轻松行为候选',
    prompt: '凭第一感觉，再选一个更像 TA 的日常片段。',
    options: ['出门前会做点攻略', '到了地方再做决定', '经常临时改变路线'],
    matchedFollowUp: '这个小猜测挺准。哪次出门最能说明这一点？',
    differentFollowUp: '原来这条猜反了。你出门时通常会怎么安排？',
  },
  {
    id: 'profile-food',
    label: '小猜测三',
    source: '根据公开资料延伸的轻松行为候选',
    prompt: '凭第一感觉，最后选一个更像 TA 的日常片段。',
    options: ['为了吃会专门跑远', '就近找家顺眼的店', '点菜前会先问大家'],
    matchedFollowUp: '这条也猜得挺准。最近一次是什么时候？',
    differentFollowUp: '这个答案和猜测不同。你平时会怎么选？',
  },
];

const validProfileQuestionsB = [
  {
    ...validProfileQuestionsA[0],
    id: 'profile-communication',
    label: '猜猜聊天方式',
    source: '来自 B 的公开资料线索',
    prompt: '根据 B 的资料，哪个聊天片段更像 TA？',
    options: ['有话会当面说', '想清楚再回消息', '聊天时常抛问题'],
  },
  {
    ...validProfileQuestionsA[1],
    id: 'profile-weekend',
    label: '猜猜周末片段',
    source: '来自 B 的公开资料线索',
    prompt: '根据 B 的资料，哪个周末片段更像 TA？',
    options: ['周末会留半天空白', '早起就出门走走', '当天再决定去哪'],
  },
  {
    ...validProfileQuestionsA[2],
    id: 'profile-interest',
    label: '猜猜投入方式',
    source: '来自 B 的公开资料线索',
    prompt: '根据 B 的资料，哪个投入片段更像 TA？',
    options: ['入坑后会连刷好几天', '喜欢拉人一起体验', '偶尔想起再玩一会'],
  },
];

const validProfilePayload = {
  gameType: validPayload.gameType,
  title: '凭第一感觉猜三个生活片段',
  eyebrow: validPayload.eyebrow,
  description: validPayload.description,
  whyItFits: validPayload.whyItFits,
  estimatedMinutes: validPayload.estimatedMinutes,
  topics: ['小猜测一', '小猜测二', '小猜测三'],
  questionsByTarget: {
    a: validProfileQuestionsA,
    b: validProfileQuestionsB,
  },
};

function profilePayloadWithOption(target, label) {
  return {
    ...validProfilePayload,
    questionsByTarget: {
      ...validProfilePayload.questionsByTarget,
      [target]: validProfilePayload.questionsByTarget[target].map((question, index) => index === 0
        ? { ...question, options: [label, ...question.options.slice(1)] }
        : question),
    },
  };
}

const validPromptPayload = {
  ...validPayload,
  estimatedMinutes: 4,
  presentation: {
    tone: 'violet',
    scene: 'archive',
    motion: 'slide',
    revealEffect: 'cards',
  },
  questions: validPayload.questions.map((question, index) => ({
    ...question,
    options: index === 1 ? question.options.slice(0, 2) : question.options,
    interaction: index === 0
      ? { kind: 'card-grid', variant: 'tickets' }
      : index === 1
        ? { kind: 'swipe-deck', variant: 'stack' }
        : { kind: 'orbit-pick', variant: 'constellation' },
  })),
  ending: {
    headline: '收下三条聊天线索',
    summary: '同频与不同答案都会成为下一段聊天的入口，这局没有输赢。',
    chatPrompt: '刚才哪一关的答案最让你意外，为什么？',
  },
};

const validArcadePayload = {
  title: '默契篮球移动篮筐挑战',
  eyebrow: 'AI 双人运动',
  description: '一人控制投篮角度和力度，另一人移动篮筐，在同一个画面里完成即时攻防。',
  whyItFits: '公开聊天里出现了运动话题，这种分工明确的实时玩法能自然制造配合和笑点。',
  estimatedMinutes: 1,
  topics: ['篮球运动', '双人攻防'],
  kind: 'sport',
  preset: 'basketball-duel',
  theme: 'sunset',
  difficulty: 'normal',
  tuning: { durationSeconds: 45, speedPercent: 100, targetScore: 5, maxRounds: 10 },
  document: FALLBACK_ARCADE_DOCUMENT,
};

test('validates output and keeps renamed labels on the stable profile-riddle mechanics', async () => {
  let requestBody;
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validProfilePayload) } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const renamedConfig = {
    ...config,
    gameTypes: [gameType('profile-riddle', '读懂彼此三连猜')],
  };
  const game = await createAiGameService({ fetchImpl }).generate(renamedConfig, match, {
    templateId: 'profile-riddle',
    prompt: '请围绕公开聊天里的周末兴趣，生成一局轻松、不越界的资料猜谜游戏。',
  });
  assert.equal(requestBody.response_format.type, 'json_schema');
  assert.equal(requestBody.model, 'test-model');
  assert.equal(requestBody.max_tokens, 2_500);
  assert.equal(game.generatedBy, 'ai');
  assert.equal(game.matchId, match.match_id);
  assert.equal(game.schemaVersion, 2);
  assert.equal(game.gameType, '读懂彼此三连猜');
  assert.equal(game.templateId, 'profile-riddle');
  assert.equal(game.mechanics.kind, 'profile-riddle');
  assert.notDeepEqual(game.mechanics.choiceGroupsByTarget.a, game.mechanics.choiceGroupsByTarget.b);
  assert.deepEqual(game.mechanics.choiceGroups, game.mechanics.choiceGroupsByTarget.b);
  assert.equal(game.mechanics.choiceGroups.length, 3);
  assert.deepEqual(game.mechanics.choiceGroups.map((group) => group.options.length), [3, 3, 3]);
  assert.equal(game.mechanics.keywordOptions.length, 9);
  assert.deepEqual(game.mechanics.keywordOptions, game.mechanics.choiceGroupsByTarget.b.flatMap((group) => group.options));
  assert.deepEqual(game.questions.map((question) => question.id), game.mechanics.choiceGroupsByTarget.b.map((group) => group.id));
  assert.equal(game.questionsByTarget.a.every((question) => question.label.startsWith('小猜测')), true);
  assert.equal(game.questionsByTarget.b.every((question) => question.source === '根据公开资料延伸的轻松行为候选'), true);
  assert.equal(game.questionsByTarget.a.every((question) => question.prompt === '凭第一感觉，选一个更像 TA 的日常片段。'), true);
  assert.match(game.mechanics.sentencePattern, /猜测一/);
  const profileSchema = requestBody.response_format.json_schema.schema;
  assert.deepEqual(profileSchema.required.includes('questions'), false);
  assert.deepEqual(profileSchema.properties.questionsByTarget.required, ['a', 'b']);
  assert.equal(profileSchema.properties.questionsByTarget.additionalProperties, false);
  assert.equal(profileSchema.properties.questionsByTarget.properties.a.maxItems, 3);
  assert.equal(profileSchema.properties.questionsByTarget.properties.b.items.properties.options.maxItems, 3);
  assert.match(JSON.stringify(requestBody.messages), /questionsByTarget\.a.*user_a\.public_profile_signals/s);
  assert.match(JSON.stringify(requestBody.messages), /questionsByTarget\.b.*from=b/s);
  assert.match(JSON.stringify(requestBody.messages), /不得把另一人的资料或发言当成当前 target/);
  assert.equal(isGeneratedProfileRiddlePayload(validProfilePayload), true);
  assert.equal(isGeneratedGamePayload(validPayload), true);
});

test('custom AI generation pins series id, guidance, shape, mechanics, and cache identity', async () => {
  let requestBody;
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validPromptPayload) } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const customConfig = {
    ...config,
    gameTypes: [gameType('custom', '专属小游戏')],
  };
  const service = createAiGameService({ fetchImpl });
  const game = await service.generate(customConfig, match, {
    templateId: 'custom',
    seriesId: 'chat-archaeology',
    prompt: '请围绕公开聊天中已经出现的话题，生成三轮安全的聊天考古小游戏。',
  });
  const serializedMessages = JSON.stringify(requestBody.messages);
  assert.match(serializedMessages, /chat-archaeology/);
  assert.match(serializedMessages, /exclusive_game_chat_archaeology_v1/);
  assert.equal(requestBody.response_format.json_schema.schema.properties.presentation.additionalProperties, false);
  assert.equal(game.templateId, 'custom');
  assert.equal(game.seriesId, 'chat-archaeology');
  assert.equal(game.schemaVersion, 3);
  assert.equal(game.engine, 'exclusive-choice-v1');
  assert.equal(game.presentation.scene, 'archive');
  assert.equal(game.questions[1].interaction.kind, 'swipe-deck');
  assert.equal(game.mechanics.kind, 'exclusive-series');
  assert.equal(game.mechanics.engine, 'exclusive-choice-v1');
  assert.equal(game.mechanics.templateKey, 'exclusive_game_chat_archaeology_v1');
  assert.equal(isGeneratedPromptGamePayload(validPromptPayload), true);
  assert.equal(isTemplateShapeValid(validPromptPayload, 'custom', 'chat-archaeology'), true);
  assert.equal(isTemplateShapeValid({
    ...validPromptPayload,
    questions: validPromptPayload.questions.map((question, index) => index === 0
      ? { ...question, interaction: { kind: 'swipe-deck', variant: 'stack' } }
      : question),
  }, 'custom', 'chat-archaeology'), false);
  assert.throws(
    () => isTemplateShapeValid(validPromptPayload, 'custom', 'missing'),
    /Unsupported exclusive game series/,
  );
  const firstKey = service.cacheKey(customConfig, match, { templateId: 'custom', seriesId: 'courtside' });
  const secondKey = service.cacheKey(customConfig, match, { templateId: 'custom', seriesId: 'future-trailer' });
  assert.notEqual(firstKey, secondKey);
});

test('prompt arcade AI returns a hashed isolated code artifact and uses the larger strict schema budget', async () => {
  let requestBody;
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validArcadePayload) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const arcadeConfig = { ...config, gameTypes: [gameType('custom', '专属小游戏')] };
  const game = await createAiGameService({ fetchImpl }).generate(arcadeConfig, match, {
    templateId: 'custom',
    seriesId: 'prompt-arcade',
    prompt: '生成一局真正能操作的篮球游戏，一人投篮，另一人移动篮筐。',
  });
  assert.equal(requestBody.max_tokens, 6_000);
  assert.equal(requestBody.response_format.json_schema.schema.properties.document.maxLength, 50_000);
  assert.match(JSON.stringify(requestBody.messages), /PairPlay v1/);
  assert.match(JSON.stringify(requestBody.messages), /game\.bootstrap-ready/);
  assert.match(JSON.stringify(requestBody.messages), /playMode.*preview/);
  assert.match(JSON.stringify(requestBody.messages), /playMode.*network/);
  assert.match(requestBody.messages.at(-2).content, /PairPlay v1/);
  assert.equal(isArcadeGamePayload(validArcadePayload), true);
  assert.equal(game.schemaVersion, 4);
  assert.equal(game.engine, 'arcade-v1');
  assert.equal(game.arcade.kind, 'sport');
  assert.equal(game.arcade.preset, 'basketball-duel');
  assert.match(game.artifact.artifactId, /^artifact_[A-Za-z0-9_-]{32}$/);
  assert.match(game.artifact.codeHash, /^[a-f0-9]{64}$/);
  assert.equal(game.artifact.document, FALLBACK_ARCADE_DOCUMENT);
  assert.equal(game.generatedBy, 'ai');
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
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validProfilePayload) } }] }), { status: 200 });
  };
  await createAiGameService({ fetchImpl }).generate(config, match, {
    templateId: 'profile-riddle',
  });
  assert.equal(calls, 2);
});

test('does not retry authentication failures', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'Invalid token' } }), { status: 401 });
  };
  await assert.rejects(
    () => createAiGameService({ fetchImpl }).generate(config, match, { templateId: 'profile-riddle' }),
    /HTTP 401/,
  );
  assert.equal(calls, 1);
});

test('rejects profile-riddle labels that wrap a known profile signal in arbitrary wording', async () => {
  for (const label of ['喜欢摄影', '平时很喜欢摄影', '摄影时候很投入']) {
    const restated = profilePayloadWithOption('b', label);
    const fetchImpl = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(restated) } }],
    }), { status: 200 });
    await assert.rejects(
      () => createAiGameService({ fetchImpl }).generate(config, match, { templateId: 'profile-riddle' }),
      /directly restated a known profile signal/,
    );
  }
});

test('requires both target question sets in profile-riddle output', async () => {
  const missingTarget = {
    ...validProfilePayload,
    questionsByTarget: { a: validProfileQuestionsA },
  };
  assert.equal(isGeneratedProfileRiddlePayload(missingTarget), false);
  const fetchImpl = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(missingTarget) } }],
  }), { status: 200 });
  await assert.rejects(
    () => createAiGameService({ fetchImpl }).generate(config, match, { templateId: 'profile-riddle' }),
    /AI game did not match the required schema/,
  );
});

test('checks direct restatement against the correct target profile and authored chat only', async () => {
  const boundaryMatch = {
    ...match,
    user_a: { ...match.user_a, profile: '# 喜欢摄影' },
    user_b: { ...match.user_b, profile: '# 喜欢旅行' },
    messages: [
      { from: 'a', type: 'text', content: '最近常去咖啡店', sent_at: '2026-08-22 10:00' },
      { from: 'b', type: 'text', content: '路上总放音乐', sent_at: '2026-08-22 10:01' },
    ],
  };
  const generate = (payload) => createAiGameService({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }), { status: 200 }),
  }).generate(config, boundaryMatch, { templateId: 'profile-riddle' });

  await assert.doesNotReject(() => generate(profilePayloadWithOption('b', '为了摄影会绕点路')));
  await assert.rejects(
    () => generate(profilePayloadWithOption('a', '为了摄影会绕点路')),
    /directly restated a known profile signal/,
  );
  await assert.rejects(
    () => generate(profilePayloadWithOption('a', '看到咖啡店会停下')),
    /directly restated a known profile signal/,
  );
  await assert.rejects(
    () => generate(profilePayloadWithOption('b', '路上会一直放音乐')),
    /directly restated a known profile signal/,
  );
});

test('rejects exact and prefix-wrapped non-allowlisted chat facts without crossing target boundaries', async () => {
  const potteryMatch = {
    ...match,
    user_a: { ...match.user_a, profile: '' },
    user_b: { ...match.user_b, profile: '' },
    messages: [
      { from: 'a', type: 'text', content: '我周末固定去陶艺工坊。', sent_at: '2026-08-22 10:00' },
    ],
  };
  const generate = (payload) => createAiGameService({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }), { status: 200 }),
  }).generate(config, potteryMatch, { templateId: 'profile-riddle' });

  await assert.rejects(
    () => generate(profilePayloadWithOption('a', '周末固定去陶艺')),
    /directly restated a known profile signal/,
  );
  await assert.rejects(
    () => generate(profilePayloadWithOption('a', '平时周末固定去陶艺')),
    /directly restated a known profile signal/,
  );
  await assert.doesNotReject(
    () => generate(profilePayloadWithOption('b', '平时周末固定去陶艺')),
  );
});

test('rejects malformed generated games before they reach the browser', () => {
  assert.equal(isGeneratedGamePayload({ ...validPayload, questions: [] }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, topics: ['重复', '重复'] }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, hiddenInstruction: 'do not expose' }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, whyItFits: '可以拨打 13812345678 继续联系。' }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, whyItFits: '可以拨打 138 1234 5678 继续联系。' }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, whyItFits: '也可以加微信号 abc12345 继续联系。' }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, whyItFits: '也可以加 qq号 12345678 继续联系。' }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, whyItFits: '也可以拨打 +1 415 555 2671 继续联系。' }), false);
  assert.equal(isGeneratedGamePayload({ ...validPayload, whyItFits: '来自对方资料里的离异经历，很适合继续追问。' }), false);
  assert.equal(isGeneratedGamePayload({
    ...validPayload,
    questions: validPayload.questions.map((question, index) =>
      index === 0 ? { ...question, prompt: '你愿意交换微信号和联系方式吗？' } : question,
    ),
  }), false);
});

test('rejects sensitive financial, health, and living-arrangement questions at validation and generation', async () => {
  const sensitiveQuestions = [
    '你会怎么安排每月到手的钱，为什么？',
    '长期不舒服时，你通常更愿意怎么处理？',
    '你现在更习惯和谁一起住，为什么？',
  ];

  for (const prompt of sensitiveQuestions) {
    const unsafePayload = {
      ...validPayload,
      questions: validPayload.questions.map((question, index) => (
        index === 0 ? { ...question, prompt } : question
      )),
    };
    assert.equal(isGeneratedGamePayload(unsafePayload), false, prompt);

    const fetchImpl = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(unsafePayload) } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    await assert.rejects(
      () => createAiGameService({ fetchImpl }).generate(config, match, {
        templateId: 'profile-riddle',
      }),
      /AI game did not match the required schema/,
      prompt,
    );
  }
});

test('AI context keeps safe profile signals without sending raw private profiles or memories', () => {
  const compact = compactMatchForAi({
    ...match,
    messages: [
      ...match.messages,
      { from: 'a', type: 'text', content: '我的微信号 abc12345', sent_at: '2026-08-22T12:00:00Z' },
      { from: 'b', type: 'text', content: '周末一起聊聊电影', sent_at: '2026-08-22T12:01:00Z' },
    ],
    user_a: {
      nickname: '不应发送的昵称',
      gender: 'female',
      profile: '# ENFP，水瓶座，摄影爱好者，离异，住在私密地址ALPHA-7788',
      memories_self: ['未公开记忆BRAVO-9911，喜欢徒步'],
      memories_ideal: ['未公开偏好CHARLIE-6633，重视真诚'],
    },
  });
  const serialized = JSON.stringify(compact);
  assert.match(serialized, /摄影/);
  assert.match(serialized, /徒步/);
  assert.match(serialized, /真诚/);
  assert.match(serialized, /ENFP/);
  assert.match(serialized, /水瓶座/);
  assert.equal(serialized.includes('离异'), false);
  assert.equal(serialized.includes('不应发送的昵称'), false);
  assert.equal(serialized.includes('ALPHA-7788'), false);
  assert.equal(serialized.includes('BRAVO-9911'), false);
  assert.equal(serialized.includes('CHARLIE-6633'), false);
  assert.equal(serialized.includes('abc12345'), false);
  assert.match(serialized, /周末一起聊聊电影/);
});

test('profile riddles personalize from public profile and chat without using private memory signals', async () => {
  let requestBody;
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validProfilePayload) } }],
    }), { status: 200 });
  };
  await createAiGameService({ fetchImpl }).generate(config, {
    ...match,
    user_a: {
      ...match.user_a,
      profile: '# ENFP，喜欢摄影',
      memories_self: ['未公开记忆：喜欢徒步'],
      memories_ideal: ['未公开偏好：重视真诚'],
    },
  }, { templateId: 'profile-riddle' });
  const serializedMessages = JSON.stringify(requestBody.messages);
  const userMessage = requestBody.messages.at(-1).content;
  const serializedContext = userMessage.match(/<match_context>\n([\s\S]*?)\n<\/match_context>/)?.[1] ?? '';
  assert.match(serializedContext, /ENFP/);
  assert.match(serializedContext, /摄影/);
  assert.equal(serializedContext.includes('徒步'), false);
  assert.equal(serializedContext.includes('真诚'), false);
  assert.equal(serializedMessages.includes('未公开记忆：喜欢徒步'), false);
  assert.equal(serializedMessages.includes('未公开偏好：重视真诚'), false);
});

test('enforces the three built-in template shapes', () => {
  const withQuestionCount = (count, optionCount) => ({
    ...validPayload,
    questions: Array.from({ length: count }, (_, index) => ({
      ...validPayload.questions[index % validPayload.questions.length],
      id: `shape-${index + 1}`,
      label: `玩法环节${index + 1}`,
      options: validPayload.questions[0].options.slice(0, optionCount),
    })),
  });

  const withProfileShape = (count, optionCount) => ({
    ...validProfilePayload,
    questionsByTarget: {
      ...validProfilePayload.questionsByTarget,
      a: Array.from({ length: count }, (_, index) => ({
        ...validProfileQuestionsA[index % validProfileQuestionsA.length],
        options: validProfileQuestionsA[index % validProfileQuestionsA.length].options.slice(0, optionCount),
      })),
    },
  });

  const replaceProfileA = (replacement) => ({
    ...validProfilePayload,
    questionsByTarget: {
      ...validProfilePayload.questionsByTarget,
      a: validProfileQuestionsA.map((question, index) => index === 0
        ? { ...question, ...replacement(question) }
        : question),
    },
  });

  assert.equal(isTemplateShapeValid(withProfileShape(3, 3), 'profile-riddle'), true);
  assert.equal(isTemplateShapeValid(withProfileShape(4, 3), 'profile-riddle'), false);
  assert.equal(isTemplateShapeValid(withProfileShape(3, 2), 'profile-riddle'), false);
  assert.equal(isTemplateShapeValid(replaceProfileA(
    (question) => ({ options: ['慢热', ...question.options.slice(1)] }),
  ), 'profile-riddle'), false);
  assert.equal(isTemplateShapeValid(replaceProfileA(
    (question) => ({ options: ['平时做事很理性', ...question.options.slice(1)] }),
  ), 'profile-riddle'), false);
  assert.equal(isTemplateShapeValid(replaceProfileA(
    (question) => ({ options: ['周末安排比较随性', ...question.options.slice(1)] }),
  ), 'profile-riddle'), false);
  for (const broadLabel of ['乐观开朗大方', '温柔善良靠谱', '做事认真负责']) {
    assert.equal(isTemplateShapeValid(replaceProfileA(
      (question) => ({ options: [broadLabel, ...question.options.slice(1)] }),
    ), 'profile-riddle'), false, broadLabel);
  }
  assert.equal(isTemplateShapeValid(replaceProfileA(
    (question) => ({ options: ['看到有趣小店会停', ...question.options.slice(1)] }),
  ), 'profile-riddle'), true);
  assert.equal(isTemplateShapeValid({
    ...validProfilePayload,
    questionsByTarget: {
      ...validProfilePayload.questionsByTarget,
      a: validProfileQuestionsA.map((question, index) => index === 1
        ? { ...question, id: validProfileQuestionsA[0].id }
        : question),
    },
  }, 'profile-riddle'), false);
  assert.equal(isTemplateShapeValid({
    ...validProfilePayload,
    questionsByTarget: { a: validProfileQuestionsA },
  }, 'profile-riddle'), false);

  assert.equal(isTemplateShapeValid(withQuestionCount(3, 2), 'keyword-wheel'), true);
  assert.equal(isTemplateShapeValid(withQuestionCount(5, 4), 'keyword-wheel'), true);
  assert.equal(isTemplateShapeValid(withQuestionCount(2, 2), 'keyword-wheel'), false);

  assert.equal(isTemplateShapeValid(withQuestionCount(3, 2), 'rapid-choice'), true);
  assert.equal(isTemplateShapeValid(withQuestionCount(5, 2), 'rapid-choice'), true);
  assert.equal(isTemplateShapeValid(withQuestionCount(3, 3), 'rapid-choice'), false);
});

test('prompt preview uses public chat topics without exposing profile memories or nicknames', () => {
  const privateMatch = {
    ...match,
    user_a: {
      ...match.user_a,
      nickname: '昵称私密标记X9',
      profile: '# 私密资料标记ALPHA-7788',
      memories_self: ['只有服务端知道的回忆BRAVO-9911'],
    },
    user_b: {
      ...match.user_b,
      nickname: '昵称私密标记Y8',
      profile: '# 私密资料标记CHARLIE-6633',
      memories_ideal: ['未公开择偶偏好DELTA-4422'],
    },
    messages: [{ from: 'a', type: 'text', content: '周末一起聊摄影和咖啡吧', sent_at: '2026-08-22 10:00' }],
  };
  const preview = buildPromptPreview(privateMatch, gameType('keyword-wheel', '换个名字也还是转盘'));

  assert.match(preview, /周末/);
  assert.match(preview, /摄影/);
  assert.equal(preview.includes('昵称私密标记'), false);
  assert.equal(preview.includes('ALPHA-7788'), false);
  assert.equal(preview.includes('BRAVO-9911'), false);
  assert.equal(preview.includes('DELTA-4422'), false);
});

test('player prompt rejects contact details and cache keys isolate template id and prompt', () => {
  assert.throws(
    () => normalizePlayerPrompt('请生成轻松题目，然后拨打 13812345678 继续联系对方。'),
    /contact details or links/,
  );
  assert.throws(
    () => normalizePlayerPrompt('请生成轻松题目，然后拨打 138 1234 5678 继续联系对方。'),
    /contact details or links/,
  );
  assert.throws(
    () => normalizePlayerPrompt('请生成轻松题目，然后添加微信号 abc12345 继续联系对方。'),
    /contact details or links/,
  );
  assert.throws(
    () => normalizePlayerPrompt('请生成轻松题目，然后添加 qq号 12345678 继续联系对方。'),
    /contact details or links/,
  );
  assert.throws(
    () => normalizePlayerPrompt('请生成轻松题目，然后拨打 +1 415 555 2671 继续联系对方。'),
    /contact details or links/,
  );
  assert.throws(
    () => normalizePlayerPrompt('请参考 https://example.com 再生成一局轻松的题目。'),
    /contact details or links/,
  );

  const service = createAiGameService();
  const promptA = '请围绕公开聊天中的周末安排，生成一局轻松、安全而且没有输赢的游戏。';
  const promptB = '请围绕公开聊天中的摄影兴趣，生成一局轻松、安全而且没有输赢的游戏。';
  const profileKey = service.cacheKey(config, match, {
    templateId: 'profile-riddle',
    gameLabel: '资料猜谜局',
    prompt: promptA,
  });
  assert.equal(profileKey, service.cacheKey(config, match, {
    templateId: 'profile-riddle',
    gameLabel: '资料猜谜局',
    prompt: promptA,
  }));
  assert.notEqual(profileKey, service.cacheKey(config, match, {
    templateId: 'keyword-wheel',
    gameLabel: '资料猜谜局',
    prompt: promptA,
  }));
  assert.notEqual(profileKey, service.cacheKey(config, match, {
    templateId: 'profile-riddle',
    gameLabel: '资料猜谜局',
    prompt: promptB,
  }));
});
