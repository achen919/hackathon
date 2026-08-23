import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GAME_TEMPLATE_CATALOG,
  templateForId,
  templateGuidance,
} from './game-templates.mjs';

export const DEFAULT_SYSTEM_PROMPT = `你是心近的双人破冰游戏设计师。请基于公开聊天与服务端提炼的非敏感资料信号，设计一局只属于这两个人的轻量双人游戏。

设计目标：降低初次聊天压力、增加双方自我披露与互相理解，并自然产生下一轮聊天话题。

硬性边界：
1. 不评判匹配度，不预测感情结果，不使用 PUA、激将、嫉妒、稀缺感或性别刻板印象。
2. 输入只包含服务端允许的非敏感资料信号；不得猜测、补全或披露原始个人资料、择偶记忆与未公开事实。
3. 若聊天出现拒绝、结束或明显不适，选择低压力、尊重边界的游戏，不推动见面、交换联系方式或亲密升级。
4. 每题必须角色中性，能由任意一方先作答；选项无优劣，避免敏感财务、健康、性、宗教与政治问题。
5. 严格遵循本次选中的游戏模板；问答模板保持 3-5 轮并从轻松共同点逐步进入日常偏好，prompt-arcade 则是一局连续实时操作，不使用问答轮次。
6. source 只能概括公开聊天线索，不得声称读心或暴露私密资料。
7. matchedFollowUp 与 differentFollowUp 都应自然、简短、可由本人修改后发送。`;

export const DEFAULT_RESULT_CARD_IMAGE_PROMPT = `为一张双人破冰小游戏结果卡生成竖版背景图。画面应结合两人此前公开对话的主题和本局游戏结果，用抽象场景、色彩、光影和象征性物件表达当下氛围；整体温暖、轻松、有庆祝感，适合在上方叠加结果卡文字。不要生成任何文字、数字、标志、二维码、联系方式、真人脸或可识别身份。`;

export const DEFAULT_GAME_TYPES = [
  { id: 'profile-riddle', label: '资料猜谜局', enabled: true, generationPrompt: templateGuidance('profile-riddle') },
  { id: 'keyword-wheel', label: '关键词深挖', enabled: true, generationPrompt: templateGuidance('keyword-wheel') },
  { id: 'rapid-choice', label: '极限2选1', enabled: true, generationPrompt: templateGuidance('rapid-choice') },
  { id: 'custom', label: '专属小游戏', enabled: true, generationPrompt: templateGuidance('custom') },
];

const LEGACY_RESERVED_CUSTOM_PROMPT =
  '这是预留的“专属小游戏”类型。保持通用三轮安全题卡结构，不假设尚未接入的前端机制。';

const LEGACY_PROFILE_RIDDLE_PROMPT = `严格生成“资料猜谜局”：
- 固定三轮，双方轮流描述对方。
- 每轮提供 3-4 个中性、非敏感、非唯一识别的性格或生活方式关键词。
- 这些词只能帮助组织一句印象描述，不得直接复述私密资料，不得给人格下结论。
- matchedFollowUp / differentFollowUp 要引导本人解释“为什么这样理解对方”。`;

export const DEFAULT_AI_CONFIG = Object.freeze({
  apiBaseUrl: 'https://api.openai-next.com',
  apiKey: '',
  model: 'gpt-4o-mini',
  imageApiBaseUrl: 'https://tokendance.space/gateway/ark/v3',
  imageApiRoute: '/images/generations',
  imageApiKey: '',
  imageProtocol: 'ark:image-generations',
  imageModel: 'seedream-5.0-pro',
  resultCardImagePrompt: DEFAULT_RESULT_CARD_IMAGE_PROMPT,
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

function assertPublicHttpsUrl(value, allowedOrigins = [], name = 'apiBaseUrl') {
  const normalized = normalizeString(value, name, { max: 500 });
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a public HTTPS URL without credentials, query, or hash`);
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
  if (forbidden) throw new Error(`${name} must not target a private network`);
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(url.origin)) {
    throw new Error(`${name} origin is not allowed by the server`);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function normalizeImageApiRoute(value) {
  const route = normalizeString(value, 'imageApiRoute', { max: 300 });
  if (!route.startsWith('/') || route.startsWith('//') || /[?#]/.test(route)) {
    throw new Error('imageApiRoute must be an absolute URL path without query or hash');
  }
  return `/${route.replace(/^\/+|\/+$/g, '')}`;
}

function normalizeImageProtocol(value) {
  const protocol = normalizeString(value, 'imageProtocol', { max: 80 });
  if (!['ark:image-generations', 'openai:image-generations'].includes(protocol)) {
    throw new Error('imageProtocol is not supported');
  }
  return protocol;
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
    const configuredPrompt = normalizeString(
      item.generationPrompt ?? templateGuidance(template.id),
      `gameTypes[${index}].generationPrompt`,
      { min: 20, max: 4_000 },
    );
    return {
      id: template.id,
      label: normalizeString(item.label, `gameTypes[${index}].label`, { max: 60 }),
      enabled: item.enabled !== false,
      generationPrompt:
        template.id === 'profile-riddle' && configuredPrompt === LEGACY_PROFILE_RIDDLE_PROMPT
          ? templateGuidance('profile-riddle')
          : template.id === 'custom' && configuredPrompt === LEGACY_RESERVED_CUSTOM_PROMPT
            ? templateGuidance('custom')
            : configuredPrompt,
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

export function normalizeConfigInput(
  value,
  current = DEFAULT_AI_CONFIG,
  { allowedOrigins = [], imageAllowedOrigins = [] } = {},
) {
  if (!isRecord(value)) throw new Error('Configuration must be an object');
  const next = {
    apiBaseUrl: assertPublicHttpsUrl(value.apiBaseUrl, allowedOrigins),
    apiKey: current.apiKey ?? '',
    model: normalizeString(value.model, 'model', { max: 120 }),
    imageApiBaseUrl: assertPublicHttpsUrl(
      value.imageApiBaseUrl ?? current.imageApiBaseUrl ?? DEFAULT_AI_CONFIG.imageApiBaseUrl,
      imageAllowedOrigins,
      'imageApiBaseUrl',
    ),
    imageApiRoute: normalizeImageApiRoute(
      value.imageApiRoute ?? current.imageApiRoute ?? DEFAULT_AI_CONFIG.imageApiRoute,
    ),
    imageApiKey: current.imageApiKey ?? '',
    imageProtocol: normalizeImageProtocol(
      value.imageProtocol ?? current.imageProtocol ?? DEFAULT_AI_CONFIG.imageProtocol,
    ),
    imageModel: normalizeString(value.imageModel ?? current.imageModel ?? DEFAULT_AI_CONFIG.imageModel, 'imageModel', { max: 120 }),
    resultCardImagePrompt: normalizeString(
      value.resultCardImagePrompt ?? current.resultCardImagePrompt ?? DEFAULT_AI_CONFIG.resultCardImagePrompt,
      'resultCardImagePrompt',
      { min: 20, max: 6_000 },
    ),
    systemPrompt: normalizeString(value.systemPrompt, 'systemPrompt', { min: 80, max: 20_000 }),
    gameTypes: normalizeGameTypes(value.gameTypes),
    updatedAt: new Date().toISOString(),
  };

  if (value.clearApiKey === true) next.apiKey = '';
  if (typeof value.apiKey === 'string' && value.apiKey.trim()) {
    next.apiKey = normalizeString(value.apiKey, 'apiKey', { max: 2_000 });
  }
  if (value.clearImageApiKey === true) next.imageApiKey = '';
  if (typeof value.imageApiKey === 'string' && value.imageApiKey.trim()) {
    next.imageApiKey = normalizeString(value.imageApiKey, 'imageApiKey', { max: 2_000 });
  }
  return next;
}

export function publicConfig(config) {
  return {
    apiBaseUrl: config.apiBaseUrl,
    apiKeyConfigured: Boolean(config.apiKey),
    model: config.model,
    imageApiBaseUrl: config.imageApiBaseUrl,
    imageApiRoute: config.imageApiRoute,
    imageApiKeyConfigured: Boolean(config.imageApiKey),
    imageProtocol: config.imageProtocol,
    imageModel: config.imageModel,
    resultCardImagePrompt: config.resultCardImagePrompt,
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
    imageApiBaseUrl: config.imageApiBaseUrl,
    imageApiRoute: config.imageApiRoute,
    imageApiKeyEncrypted: encryptSecret(config.imageApiKey, key),
    imageProtocol: config.imageProtocol,
    imageModel: config.imageModel,
    resultCardImagePrompt: config.resultCardImagePrompt,
    systemPrompt: config.systemPrompt,
    gameTypes: config.gameTypes,
    updatedAt: config.updatedAt,
  };
}

function loadedConfig(value, key, allowedOrigins, imageAllowedOrigins) {
  if (!isRecord(value) || value.version !== 1) throw new Error('Unsupported AI config format');
  const config = normalizeConfigInput(
    {
      apiBaseUrl: value.apiBaseUrl,
      apiKey: decryptSecret(value.apiKeyEncrypted, key),
      model: value.model,
      imageApiBaseUrl: value.imageApiBaseUrl ?? DEFAULT_AI_CONFIG.imageApiBaseUrl,
      imageApiRoute: value.imageApiRoute ?? DEFAULT_AI_CONFIG.imageApiRoute,
      imageApiKey: decryptSecret(value.imageApiKeyEncrypted, key),
      imageProtocol: value.imageProtocol ?? DEFAULT_AI_CONFIG.imageProtocol,
      imageModel: value.imageModel ?? DEFAULT_AI_CONFIG.imageModel,
      resultCardImagePrompt: value.resultCardImagePrompt ?? DEFAULT_AI_CONFIG.resultCardImagePrompt,
      systemPrompt: value.systemPrompt,
      gameTypes: value.gameTypes,
    },
    DEFAULT_AI_CONFIG,
    { allowedOrigins, imageAllowedOrigins },
  );
  config.updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null;
  return config;
}

export function createConfigStore({
  stateDir = process.env.STATE_DIR ?? 'data',
  encryptionKey = process.env.CONFIG_ENCRYPTION_KEY ?? '',
  allowedOrigins = process.env.AI_ALLOWED_ORIGINS ?? '',
  imageAllowedOrigins = process.env.IMAGE_AI_ALLOWED_ORIGINS ?? 'https://tokendance.space',
  initialConfig,
} = {}) {
  const path = join(stateDir, 'ai-config.json');
  const key = encryptionKeyFrom(encryptionKey);
  const allowedOriginList = Array.isArray(allowedOrigins)
    ? allowedOrigins
    : String(allowedOrigins).split(',').map((item) => item.trim()).filter(Boolean);
  const imageAllowedOriginList = Array.isArray(imageAllowedOrigins)
    ? imageAllowedOrigins
    : String(imageAllowedOrigins).split(',').map((item) => item.trim()).filter(Boolean);
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
      cache = loadedConfig(JSON.parse(raw), key, allowedOriginList, imageAllowedOriginList);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      cache = { ...DEFAULT_AI_CONFIG, gameTypes: cloneGameTypes(DEFAULT_GAME_TYPES) };
    }
    return { ...cache, gameTypes: cloneGameTypes(cache.gameTypes) };
  }

  async function update(value) {
    const operation = writeChain.then(async () => {
      const current = await readFromDisk();
      const next = normalizeConfigInput(value, current, {
        allowedOrigins: allowedOriginList,
        imageAllowedOrigins: imageAllowedOriginList,
      });
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
