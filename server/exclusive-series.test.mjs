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
  ]);
  const catalog = publicExclusiveSeriesCatalog();
  assert.equal(catalog.length, 5);
  assert.equal(new Set(catalog.map((item) => item.seriesId)).size, 5);
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
    assert.equal(game.mechanics.kind, 'exclusive-series');
    assert.equal(game.mechanics.seriesId, seriesId);
    assert.equal(game.questions.length, 3);
    assert.equal(game.questions.every((question) => question.options.length >= 3 && question.options.length <= 4), true);
    assert.equal(JSON.stringify(game).includes('ALPHA-7788'), false);
  }
});
