import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GAME_TEMPLATE_CATALOG,
  templateForId,
  templateGuidance,
} from './game-templates.mjs';

export const DEFAULT_SYSTEM_PROMPT = `你是良配的双人破冰游戏设计师。请基于公开聊天与服务端提炼的非敏感资料信号，设计一局只属于这两个人的轻量双人游戏。

设计目标：降低初次聊天压力、增加双方自我披露与互相理解，并自然产生下一轮聊天话题。

硬性边界：
1. 不评判匹配度，不预测感情结果，不使用 PUA、激将、嫉妒、稀缺感或性别刻板印象。
2. 输入只包含服务端允许的非敏感资料信号；不得猜测、补全或披露原始个人资料、择偶记忆与未公开事实。
3. 若聊天出现拒绝、结束或明显不适，选择低压力、尊重边界的游戏，不推动见面、交换联系方式或亲密升级。
4. 每题必须角色中性，能由任意一方先作答；选项无优劣，避免敏感财务、健康、性、宗教与政治问题。
5. 严格遵循本次选中的游戏模板；游戏保持 3-5 轮，并从轻松共同点逐步进入日常偏好。
6. source 只能概括公开聊天线索，不得声称读心或暴露私密资料。
7. matchedFollowUp 与 differentFollowUp 都应自然、简短、可由本人修改后发送。`;

export const DEFAULT_GAME_TYPES = [
  { id: 'profile-riddle', label: '资料猜谜局', enabled: true, generationPrompt: templateGuidance('profile-riddle') },
  { id: 'keyword-wheel', label: '关键词深挖', enabled: true, generationPrompt: templateGuidance('keyword-wheel') },
  { id: 'rapid-choice', label: '极限2选1', enabled: true, generationPrompt: templateGuidance('rapid-choice') },
  { id: 'custom', label: '专属小游戏', enabled: true, generationPrompt: templateGuidance('custom') },
];

export const DEFAULT_AI_CONFIG = Object.freeze({
  apiBaseUrl: 'https://api.openai-next.com',
  apiKey: '',
  model: 'gpt-4o-mini',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  gameTypes: DEFAULT_GAME_TYPES,
  updatedAt: null,
});

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeString(value, name, { min = 1, max }) {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${name} must be between ${min} and ${max} characters`);
  }
  return normalized;
}

function assertPublicHttpsUrl(value, allowedOrigins = []) {
  const normalized = normalizeString(value, 'apiBaseUrl', { max: 500 });
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('apiBaseUrl must be a valid URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('apiBaseUrl must be a public HTTPS URL without credentials, query, or hash');
  }
  const hostname = url.hostname.toLowerCase();
  const forbidden =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  if (forbidden) throw new Error('apiBaseUrl must not target a private network');
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(url.origin)) {
    throw new Error('apiBaseUrl origin is not allowed by the server');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function normalizeGameTypes(value) {
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) {
    // v1 stored arbitrary display strings without stable mechanics. Migrate the entire
    // legacy list to the four fixed template ids instead of guessing behavior from labels.
    return DEFAULT_GAME_TYPES.map((item) => ({ ...item }));
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > GAME_TEMPLATE_CATALOG.length) {
    throw new Error(`gameTypes must contain between 1 and ${GAME_TEMPLATE_CATALOG.length} items`);
  }
  const normalized = value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`gameTypes[${index}] must be an object`);
    const template = templateForId(item.id);
    if (!template) throw new Error(`gameTypes[${index}].id is not supported`);
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') {
      throw new Error(`gameTypes[${index}].enabled must be a boolean`);
    }
    return {
      id: template.id,
      label: normalizeString(item.label, `gameTypes[${index}].label`, { max: 60 }),
      enabled: item.enabled !== false,
      generationPrompt: normalizeString(
        item.generationPrompt ?? templateGuidance(template.id),
        `gameTypes[${index}].generationPrompt`,
        { min: 20, max: 4_000 },
      ),
    };
  });
  if (new Set(normalized.map((item) => item.id)).size !== normalized.length) {
    throw new Error('gameTypes must not contain duplicate template ids');
  }
  if (!normalized.some((item) => item.enabled && templateForId(item.id)?.available)) {
    throw new Error('gameTypes must keep at least one playable template enabled');
  }
  return normalized;
}

function cloneGameTypes(value) {
  return value.map((item) => ({ ...item }));
}

export function normalizeConfigInput(value, current = DEFAULT_AI_CONFIG, { allowedOrigins = [] } = {}) {
  if (!isRecord(value)) throw new Error('Configuration must be an object');
  const next = {
    apiBaseUrl: assertPublicHttpsUrl(value.apiBaseUrl, allowedOrigins),
    apiKey: current.apiKey ?? '',
    model: normalizeString(value.model, 'model', { max: 120 }),
    systemPrompt: normalizeString(value.systemPrompt, 'systemPrompt', { min: 80, max: 20_000 }),
    gameTypes: normalizeGameTypes(value.gameTypes),
    updatedAt: new Date().toISOString(),
  };

  if (value.clearApiKey === true) next.apiKey = '';
  if (typeof value.apiKey === 'string' && value.apiKey.trim()) {
    next.apiKey = normalizeString(value.apiKey, 'apiKey', { max: 2_000 });
  }
  return next;
}

export function publicConfig(config) {
  return {
    apiBaseUrl: config.apiBaseUrl,
    apiKeyConfigured: Boolean(config.apiKey),
    model: config.model,
    systemPrompt: config.systemPrompt,
    gameTypes: cloneGameTypes(config.gameTypes),
    updatedAt: config.updatedAt,
  };
}

function encryptionKeyFrom(value) {
  if (!value) return null;
  try {
    const key = Buffer.from(value, 'base64url');
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function encryptSecret(secret, key) {
  if (!secret) return null;
  if (!key) throw new Error('AI configuration encryption key is missing or invalid');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

function decryptSecret(value, key) {
  if (!value) return '';
  if (!key || !isRecord(value) || value.algorithm !== 'aes-256-gcm') {
    throw new Error('Unable to decrypt stored AI configuration');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function storedConfig(config, key) {
  return {
    version: 1,
    apiBaseUrl: config.apiBaseUrl,
    apiKeyEncrypted: encryptSecret(config.apiKey, key),
    model: config.model,
    systemPrompt: config.systemPrompt,
    gameTypes: config.gameTypes,
    updatedAt: config.updatedAt,
  };
}

function loadedConfig(value, key, allowedOrigins) {
  if (!isRecord(value) || value.version !== 1) throw new Error('Unsupported AI config format');
  const config = normalizeConfigInput(
    {
      apiBaseUrl: value.apiBaseUrl,
      apiKey: decryptSecret(value.apiKeyEncrypted, key),
      model: value.model,
      systemPrompt: value.systemPrompt,
      gameTypes: value.gameTypes,
    },
    DEFAULT_AI_CONFIG,
    { allowedOrigins },
  );
  config.updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null;
  return config;
}

export function createConfigStore({
  stateDir = process.env.STATE_DIR ?? 'data',
  encryptionKey = process.env.CONFIG_ENCRYPTION_KEY ?? '',
  allowedOrigins = process.env.AI_ALLOWED_ORIGINS ?? '',
  initialConfig,
} = {}) {
  const path = join(stateDir, 'ai-config.json');
  const key = encryptionKeyFrom(encryptionKey);
  const allowedOriginList = Array.isArray(allowedOrigins)
    ? allowedOrigins
    : String(allowedOrigins).split(',').map((item) => item.trim()).filter(Boolean);
  let cache = initialConfig ? {
    ...DEFAULT_AI_CONFIG,
    ...initialConfig,
    gameTypes: normalizeGameTypes(initialConfig.gameTypes ?? DEFAULT_GAME_TYPES),
  } : null;
  let writeChain = Promise.resolve();

  async function readFromDisk() {
    if (cache) return { ...cache, gameTypes: cloneGameTypes(cache.gameTypes) };
    try {
      const raw = await readFile(path, 'utf8');
      cache = loadedConfig(JSON.parse(raw), key, allowedOriginList);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      cache = { ...DEFAULT_AI_CONFIG, gameTypes: cloneGameTypes(DEFAULT_GAME_TYPES) };
    }
    return { ...cache, gameTypes: cloneGameTypes(cache.gameTypes) };
  }

  async function update(value) {
    const operation = writeChain.then(async () => {
      const current = await readFromDisk();
      const next = normalizeConfigInput(value, current, { allowedOrigins: allowedOriginList });
      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      await chmod(stateDir, 0o700);
      const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(storedConfig(next, key), null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporaryPath, path);
      await chmod(path, 0o600);
      cache = next;
      return { ...next, gameTypes: cloneGameTypes(next.gameTypes) };
    });
    writeChain = operation.catch(() => {});
    return operation;
  }

  return { get: readFromDisk, update };
}

export function createMemoryConfigStore(initialConfig = {}) {
  let config = {
    ...DEFAULT_AI_CONFIG,
    ...initialConfig,
    gameTypes: normalizeGameTypes(initialConfig.gameTypes ?? DEFAULT_GAME_TYPES),
  };
  return {
    async get() {
      return { ...config, gameTypes: cloneGameTypes(config.gameTypes) };
    },
    async update(value) {
      config = normalizeConfigInput(value, config);
      return { ...config, gameTypes: cloneGameTypes(config.gameTypes) };
    },
  };
}
