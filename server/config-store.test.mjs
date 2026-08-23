import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createConfigStore, createMemoryConfigStore, publicConfig } from './config-store.mjs';
import { templateGuidance } from './game-templates.mjs';

function gameType(id, label) {
  return {
    id,
    label,
    enabled: true,
    generationPrompt: `这是 ${label} 的安全测试模板，请严格遵循固定玩法并避免泄露任何私密资料。`,
  };
}

test('AI config encrypts both provider keys at rest and never exposes them publicly', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'liangpei-config-'));
  const encryptionKey = randomBytes(32).toString('base64url');
  const apiKey = 'test-provider-secret';
  const imageApiKey = 'test-image-provider-secret';
  try {
    const store = createConfigStore({ stateDir, encryptionKey });
    await store.update({
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey,
      model: 'test-model',
      imageApiBaseUrl: 'https://tokendance.space/gateway/ark/v3',
      imageApiRoute: '/images/generations',
      imageApiKey,
      imageProtocol: 'ark:image-generations',
      imageModel: 'seedream-5.0-pro',
      resultCardImagePrompt: '使用暖色纸雕风格，根据最近公开对话和本局结果生成无文字背景。',
      systemPrompt: '请设计一局安全、轻松、尊重双方边界的三轮破冰游戏。'.repeat(4),
      gameTypes: [
        gameType('profile-riddle', '资料猜谜局'),
        gameType('keyword-wheel', '关键词深挖'),
      ],
    });

    const raw = await readFile(join(stateDir, 'ai-config.json'), 'utf8');
    assert.equal(raw.includes(apiKey), false);
    assert.equal(raw.includes(imageApiKey), false);
    assert.match(raw, /aes-256-gcm/);

    const reloaded = await createConfigStore({ stateDir, encryptionKey }).get();
    assert.equal(reloaded.apiKey, apiKey);
    assert.equal(reloaded.imageApiKey, imageApiKey);
    assert.match(reloaded.resultCardImagePrompt, /暖色纸雕/);
    assert.equal(publicConfig(reloaded).apiKeyConfigured, true);
    assert.equal(publicConfig(reloaded).imageApiKeyConfigured, true);
    assert.equal(JSON.stringify(publicConfig(reloaded)).includes(apiKey), false);
    assert.equal(JSON.stringify(publicConfig(reloaded)).includes(imageApiKey), false);
  } finally {
    await rm(stateDir, { recursive: true });
  }
});

test('blank provider keys preserve encrypted values while explicit clears remove them independently', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'liangpei-config-'));
  const store = createConfigStore({
    stateDir,
    encryptionKey: randomBytes(32).toString('base64url'),
  });
  const base = {
    apiBaseUrl: 'https://api.example.com',
    model: 'test-model',
    systemPrompt: '安全系统提示词'.repeat(20),
    gameTypes: [gameType('profile-riddle', '资料猜谜局')],
  };
  try {
    await store.update({ ...base, apiKey: 'keep-me', imageApiKey: 'keep-image' });
    assert.equal((await store.update({ ...base, apiKey: '' })).apiKey, 'keep-me');
    assert.equal((await store.update({ ...base, imageApiKey: '' })).imageApiKey, 'keep-image');
    const textCleared = await store.update({ ...base, clearApiKey: true });
    assert.equal(textCleared.apiKey, '');
    assert.equal(textCleared.imageApiKey, 'keep-image');
    assert.equal((await store.update({ ...base, clearImageApiKey: true })).imageApiKey, '');
  } finally {
    await rm(stateDir, { recursive: true });
  }
});

test('provider origin allowlist prevents sending a Bearer key to another host', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'liangpei-config-'));
  const store = createConfigStore({
    stateDir,
    encryptionKey: randomBytes(32).toString('base64url'),
    allowedOrigins: ['https://allowed.example'],
  });
  try {
    await assert.rejects(
      () => store.update({
        apiBaseUrl: 'https://untrusted.example/v1',
        apiKey: 'fake-key',
        model: 'test-model',
        systemPrompt: '安全系统提示词'.repeat(20),
        gameTypes: [gameType('profile-riddle', '资料猜谜局')],
      }),
      /origin is not allowed/,
    );
  } finally {
    await rm(stateDir, { recursive: true });
  }
});

test('image provider origin and request route are validated separately', async () => {
  const store = createMemoryConfigStore();
  const current = await store.get();
  await assert.rejects(
    () => store.update({ ...current, imageApiRoute: 'https://untrusted.example/images' }),
    /absolute URL path/,
  );
  const stateDir = await mkdtemp(join(tmpdir(), 'liangpei-config-'));
  try {
    const restricted = createConfigStore({
      stateDir,
      encryptionKey: randomBytes(32).toString('base64url'),
      imageAllowedOrigins: ['https://tokendance.space'],
    });
    await assert.rejects(
      () => restricted.update({ ...current, imageApiBaseUrl: 'https://untrusted.example/ark/v3' }),
      /imageApiBaseUrl origin is not allowed/,
    );
  } finally {
    await rm(stateDir, { recursive: true });
  }
});

test('result-card image prompt is public configuration with bounded validation', async () => {
  const store = createMemoryConfigStore();
  const current = await store.get();
  const prompt = '用抽象纸雕画面呈现双方公开聊天主题和这局游戏结果，不生成文字。';
  const updated = await store.update({ ...current, resultCardImagePrompt: prompt });
  assert.equal(updated.resultCardImagePrompt, prompt);
  assert.equal(publicConfig(updated).resultCardImagePrompt, prompt);
  await assert.rejects(
    () => store.update({ ...updated, resultCardImagePrompt: '太短' }),
    /resultCardImagePrompt must be between 20 and 6000 characters/,
  );
});

test('renaming a rolling keyword preserves its stable template id and generation prompt', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'liangpei-config-'));
  const store = createConfigStore({
    stateDir,
    encryptionKey: randomBytes(32).toString('base64url'),
  });
  const base = {
    apiBaseUrl: 'https://api.example.com',
    model: 'test-model',
    systemPrompt: '安全系统提示词'.repeat(20),
  };

  try {
    const configured = await store.update({
      ...base,
      gameTypes: [gameType('rapid-choice', '五秒心动选择')],
    });

    assert.deepEqual(configured.gameTypes.map(({ id, label }) => ({ id, label })), [
      { id: 'rapid-choice', label: '五秒心动选择' },
    ]);
    assert.match(configured.gameTypes[0].generationPrompt, /固定玩法/);
  } finally {
    await rm(stateDir, { recursive: true });
  }
});

test('legacy free-form game type strings migrate to all four stable templates', async () => {
  const store = createMemoryConfigStore({
    gameTypes: [
      '默契猜猜：一方私密选择，另一方猜答案',
      '二选一地图：沿共同兴趣探索彼此偏好',
      '情景接力：用轻量生活场景交换看法',
      '共同任务：完成一个低压力的小行动',
    ],
  });
  const config = await store.get();
  assert.deepEqual(config.gameTypes.map((item) => item.id), [
    'profile-riddle',
    'keyword-wheel',
    'rapid-choice',
    'custom',
  ]);
  assert.deepEqual(config.gameTypes.map((item) => item.label), [
    '资料猜谜局',
    '关键词深挖',
    '极限2选1',
    '专属小游戏',
  ]);
});

test('configuration treats the custom exclusive template as playable', async () => {
  const store = createMemoryConfigStore();
  const current = await store.get();
  const updated = await store.update({
    ...current,
    gameTypes: [gameType('custom', '专属小游戏')],
  });
  assert.deepEqual(updated.gameTypes.map((item) => item.id), ['custom']);
});

test('migrates only the exact legacy reserved custom prompt and preserves user guidance', async () => {
  const legacyReservedPrompt =
    '这是预留的“专属小游戏”类型。保持通用三轮安全题卡结构，不假设尚未接入的前端机制。';
  const userCustomPrompt =
    '请保留这段用户自定义的专属小游戏提示词，三轮都围绕公开聊天里的共同兴趣展开，并保持轻松。';

  const migrated = await createMemoryConfigStore({
    gameTypes: [{
      id: 'custom',
      label: '专属小游戏',
      enabled: true,
      generationPrompt: legacyReservedPrompt,
    }],
  }).get();
  assert.equal(migrated.gameTypes[0].generationPrompt, templateGuidance('custom'));

  const preserved = await createMemoryConfigStore({
    gameTypes: [{
      id: 'custom',
      label: '专属小游戏',
      enabled: true,
      generationPrompt: userCustomPrompt,
    }],
  }).get();
  assert.equal(preserved.gameTypes[0].generationPrompt, userCustomPrompt);
});

test('migrates only the exact legacy profile-riddle prompt and preserves administrator guidance', async () => {
  const legacyProfileRiddlePrompt = `严格生成“资料猜谜局”：
- 固定三轮，双方轮流描述对方。
- 每轮提供 3-4 个中性、非敏感、非唯一识别的性格或生活方式关键词。
- 这些词只能帮助组织一句印象描述，不得直接复述私密资料，不得给人格下结论。
- matchedFollowUp / differentFollowUp 要引导本人解释“为什么这样理解对方”。`;
  const administratorPrompt = `${legacyProfileRiddlePrompt}\n- 管理员补充：将每个选项写成低风险场景行为。`;

  const migrated = await createMemoryConfigStore({
    gameTypes: [{
      id: 'profile-riddle',
      label: '资料猜谜局',
      enabled: true,
      generationPrompt: legacyProfileRiddlePrompt,
    }],
  }).get();
  assert.equal(migrated.gameTypes[0].generationPrompt, templateGuidance('profile-riddle'));

  const preserved = await createMemoryConfigStore({
    gameTypes: [{
      id: 'profile-riddle',
      label: '资料猜谜局',
      enabled: true,
      generationPrompt: administratorPrompt,
    }],
  }).get();
  assert.equal(preserved.gameTypes[0].generationPrompt, administratorPrompt);
});
