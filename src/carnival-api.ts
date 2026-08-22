import type {
  CarnivalApi,
  CarnivalCreateInviteInput,
  CarnivalGameActionInput,
  CarnivalGameActionResponse,
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
