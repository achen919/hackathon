import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createConfigStore, publicConfig } from './config-store.mjs';

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
      gameTypes: ['默契猜猜', '情景接力'],
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
    gameTypes: ['默契猜猜'],
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
        gameTypes: ['默契猜猜'],
      }),
      /origin is not allowed/,
    );
  } finally {
    await rm(stateDir, { recursive: true });
  }
});
