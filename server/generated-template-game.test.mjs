import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FALLBACK_GENERATED_TEMPLATE_DOCUMENTS,
  GENERATED_TEMPLATE_BRIDGE,
  GENERATED_TEMPLATE_ENGINE,
  assertGeneratedTemplateRenderer,
  attachFallbackGeneratedTemplateRenderer,
  generatedTemplateArtifact,
  isSafeGeneratedTemplateDocument,
  publicGeneratedTemplateGame,
  publicGeneratedTemplateRenderer,
} from './generated-template-game.mjs';

for (const templateId of ['profile-riddle', 'keyword-wheel', 'rapid-choice']) {
  test(`${templateId} fallback is a runnable safe generated-template renderer`, () => {
    const document = FALLBACK_GENERATED_TEMPLATE_DOCUMENTS[templateId];
    assert.equal(isSafeGeneratedTemplateDocument(document, templateId), true);
    assert.match(document, /game\.bootstrap-ready/);
    assert.match(document, /host\.init/);
    assert.match(document, /host\.sync/);
    const game = attachFallbackGeneratedTemplateRenderer({ templateId, generatedBy: 'fallback' });
    const renderer = assertGeneratedTemplateRenderer(game.renderer, templateId);
    assert.equal(renderer.engine, GENERATED_TEMPLATE_ENGINE);
    assert.equal(renderer.bridge, GENERATED_TEMPLATE_BRIDGE);
    assert.equal(generatedTemplateArtifact(game).document, document);

    const projected = publicGeneratedTemplateGame(game, '/api/games/runtime');
    assert.equal(projected.renderer.artifact.document, undefined);
    assert.match(projected.renderer.artifact.runtimePath, /^\/api\/games\/runtime\/artifact_/);
    assert.deepEqual(Object.keys(projected.renderer).sort(), ['artifact', 'bridge', 'engine']);
    assert.deepEqual(Object.keys(projected.renderer.artifact).sort(), ['artifactId', 'codeHash', 'runtimePath']);
    assert.deepEqual(
      publicGeneratedTemplateRenderer(projected.renderer, templateId, '/api/games/runtime'),
      projected.renderer,
    );
  });
}

test('fallback profile visibly uses three black-and-white wheel controls and wheel follow-ups are rendered', () => {
  const profile = FALLBACK_GENERATED_TEMPLATE_DOCUMENTS['profile-riddle'];
  assert.match(profile, /profile-wheels/);
  assert.match(profile, /profile-dial/);
  assert.match(profile, /dial-choice/);
  assert.match(profile, /黑白转盘/);
  const wheel = FALLBACK_GENERATED_TEMPLATE_DOCUMENTS['keyword-wheel'];
  assert.match(wheel, /selected\.followUps/);
  assert.match(wheel, /state\.followUpIndex/);
  assert.match(wheel, /现在聊聊/);
});

test('rapid fallback updates only its timer between host state changes', () => {
  const rapid = FALLBACK_GENERATED_TEMPLATE_DOCUMENTS['rapid-choice'];
  assert.match(rapid, /function updateRapidTimer\(\)/);
  assert.match(rapid, /aria-label','本题剩余时间'/);
  assert.match(rapid, /template==='rapid-choice'&&channel\)updateRapidTimer\(\)/);
  assert.doesNotMatch(rapid, /template==='rapid-choice'&&channel\)render\(\)/);
});

test('renderer rejects unsafe capabilities, wrong controls, and a tampered hash', () => {
  const profile = FALLBACK_GENERATED_TEMPLATE_DOCUMENTS['profile-riddle'];
  assert.equal(isSafeGeneratedTemplateDocument(profile.replace("'use strict';", "'use strict';setTimeout(()=>{},1);"), 'profile-riddle'), false);
  assert.equal(isSafeGeneratedTemplateDocument(profile, 'rapid-choice'), false);

  const game = attachFallbackGeneratedTemplateRenderer({ templateId: 'profile-riddle' });
  game.renderer.artifact.codeHash = '0'.repeat(64);
  assert.throws(() => assertGeneratedTemplateRenderer(game.renderer, 'profile-riddle'), /Invalid generated-template/);

  const projected = publicGeneratedTemplateGame(
    attachFallbackGeneratedTemplateRenderer({ templateId: 'profile-riddle' }),
    '/api/games/runtime',
  );
  assert.throws(
    () => publicGeneratedTemplateRenderer({ ...projected.renderer, generatedBy: 'ai' }, 'profile-riddle', '/api/games/runtime'),
    /Invalid public generated-template/,
  );
});
