import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROMPT_GAME_ENGINE,
  PROMPT_GAME_OUTPUT_SCHEMA,
  PROMPT_GAME_SCHEMA_VERSION,
  applyPromptGamePlan,
  assertPromptGameDefinition,
  isPromptGameDefinition,
  isPromptGamePayload,
  promptGamePlan,
} from './prompt-game.mjs';

function question(index, interaction = { kind: 'card-grid', variant: 'tiles' }, optionCount = 4) {
  return {
    id: `round-${index}`,
    label: `第${index}关`,
    source: '来自双方公开聊天里的周末话题',
    prompt: `第${index}关更愿意选择哪一种轻松安排？`,
    options: ['散步聊天', '一起看展', '交换歌单', '随心休息'].slice(0, optionCount),
    matchedFollowUp: '你们想到一起了，最想先分享哪个具体画面？',
    differentFollowUp: '两个答案都很有趣，为什么这个选项更吸引你？',
    interaction,
  };
}

const validPayload = {
  gameType: 'Prompt 专属小游戏',
  title: '把周末灵感做成三关游戏',
  eyebrow: 'AI 游戏工坊',
  description: '三种触感不同的选择关卡，会把公开聊天线索变成轻松的双人互动。',
  whyItFits: '你们已经聊到周末和看展，可以从这些共同话题继续而不制造推进压力。',
  estimatedMinutes: 4,
  topics: ['周末灵感', '看展', '聊天节奏'],
  presentation: { tone: 'blue', scene: 'cosmos', motion: 'orbit', revealEffect: 'stars' },
  questions: [
    question(1, { kind: 'card-grid', variant: 'tickets' }, 4),
    question(2, { kind: 'swipe-deck', variant: 'stack' }, 2),
    question(3, { kind: 'mood-dial', variant: 'meter' }, 3),
  ],
  ending: {
    headline: '收下三条新线索',
    summary: '同频和不同答案都让你们多了解了一个轻松、可继续聊的角度。',
    chatPrompt: '刚才哪一关的答案最让你意外，为什么？',
  },
};

test('accepts the strict declarative prompt-game schema and exposes it for structured output', () => {
  assert.equal(PROMPT_GAME_OUTPUT_SCHEMA.additionalProperties, false);
  assert.deepEqual(PROMPT_GAME_OUTPUT_SCHEMA.properties.questions.minItems, 3);
  assert.deepEqual(PROMPT_GAME_OUTPUT_SCHEMA.properties.questions.maxItems, 3);
  assert.equal(isPromptGamePayload(validPayload), true);

  const definition = {
    schemaVersion: PROMPT_GAME_SCHEMA_VERSION,
    engine: PROMPT_GAME_ENGINE,
    id: 'game-safe-v3',
    matchId: 'match-safe-v3',
    templateId: 'custom',
    seriesId: 'prompt-arcade',
    ...validPayload,
    mechanics: {
      kind: 'exclusive-series',
      seriesId: 'prompt-arcade',
      templateKey: 'exclusive_game_prompt_arcade_v1',
      engine: PROMPT_GAME_ENGINE,
    },
    generatedBy: 'ai',
    generatedAt: '2026-08-23T00:00:00.000Z',
  };
  assert.equal(isPromptGameDefinition(definition), true);
  assert.deepEqual(assertPromptGameDefinition(definition).presentation, validPayload.presentation);
  assert.equal(isPromptGameDefinition({ ...definition, html: '<script>alert(1)</script>' }), false);
});

test('enforces renderer variants and option counts without accepting executable content', () => {
  const withQuestion = (replacement) => ({
    ...validPayload,
    questions: validPayload.questions.map((item, index) => index === 0 ? replacement : item),
  });
  assert.equal(isPromptGamePayload(withQuestion(question(1, { kind: 'swipe-deck', variant: 'stack' }, 3))), false);
  assert.equal(isPromptGamePayload(withQuestion(question(1, { kind: 'mood-dial', variant: 'meter' }, 2))), false);
  assert.equal(isPromptGamePayload(withQuestion(question(1, { kind: 'orbit-pick', variant: 'tiles' }, 4))), false);
  assert.equal(isPromptGamePayload({ ...validPayload, javascript: 'alert(1)' }), false);
  assert.equal(isPromptGamePayload({ ...validPayload, title: '<img src=x onerror=alert(1)>' }), false);
  assert.equal(isPromptGamePayload({ ...validPayload, whyItFits: '请访问 https://example.com 再继续玩这一局。' }), false);
  assert.equal(isPromptGamePayload({
    ...validPayload,
    ending: { ...validPayload.ending, chatPrompt: '请交换联系方式再继续下一关。' },
  }, { hasUnsafeText: (text) => text.includes('联系方式') }), false);
});

test('compiles prompt hints into bounded local tokens and never copies prompt text', () => {
  const cosmic = promptGamePlan('想要宇宙轨道和星座节点的互动，不要普通卡片', 'prompt-arcade');
  assert.deepEqual(cosmic.presentation, {
    tone: 'blue', scene: 'cosmos', motion: 'orbit', revealEffect: 'stars',
  });
  assert.equal(cosmic.interactions.every((item) => item.kind === 'orbit-pick'), true);
  assert.equal(JSON.stringify(cosmic).includes('不要普通卡片'), false);

  const swipe = promptGamePlan('做成左右滑卡的二选一小游戏', 'prompt-arcade');
  assert.equal(swipe.interactions.every((item) => item.kind === 'swipe-deck'), true);
  const planned = applyPromptGamePlan([
    question(1),
    question(2),
    question(3),
  ], '做成左右滑卡的二选一小游戏', 'prompt-arcade');
  assert.equal(planned.questions.every((item) => item.options.length === 2), true);
  assert.equal(planned.questions.every((item) => item.interaction.kind === 'swipe-deck'), true);
  assert.equal(isPromptGamePayload({ ...validPayload, presentation: planned.presentation, questions: planned.questions }), true);
});

test('keeps multiple requested interactions in their written order', () => {
  const plan = promptGamePlan('第一轮左右滑卡，第二轮情绪刻度，第三轮星球轨道', 'prompt-arcade');
  assert.deepEqual(plan.interactions.map((item) => item.kind), [
    'swipe-deck',
    'mood-dial',
    'orbit-pick',
  ]);

  const themed = promptGamePlan('做一个宇宙主题，三轮依次用左右滑卡、情绪刻度和星球轨道', 'prompt-arcade');
  assert.deepEqual(themed.interactions.map((item) => item.kind), [
    'swipe-deck',
    'mood-dial',
    'orbit-pick',
  ]);
});
