import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXCLUSIVE_SERIES_IDS,
  buildExclusiveFallbackGame,
  buildExclusiveSeriesPrompt,
  exclusiveSeriesForId,
  publicExclusiveSeriesCatalog,
  rankExclusiveTopics,
  requireExclusiveSeries,
} from './exclusive-series.mjs';
import { isPromptGameDefinition } from './prompt-game.mjs';

const match = {
  match_id: 'exclusive-match',
  user_a: { profile: '私密资料ALPHA-7788', memories_self: ['秘密BRAVO-9911'], memories_ideal: [] },
  user_b: { profile: '私密资料CHARLIE-6633', memories_self: [], memories_ideal: [] },
  messages: [
    { from: 'a', type: 'text', content: '周末我想去看展，也喜欢摄影。', sent_at: '2026-08-22T00:00:00Z' },
    { from: 'b', type: 'text', content: '我也常逛博物馆，之后可以聊聊照片。', sent_at: '2026-08-22T00:01:00Z' },
    { from: 'a', type: 'non_text', content: '不应作为公开主题', sent_at: '2026-08-22T00:02:00Z' },
  ],
};

test('exclusive series ids and versioned template keys stay stable', () => {
  assert.deepEqual(EXCLUSIVE_SERIES_IDS, [
    'courtside',
    'chat-archaeology',
    'weekend-studio',
    'contrast-lab',
    'future-trailer',
    'prompt-arcade',
  ]);
  const catalog = publicExclusiveSeriesCatalog();
  assert.equal(catalog.length, 6);
  assert.equal(new Set(catalog.map((item) => item.seriesId)).size, 6);
  for (const item of catalog) assert.match(item.templateKey, /^exclusive_game_[a-z_]+_v1$/);
  assert.equal(exclusiveSeriesForId('missing'), null);
  assert.throws(() => requireExclusiveSeries('missing'), /Unsupported exclusive game series/);
});

test('exclusive prompt and fallback use public topics and preserve the selected series', () => {
  const ranked = rankExclusiveTopics(match);
  assert.equal(ranked[0].label, '逛展看馆');
  const prompt = buildExclusiveSeriesPrompt(match, 'courtside');
  assert.match(prompt, /courtside/);
  assert.match(prompt, /逛展看馆/);
  assert.equal(prompt.includes('ALPHA-7788'), false);
  assert.equal(prompt.includes('BRAVO-9911'), false);

  for (const seriesId of EXCLUSIVE_SERIES_IDS) {
    const game = buildExclusiveFallbackGame(match, seriesId);
    assert.equal(game.templateId, 'custom');
    assert.equal(game.seriesId, seriesId);
    assert.equal(game.schemaVersion, 3);
    assert.equal(game.engine, 'exclusive-choice-v1');
    assert.equal(game.mechanics.kind, 'exclusive-series');
    assert.equal(game.mechanics.engine, 'exclusive-choice-v1');
    assert.equal(game.mechanics.seriesId, seriesId);
    assert.equal(game.questions.length, 3);
    assert.equal(game.questions.every((question) => question.options.length >= 2 && question.options.length <= 4), true);
    assert.equal(game.questions.every((question) => question.interaction?.kind), true);
    assert.equal(typeof game.presentation?.scene, 'string');
    assert.equal(typeof game.ending?.chatPrompt, 'string');
    assert.equal(JSON.stringify(game).includes('ALPHA-7788'), false);
  }
});

test('prompt arcade fallback follows safe prompt hints without copying the brief', () => {
  const editablePrompt = buildExclusiveSeriesPrompt(match, 'prompt-arcade');
  assert.match(editablePrompt, /做一个以/);
  assert.match(editablePrompt, /左右滑卡/);
  assert.equal(editablePrompt.includes('schema'), false);
  assert.equal(editablePrompt.includes('exclusive-choice-v1'), false);

  const game = buildExclusiveFallbackGame(match, 'prompt-arcade', '专属小游戏', {
    prompt: '请做成宇宙轨道和星座节点的互动体验',
  });
  assert.equal(game.presentation.scene, 'cosmos');
  assert.equal(game.questions.every((question) => question.interaction.kind === 'orbit-pick'), true);
  assert.equal(JSON.stringify(game).includes('请做成宇宙轨道'), false);
});

test('v3 fallback pads a single observed topic with safe generic topics', () => {
  const game = buildExclusiveFallbackGame({
    ...match,
    messages: [{ from: 'a', type: 'text', content: '最近想聊一部电影。', sent_at: '2026-08-23T00:00:00Z' }],
  }, 'future-trailer');
  assert.deepEqual(game.topics.slice(0, 2), ['电影追剧', '周末安排']);
  assert.equal(game.topics.length >= 2, true);
  assert.equal(isPromptGameDefinition(game), true);
});
