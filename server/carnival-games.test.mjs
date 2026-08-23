import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCarnivalFallbackGame } from './carnival-games.mjs';

test('profile fallback builds independent candidate groups for each target', () => {
  const game = buildCarnivalFallbackGame({
    match_id: 'targeted-profile-fallback',
    user_a: { nickname: '甲', profile: '# 喜欢旅行和徒步' },
    user_b: { nickname: '乙', profile: '# 喜欢火锅和烘焙' },
    messages: [
      { from: 'a', type: 'text', content: '下次旅行想去徒步', sent_at: '2026-08-23T00:00:00Z' },
      { from: 'b', type: 'text', content: '最近在研究火锅和烘焙', sent_at: '2026-08-23T00:01:00Z' },
    ],
  }, 'profile-riddle', '资料猜谜局');

  const byTarget = game.mechanics.choiceGroupsByTarget;
  assert.equal(byTarget.a.some((group) => group.id === 'profile-travel'), true);
  assert.equal(byTarget.b.some((group) => group.id === 'profile-food'), true);
  assert.notDeepEqual(byTarget.a, byTarget.b);
  assert.deepEqual(game.mechanics.choiceGroups, byTarget.b);
  assert.deepEqual(game.questions.map((question) => question.id), byTarget.b.map((group) => group.id));
  assert.deepEqual(game.mechanics.keywordOptions, byTarget.b.flatMap((group) => group.options));
});
