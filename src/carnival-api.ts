import type {
  CarnivalApi,
  CarnivalCreateInviteInput,
  CarnivalGameActionInput,
  CarnivalGameActionResponse,
  CarnivalGamePreview,
  CarnivalGamePreviewInput,
  CarnivalGameType,
  CarnivalGender,
  CarnivalInvite,
  CarnivalInviteResponse,
  CarnivalInviteStatus,
  CarnivalInviteView,
  CarnivalJoinInput,
  CarnivalJoinResponse,
  CarnivalNetworkGame,
  CarnivalParticipant,
  CarnivalPromptPreview,
  CarnivalRoom,
  CarnivalState,
  CarnivalTextMessage,
  CarnivalExclusiveGameDefinition,
  CarnivalExclusiveInteraction,
  CarnivalArcadeGameDefinition,
  CarnivalArcadeKind,
  CarnivalArcadePreset,
  CarnivalPromptGameDefinition,
} from './carnival-types';
import { exclusiveSeriesById, type CarnivalExclusiveSeriesId } from './carnival-exclusive';

type JsonObject = Record<string, unknown>;

export class CarnivalApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 0, code = 'CARNIVAL_REQUEST_FAILED') {
    super(message);
    this.name = 'CarnivalApiError';
    this.status = status;
    this.code = code;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function number(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function asGender(value: unknown): CarnivalGender {
  if (value === 'female' || value === 'male') return value;
  throw new CarnivalApiError('服务器返回了无法识别的性别字段。', 0, 'CARNIVAL_BAD_RESPONSE');
}

function participant(value: unknown): CarnivalParticipant {
  if (!isObject(value)) throw new CarnivalApiError('参与者资料缺失。', 0, 'CARNIVAL_BAD_RESPONSE');
  const participantId = text(value.participantId, text(value.id));
  const nickname = text(value.nickname);
  if (!participantId || !nickname) throw new CarnivalApiError('参与者资料不完整。', 0, 'CARNIVAL_BAD_RESPONSE');
  return { participantId, nickname, gender: asGender(value.gender) };
}

function message(value: unknown): CarnivalTextMessage {
  if (!isObject(value)) throw new CarnivalApiError('聊天消息格式错误。', 0, 'CARNIVAL_BAD_RESPONSE');
  const messageId = text(value.messageId, text(value.id));
  const senderId = text(value.senderId);
  const content = text(value.content);
  const createdAt = text(value.createdAt, new Date().toISOString());
  if (!messageId || !senderId) throw new CarnivalApiError('聊天消息缺少标识。', 0, 'CARNIVAL_BAD_RESPONSE');
  return { type: 'text', messageId, senderId, content, createdAt };
}

function networkGame(value: unknown): CarnivalNetworkGame | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) throw new CarnivalApiError('联网游戏数据格式错误。', 0, 'CARNIVAL_BAD_RESPONSE');
  return {
    gameId: text(value.gameId, text(value.id)),
    kind: text(value.kind, 'custom'),
    status: text(value.status, 'ready'),
    version: number(value.version, 0),
    definition: value.definition,
  };
}

const INVITE_STATUSES = new Set<CarnivalInviteStatus>([
  'generating', 'ready', 'joined', 'playing', 'completed', 'failed', 'expired',
]);

function invite(value: unknown): CarnivalInviteView {
  if (!isObject(value)) throw new CarnivalApiError('游戏邀请格式错误。', 0, 'CARNIVAL_BAD_RESPONSE');
  const inviteId = text(value.inviteId, text(value.id));
  const creatorId = text(value.creatorId);
  const templateId = text(value.templateId);
  const rawStatus = text(value.status, 'ready') as CarnivalInviteStatus;
  if (!inviteId || !creatorId || !templateId || !INVITE_STATUSES.has(rawStatus)) {
    throw new CarnivalApiError('游戏邀请缺少必要字段。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  const joined = Array.isArray(value.joinedParticipantIds)
    ? value.joinedParticipantIds.filter((item): item is string => typeof item === 'string')
    : Array.isArray(value.joinedBy)
      ? value.joinedBy.filter((item): item is string => typeof item === 'string')
      : [];
  return {
    inviteId,
    creatorId,
    templateId,
    seriesId: exclusiveSeriesById(value.seriesId)?.id
      ?? (isObject(value.game) && isObject(value.game.definition)
        ? exclusiveSeriesById(value.game.definition.seriesId)?.id
        : undefined),
    gameLabel: text(value.gameLabel, text(value.label, '双人小游戏')),
    title: text(value.title, '来玩这一局'),
    promptPreview: text(value.promptPreview, text(value.prompt)).slice(0, 240),
    status: rawStatus,
    createdAt: text(value.createdAt, new Date().toISOString()),
    joinedParticipantIds: joined,
    game: networkGame(value.game),
    privateState: value.privateState,
    reveal: value.reveal,
  };
}

function gameType(value: unknown): CarnivalGameType | null {
  if (!isObject(value)) return null;
  const templateId = text(value.templateId, text(value.id));
  const label = text(value.label);
  if (!templateId || !label) return null;
  return {
    templateId,
    label,
    description: text(value.description),
    enabled: boolean(value.enabled, true),
    available: boolean(value.available, true),
  };
}

function room(value: unknown): CarnivalRoom {
  if (!isObject(value)) throw new CarnivalApiError('匹配房间缺失。', 0, 'CARNIVAL_BAD_RESPONSE');
  const roomId = text(value.roomId, text(value.id));
  const participants = Array.isArray(value.participants) ? value.participants.map(participant) : [];
  const messages = Array.isArray(value.messages) ? value.messages.map(message) : [];
  const invites = Array.isArray(value.invites) ? value.invites.map(invite) : [];
  if (!roomId || participants.length !== 2) {
    throw new CarnivalApiError('匹配房间资料不完整。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  return {
    roomId,
    participants,
    messages,
    invites,
    textMessageCount: Math.max(number(value.textMessageCount, messages.length), messages.length),
    inviteThreshold: Math.max(1, number(value.inviteThreshold, 10)),
    canInvite: boolean(value.canInvite),
  };
}

export function normalizeCarnivalState(value: unknown): CarnivalState {
  const source = isObject(value) && isObject(value.state) ? value.state : value;
  if (!isObject(source) || (source.status !== 'queued' && source.status !== 'matched')) {
    throw new CarnivalApiError('游园会状态格式错误。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  const normalizedRoom = source.status === 'matched' ? room(source.room) : undefined;
  const types = Array.isArray(source.gameTypes)
    ? source.gameTypes.map(gameType).filter((item): item is CarnivalGameType => Boolean(item))
    : [];
  return {
    revision: Math.max(0, number(source.revision)),
    status: source.status,
    self: participant(source.self),
    room: normalizedRoom,
    canInvite: boolean(source.canInvite, normalizedRoom?.canInvite ?? false),
    gameTypes: types,
    queuedAt: text(source.queuedAt) || undefined,
    serverTime: text(source.serverTime) || undefined,
  };
}

function promptPreview(value: unknown): CarnivalPromptPreview {
  const source = isObject(value) && isObject(value.preview) ? value.preview : value;
  if (!isObject(source)) throw new CarnivalApiError('Prompt 预览格式错误。', 0, 'CARNIVAL_BAD_RESPONSE');
  const templateId = text(source.templateId);
  const prompt = text(source.prompt);
  if (!templateId || !prompt) throw new CarnivalApiError('Prompt 预览缺少必要字段。', 0, 'CARNIVAL_BAD_RESPONSE');
  const maxLength = Math.min(10_000, Math.max(20, number(source.maxLength, 1_500)));
  return {
    templateId,
    seriesId: exclusiveSeriesById(source.seriesId)?.id ?? undefined,
    label: text(source.label, '双人小游戏'),
    description: text(source.description),
    prompt: prompt.slice(0, maxLength),
    maxLength,
  };
}

const PRESENTATION_TONES = new Set(['coral', 'violet', 'mint', 'gold', 'blue']);
const PRESENTATION_SCENES = new Set(['court', 'archive', 'cinema', 'lab', 'cosmos']);
const PRESENTATION_MOTIONS = new Set(['pop', 'float', 'slide', 'orbit', 'pulse']);
const REVEAL_EFFECTS = new Set(['confetti', 'ripple', 'spotlight', 'stars', 'cards']);
const ARCADE_KINDS = new Set<CarnivalArcadeKind>(['competition', 'cooperation', 'sport', 'adventure', 'strategy']);
const ARCADE_PRESETS = new Set<CarnivalArcadePreset>([
  'dash-duel', 'tandem-rescue', 'basketball-duel', 'relic-expedition', 'grid-command',
]);
const ARCADE_THEMES = new Set(['sunset', 'neon', 'forest', 'ocean', 'cosmos']);
const ARCADE_DIFFICULTIES = new Set(['easy', 'normal', 'hard']);
const ARCADE_PARAM_KEYS = [
  'durationMs', 'tickMs', 'arenaWidth', 'arenaHeight', 'primarySpeed',
  'secondarySpeed', 'gravity', 'targetSize', 'projectileRadius', 'targetScore', 'maxRounds',
] as const;

function enumValue<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value) ? value as T : fallback;
}

function exclusiveInteraction(value: unknown, optionCount: number): CarnivalExclusiveInteraction | null {
  if (!isObject(value)) return null;
  if (value.kind === 'card-grid' && optionCount >= 2 && optionCount <= 4 && (value.variant === 'tiles' || value.variant === 'tickets')) {
    return { kind: value.kind, variant: value.variant };
  }
  if (value.kind === 'swipe-deck' && optionCount === 2 && (value.variant === 'split' || value.variant === 'stack')) {
    return { kind: value.kind, variant: value.variant };
  }
  if (value.kind === 'mood-dial' && optionCount >= 3 && optionCount <= 4 && (value.variant === 'compass' || value.variant === 'meter')) {
    return { kind: value.kind, variant: value.variant };
  }
  if (value.kind === 'orbit-pick' && optionCount >= 3 && optionCount <= 4 && (value.variant === 'constellation' || value.variant === 'bubbles')) {
    return { kind: value.kind, variant: value.variant };
  }
  return null;
}

function exclusiveQuestion(value: unknown, index: number) {
  if (!isObject(value)) throw new CarnivalApiError('可玩预览包含无法识别的题目。', 0, 'CARNIVAL_BAD_RESPONSE');
  const options = Array.isArray(value.options) && value.options.length >= 2 && value.options.length <= 4 &&
    value.options.every((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    ? value.options.map((item) => item.trim())
    : [];
  const prompt = text(value.prompt).trim();
  if (!prompt || options.length < 2) {
    throw new CarnivalApiError('可玩预览的题面不完整。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  const interaction = exclusiveInteraction(value.interaction, options.length);
  if (!interaction) {
    throw new CarnivalApiError('可玩预览包含不支持的互动规则。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  return {
    id: text(value.id, `preview-question-${index + 1}`),
    label: text(value.label, `互动 ${index + 1}`),
    source: text(value.source, '根据双方公开聊天现做'),
    prompt,
    options,
    interaction,
    matchedFollowUp: text(value.matchedFollowUp) || undefined,
    differentFollowUp: text(value.differentFollowUp) || undefined,
  };
}

export function normalizeCarnivalExclusiveGame(value: unknown): CarnivalExclusiveGameDefinition {
  const source = isObject(value) && isObject(value.definition) ? value.definition : value;
  if (!isObject(source)) throw new CarnivalApiError('可玩预览缺少游戏内容。', 0, 'CARNIVAL_BAD_RESPONSE');
  if (source.schemaVersion !== 3 || source.templateId !== 'custom' || source.engine !== 'exclusive-choice-v1') {
    throw new CarnivalApiError('可玩预览使用了不支持的游戏协议。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  const series = exclusiveSeriesById(source.seriesId);
  const questions = Array.isArray(source.questions) && source.questions.length === 3
    ? source.questions.map(exclusiveQuestion)
    : [];
  if (!series || questions.length !== 3 || (source.generatedBy !== 'ai' && source.generatedBy !== 'fallback')) {
    throw new CarnivalApiError('可玩预览缺少系列或题目。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  const presentation = isObject(source.presentation) ? source.presentation : {};
  const ending = isObject(source.ending) ? source.ending : {};
  return {
    schemaVersion: 3,
    templateId: 'custom',
    seriesId: series.id,
    engine: 'exclusive-choice-v1',
    generatedBy: source.generatedBy,
    title: text(source.title, series.title).slice(0, 120),
    description: text(source.description, series.description).slice(0, 360),
    presentation: {
      tone: enumValue(presentation.tone, PRESENTATION_TONES, 'violet'),
      scene: enumValue(presentation.scene, PRESENTATION_SCENES, 'archive'),
      motion: enumValue(presentation.motion, PRESENTATION_MOTIONS, 'pop'),
      revealEffect: enumValue(presentation.revealEffect, REVEAL_EFFECTS, 'cards'),
    },
    ending: {
      headline: text(ending.headline, '你们完成了这局专属游戏').slice(0, 120),
      summary: text(ending.summary, '把刚才出现的同频和不同，留给下一段聊天慢慢展开。').slice(0, 360),
      chatPrompt: text(ending.chatPrompt, '刚才哪一个选择最让你意外？').slice(0, 240),
    },
    questions,
  };
}

function arcadeText(value: unknown, fallback: string, maximum: number) {
  const normalized = text(value, fallback).replace(/[\u0000-\u001F\u007F]/gu, ' ').trim();
  return (normalized || fallback).slice(0, maximum);
}

function arcadeRoles(value: unknown) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new CarnivalApiError('AI 游戏缺少双方角色。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  return value.map((item) => {
    if (!isObject(item) || !Array.isArray(item.controls)) {
      throw new CarnivalApiError('AI 游戏角色格式错误。', 0, 'CARNIVAL_BAD_RESPONSE');
    }
    const controls = item.controls.filter((control): control is string => (
      typeof control === 'string' && /^[a-z][a-z0-9._-]{0,39}$/u.test(control)
    ));
    if (controls.length === 0 || controls.length !== item.controls.length || new Set(controls).size !== controls.length) {
      throw new CarnivalApiError('AI 游戏包含无法识别的操作。', 0, 'CARNIVAL_BAD_RESPONSE');
    }
    return {
      id: arcadeText(item.id, '', 40),
      label: arcadeText(item.label, '游戏角色', 40),
      objective: arcadeText(item.objective, '完成这一局的目标', 100),
      controls,
    };
  });
}

export function normalizeCarnivalArcadeGame(value: unknown): CarnivalArcadeGameDefinition {
  const source = isObject(value) && isObject(value.definition) ? value.definition : value;
  if (!isObject(source) || source.schemaVersion !== 4 || source.engine !== 'arcade-v1' ||
    source.templateId !== 'custom' || source.seriesId !== 'prompt-arcade') {
    throw new CarnivalApiError('AI 游戏使用了不支持的运行协议。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  if (source.generatedBy !== 'ai' && source.generatedBy !== 'fallback') {
    throw new CarnivalApiError('AI 游戏缺少生成来源。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  const arcade = isObject(source.arcade) ? source.arcade : null;
  const artifact = isObject(source.artifact) ? source.artifact : null;
  if (!arcade || !artifact || !ARCADE_KINDS.has(arcade.kind as CarnivalArcadeKind) ||
    !ARCADE_PRESETS.has(arcade.preset as CarnivalArcadePreset) ||
    !ARCADE_THEMES.has(String(arcade.theme)) || !ARCADE_DIFFICULTIES.has(String(arcade.difficulty))) {
    throw new CarnivalApiError('AI 游戏缺少受支持的玩法。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  const paramsSource = isObject(arcade.params) ? arcade.params : null;
  if (!paramsSource || ARCADE_PARAM_KEYS.some((key) => typeof paramsSource[key] !== 'number' || !Number.isFinite(paramsSource[key]))) {
    throw new CarnivalApiError('AI 游戏参数格式错误。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  const artifactId = text(artifact.artifactId);
  const codeHash = text(artifact.codeHash);
  const runtimePath = text(artifact.runtimePath);
  if (!/^artifact_[A-Za-z0-9_-]{32,80}$/u.test(artifactId) || !/^[a-f0-9]{64}$/u.test(codeHash) ||
    !/^\/api\/(?:carnival\/)?games\/runtime\/artifact_[A-Za-z0-9_-]{32,80}$/u.test(runtimePath)) {
    throw new CarnivalApiError('AI 游戏代码版本不完整。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  const topics = Array.isArray(source.topics)
    ? source.topics.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 24)).filter(Boolean).slice(0, 4)
    : [];
  if (topics.length < 2) throw new CarnivalApiError('AI 游戏缺少主题。', 0, 'CARNIVAL_BAD_RESPONSE');
  return {
    schemaVersion: 4,
    templateId: 'custom',
    seriesId: 'prompt-arcade',
    engine: 'arcade-v1',
    generatedBy: source.generatedBy,
    title: arcadeText(source.title, 'AI 双人小游戏', 60),
    eyebrow: arcadeText(source.eyebrow, 'AI GAME', 30),
    description: arcadeText(source.description, '一局刚刚生成的双人互动游戏。', 200),
    whyItFits: arcadeText(source.whyItFits, '依据公开聊天主题生成。', 200),
    estimatedMinutes: Math.max(1, Math.min(3, Math.round(number(source.estimatedMinutes, 2)))),
    topics,
    arcade: {
      kind: arcade.kind as CarnivalArcadeKind,
      preset: arcade.preset as CarnivalArcadePreset,
      theme: arcade.theme as CarnivalArcadeGameDefinition['arcade']['theme'],
      difficulty: arcade.difficulty as CarnivalArcadeGameDefinition['arcade']['difficulty'],
      params: Object.fromEntries(ARCADE_PARAM_KEYS.map((key) => [key, number(paramsSource[key])])),
      roles: arcadeRoles(arcade.roles),
    },
    artifact: { artifactId, codeHash, runtimePath },
  };
}

export function normalizeCarnivalPromptGame(value: unknown): CarnivalPromptGameDefinition {
  const source = isObject(value) && isObject(value.definition) ? value.definition : value;
  return isObject(source) && (source.schemaVersion === 4 || source.engine === 'arcade-v1')
    ? normalizeCarnivalArcadeGame(source)
    : normalizeCarnivalExclusiveGame(source);
}

function gamePreview(value: unknown): CarnivalGamePreview {
  if (!isObject(value)) throw new CarnivalApiError('可玩预览响应格式错误。', 0, 'CARNIVAL_BAD_RESPONSE');
  const previewToken = text(value.previewToken);
  const expiresAt = text(value.expiresAt);
  if (!previewToken || !expiresAt) {
    throw new CarnivalApiError('可玩预览缺少版本令牌。', 0, 'CARNIVAL_BAD_RESPONSE');
  }
  return { previewToken, expiresAt, game: normalizeCarnivalPromptGame(value.game) };
}

async function requestJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new CarnivalApiError('暂时连接不上游园会，请检查网络后重试。');
  }

  const raw = response.status === 204 ? '' : await response.text();
  let payload: unknown = undefined;
  if (raw) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      throw new CarnivalApiError('服务器返回了无法解析的数据。', response.status, 'CARNIVAL_BAD_RESPONSE');
    }
  }
  if (!response.ok) {
    const source = isObject(payload) ? payload : {};
    throw new CarnivalApiError(
      text(source.error, text(source.message, `请求失败（${response.status}）`)),
      response.status,
      text(source.code, 'CARNIVAL_REQUEST_FAILED'),
    );
  }
  return payload;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function createCarnivalApi({
  basePath = '/api/carnival',
  fetcher = fetch,
}: {
  basePath?: string;
  fetcher?: typeof fetch;
} = {}): CarnivalApi {
  const path = basePath.replace(/\/$/, '');
  return {
    async join(input: CarnivalJoinInput, signal?: AbortSignal): Promise<CarnivalJoinResponse> {
      const payload = await requestJson(fetcher, `${path}/join`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!isObject(payload) || !text(payload.token)) {
        throw new CarnivalApiError('加入游园会的响应缺少会话令牌。', 0, 'CARNIVAL_BAD_RESPONSE');
      }
      return { token: text(payload.token), state: normalizeCarnivalState(payload.state) };
    },

    async getState(token: string, signal?: AbortSignal) {
      return normalizeCarnivalState(await requestJson(fetcher, `${path}/state`, {
        method: 'GET', signal, headers: bearer(token),
      }));
    },

    async sendMessage(token: string, content: string, signal?: AbortSignal) {
      const payload = await requestJson(fetcher, `${path}/messages`, {
        method: 'POST', signal,
        headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      return normalizeCarnivalState(payload);
    },

    async getPrompt(
      token: string,
      templateId: string,
      signal?: AbortSignal,
      seriesId?: CarnivalExclusiveSeriesId,
    ) {
      return promptPreview(await requestJson(fetcher, `${path}/prompt`, {
        method: 'POST', signal,
        headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, ...(seriesId ? { seriesId } : {}) }),
      }));
    },

    async createGamePreview(
      token: string,
      input: CarnivalGamePreviewInput,
      signal?: AbortSignal,
    ) {
      return gamePreview(await requestJson(fetcher, `${path}/game-preview`, {
        method: 'POST', signal,
        headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: 'custom',
          seriesId: input.seriesId,
          prompt: input.prompt,
        }),
      }));
    },

    async createInvite(
      token: string,
      input: CarnivalCreateInviteInput,
      signal?: AbortSignal,
    ): Promise<CarnivalInviteResponse> {
      const payload = await requestJson(fetcher, `${path}/invites`, {
        method: 'POST', signal,
        headers: {
          ...bearer(token),
          'Content-Type': 'application/json',
          'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          templateId: input.templateId,
          ...(input.seriesId ? { seriesId: input.seriesId } : {}),
          prompt: input.prompt,
          ...(input.previewToken ? { previewToken: input.previewToken } : {}),
        }),
      });
      if (!isObject(payload)) throw new CarnivalApiError('邀请响应格式错误。', 0, 'CARNIVAL_BAD_RESPONSE');
      return { invite: invite(payload.invite), state: normalizeCarnivalState(payload.state) };
    },

    async gameAction(
      token: string,
      input: CarnivalGameActionInput,
      signal?: AbortSignal,
    ): Promise<CarnivalGameActionResponse> {
      const payload = await requestJson(fetcher, `${path}/games/action`, {
        method: 'POST', signal,
        headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!isObject(payload)) throw new CarnivalApiError('游戏动作响应格式错误。', 0, 'CARNIVAL_BAD_RESPONSE');
      return { invite: invite(payload.invite), state: normalizeCarnivalState(payload.state) };
    },

    async deleteSession(token: string, signal?: AbortSignal) {
      await requestJson(fetcher, `${path}/session`, {
        method: 'DELETE', signal, headers: bearer(token),
      });
    },
  };
}

export const defaultCarnivalApi = createCarnivalApi();

export function isCarnivalUnauthorized(error: unknown) {
  return error instanceof CarnivalApiError && (error.status === 401 || error.status === 403);
}

export function carnivalErrorMessage(error: unknown) {
  return error instanceof CarnivalApiError ? error.message : '发生了未知错误，请稍后重试。';
}

export function isAbortError(error: unknown) {
  return error !== null && typeof error === 'object' && 'name' in error && error.name === 'AbortError';
}

export type { CarnivalInvite };
