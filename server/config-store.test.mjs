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

test('AI config encrypts the provider key at rest and never exposes it publicly', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'liangpei-config-'));
  const encryptionKey = randomBytes(32).toString('base64url');
  const apiKey = 'test-provider-secret';
  try {
    const store = createConfigStore({ stateDir, encryptionKey });
    await store.update({
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey,
      model: 'test-model',
      systemPrompt: '请设计一局安全、轻松、尊重双方边界的三轮破冰游戏。'.repeat(4),
      gameTypes: [
        gameType('profile-riddle', '资料猜谜局'),
        gameType('keyword-wheel', '关键词深挖'),
      ],
    });

    const raw = await readFile(join(stateDir, 'ai-config.json'), 'utf8');
    assert.equal(raw.includes(apiKey), false);
    assert.match(raw, /aes-256-gcm/);

    const reloaded = await createConfigStore({ stateDir, encryptionKey }).get();
    assert.equal(reloaded.apiKey, apiKey);
    assert.equal(publicConfig(reloaded).apiKeyConfigured, true);
    assert.equal(JSON.stringify(publicConfig(reloaded)).includes(apiKey), false);
  } finally {
    await rm(stateDir, { recursive: true });
  }
});

test('blank provider key preserves the encrypted key while explicit clear removes it', async () => {
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
    await store.update({ ...base, apiKey: 'keep-me' });
    assert.equal((await store.update({ ...base, apiKey: '' })).apiKey, 'keep-me');
    assert.equal((await store.update({ ...base, clearApiKey: true })).apiKey, '');
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
