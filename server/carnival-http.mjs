import { createHash, randomUUID } from 'node:crypto';
import { createAiCapacityGate } from './ai-capacity.mjs';
import { createAiGameService } from './ai-game.mjs';
import { buildCarnivalFallbackGame, carnivalMatchFromState } from './carnival-games.mjs';
import { CarnivalError, createCarnivalService } from './carnival-service.mjs';
import { createConfigStore, DEFAULT_GAME_TYPES } from './config-store.mjs';
import {
  buildPromptPreview,
  configuredGameType,
  normalizePlayerPrompt,
  publicGameTypes,
  templateForId,
} from './game-templates.mjs';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function setHeaders(response, requestId) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-Request-Id', requestId);
}

function sendJson(response, status, body, requestId, headers = {}) {
  setHeaders(response, requestId);
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

function methodNotAllowed(response, requestId, allow) {
  sendJson(response, 405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED', request_id: requestId }, requestId, { Allow: allow });
}

function pathFor(request) {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function sameOrigin(request, publicOrigin) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string') return false;
  const fetchSite = request.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && !['same-origin', 'none'].includes(fetchSite)) return false;
  if (publicOrigin) return origin === publicOrigin;
  const host = request.headers.host;
  if (!host) return false;
  const forwardedProto = request.headers['x-forwarded-proto'];
  const protocol = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0] : 'http';
  return origin === `${protocol}://${host}`;
}

function hasJsonContentType(request) {
  const value = request.headers['content-type'];
  return typeof value === 'string' && /^application\/json(?:\s*;|$)/i.test(value);
}

async function readJson(request, maxBytes = 8_000) {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new CarnivalError('BODY_TOO_LARGE', 'Request body is too large', 413);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new CarnivalError('BODY_TOO_LARGE', 'Request body is too large', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new CarnivalError('INVALID_JSON', 'Request body must be valid JSON', 400);
  }
}

function bearerToken(request) {
  const authorization = request.headers.authorization;
  const match = typeof authorization === 'string' ? authorization.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/) : null;
  if (!match) throw new CarnivalError('UNAUTHORIZED', 'Carnival session is missing or expired', 401);
  return match[1];
}

function createRateLimiter(limit, windowMs, maximumKeys = 2_000) {
  const buckets = new Map();
  return (key, now = Date.now()) => {
    if (buckets.size >= maximumKeys && !buckets.has(key)) {
      for (const [itemKey, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(itemKey);
    }
    if (buckets.size >= maximumKeys && !buckets.has(key)) key = '__overflow__';
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    };
  };
}

function clientAddress(request, trustProxy) {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  }
  return request.socket?.remoteAddress ?? 'unknown';
}

function isoTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString();
}

function participant(value) {
  return { participantId: value.id, nickname: value.nickname, gender: value.gender };
}

function roleMap(state) {
  return new Map([
    [state.self.id, 'a'],
    [state.peer.id, 'b'],
  ]);
}

function networkGameState(rawInvite, state, serverNowMs) {
  const roles = roleMap(state);
  const game = rawInvite.game;
  const revealed = rawInvite.internalStatus === 'revealed' || rawInvite.status === 'revealed' || rawInvite.status === 'completed';
  const base = {
    inviteId: rawInvite.id,
    revision: state.revision,
    serverNowMs,
    templateId: rawInvite.templateId,
    title: game.title,
    description: game.description,
  };
  if (rawInvite.templateId === 'profile-riddle') {
    const answerFor = (personId) => {
      const value = rawInvite.reveal?.answers?.[personId];
      if (!value?.keywords) return undefined;
      const author = roles.get(personId);
      const target = author === 'a' ? 'b' : 'a';
      const keywords = value.keywords;
      return {
        author,
        target,
        keywords,
        sentence: value.sentence || `我觉得 TA 是一个${keywords[0]}、${keywords[1]}，而且很${keywords[2]}的人。`,
      };
    };
    const revealedA = answerFor(state.self.id);
    const revealedB = answerFor(state.peer.id);
    return {
      ...base,
      phase: revealed ? 'revealed' : 'collecting',
      target: { participantId: 'b', nickname: state.peer.nickname },
      keywordOptions: game.mechanics.keywordOptions,
      submitted: {
        a: Boolean(rawInvite.progress?.selfSubmitted),
        b: Boolean(rawInvite.progress?.peerSubmitted),
      },
      revealReady: { a: false, b: false },
      mySubmission: rawInvite.privateState?.keywords ? {
        author: 'a',
        target: 'b',
        keywords: rawInvite.privateState.keywords,
        sentence: rawInvite.privateState.sentence || '',
      } : undefined,
      revealedSubmissions: revealedA && revealedB ? { a: revealedA, b: revealedB } : undefined,
    };
  }
  if (rawInvite.templateId === 'keyword-wheel') {
    const lastSpin = rawInvite.shared?.lastSpin;
    const segments = game.mechanics.segments;
    const selectedIndex = lastSpin
      ? Math.max(0, segments.findIndex((segment) => segment.id === lastSpin.segment.id))
      : -1;
    const spins = rawInvite.actions.filter((action) => action.type === 'wheel-spin').length;
    const angle = 360 / Math.max(1, segments.length);
    return {
      ...base,
      phase: lastSpin ? 'selected' : 'ready',
      segments: segments.map((segment) => ({
        id: segment.id,
        keyword: segment.keyword,
        prompt: segment.prompt,
        followUps: [segment.followUp],
      })),
      spinSequence: spins,
      rotationDeg: lastSpin ? spins * 1_440 + 360 - (selectedIndex + 0.5) * angle : 0,
      selectedSegmentId: lastSpin?.segment?.id,
      followUpIndex: 0,
      lastSpunBy: lastSpin ? roles.get(lastSpin.actorId) : undefined,
      canSpin: true,
    };
  }
  const questions = game.questions;
  const selfAnswered = Number(rawInvite.progress?.selfAnswered ?? 0);
  const peerAnswered = Number(rawInvite.progress?.peerAnswered ?? 0);
  const selfCompleted = selfAnswered >= questions.length;
  const peerCompleted = peerAnswered >= questions.length;
  const startedAt = rawInvite.privateState?.questionStartedAt ?? rawInvite.privateState?.startedAt;
  const deadlineAt = rawInvite.privateState?.deadlineAt
    ?? (startedAt ? Number(startedAt) + 5_000 : undefined);
  const current = selfCompleted ? null : questions[selfAnswered];
  const results = revealed
    ? questions.map((question) => ({
        questionId: question.id,
        answers: {
          a: rawInvite.reveal?.answers?.[state.self.id]?.answers?.[question.id] ?? 'timeout',
          b: rawInvite.reveal?.answers?.[state.peer.id]?.answers?.[question.id] ?? 'timeout',
        },
      }))
    : undefined;
  return {
    ...base,
    phase: revealed ? 'revealed' : selfCompleted ? 'waiting-peer' : 'answering',
    roundSeconds: 5,
    questions: questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      options: question.options,
      matchedDiscussionPrompt: question.matchedFollowUp,
      differentDiscussionPrompt: question.differentFollowUp,
    })),
    self: {
      participantId: 'a',
      answeredCount: selfAnswered,
      completed: selfCompleted,
      currentQuestionId: current?.id,
      deadlineAtMs: current && deadlineAt ? Number(deadlineAt) : undefined,
    },
    peer: { participantId: 'b', answeredCount: peerAnswered, completed: peerCompleted },
    revealReady: { a: false, b: false },
    results,
  };
}

function invitationStatus(rawStatus) {
  if (rawStatus === 'revealed' || rawStatus === 'completed') return 'completed';
  if (rawStatus === 'active' || rawStatus === 'playing') return 'playing';
  return 'ready';
}

function publicInvite(rawInvite, state, serverNowMs = Date.now()) {
  return {
    inviteId: rawInvite.id,
    creatorId: rawInvite.creatorId,
    templateId: rawInvite.templateId,
    gameLabel: rawInvite.game.gameType,
    title: rawInvite.game.title,
    promptPreview: rawInvite.game.whyItFits || '根据你们的公开聊天生成',
    status: invitationStatus(rawInvite.status),
    createdAt: isoTime(rawInvite.createdAt),
    joinedParticipantIds: rawInvite.joinedParticipantIds,
    game: {
      gameId: rawInvite.game.id,
      kind: rawInvite.templateId,
      status: invitationStatus(rawInvite.status),
      version: state.revision,
      definition: networkGameState(rawInvite, state, serverNowMs),
    },
  };
}

function publicState(raw, gameTypes) {
  if (raw.status === 'closed') throw new CarnivalError('ROOM_CLOSED', 'The other participant has left this room', 410);
  const base = {
    revision: raw.revision,
    status: raw.status,
    self: participant(raw.self),
    canInvite: raw.canInvite,
    gameTypes,
    serverTime: new Date().toISOString(),
  };
  if (raw.status === 'queued') return { ...base, queuedAt: isoTime(raw.queuedAt) };
  const serverNow = Date.now();
  return {
    ...base,
    room: {
      roomId: raw.room.id,
      participants: [participant(raw.self), participant(raw.peer)],
      messages: raw.messages.filter((message) => message.type === 'text').map((message) => ({
        type: 'text',
        messageId: message.id,
        senderId: message.senderId,
        content: message.content,
        createdAt: isoTime(message.createdAt),
      })),
      invites: raw.invites.map((invite) => publicInvite(invite, raw, serverNow)),
      textMessageCount: raw.messageCount,
      inviteThreshold: raw.unlockAt,
      canInvite: raw.canInvite,
    },
  };
}

function tokenKey(token) {
  return createHash('sha256').update(token).digest('base64url');
}

export function createCarnivalHttpHandler({
  publicOrigin = process.env.PUBLIC_ORIGIN ?? '',
  trustProxy = process.env.TRUST_PROXY === '1',
  service = createCarnivalService(),
  configStore = createConfigStore(),
  aiService = createAiGameService(),
  aiGate,
} = {}) {
  const knownPaths = new Set([
    '/api/carnival/join',
    '/api/carnival/state',
    '/api/carnival/messages',
    '/api/carnival/prompt',
    '/api/carnival/invites',
    '/api/carnival/games/action',
    '/api/carnival/session',
  ]);
  const takeJoinRate = createRateLimiter(20, 10 * 60_000);
  const takeMessageRate = createRateLimiter(90, 60_000);
  const takeInviteRate = createRateLimiter(8, 10 * 60_000);
  const takeActionRate = createRateLimiter(180, 10 * 60_000);
  const capacityGate = aiGate ?? createAiCapacityGate();
  const inFlightInvites = new Map();

  async function gameTypesAndConfig() {
    try {
      const config = await configStore.get();
      return { config, gameTypes: publicGameTypes(config.gameTypes) };
    } catch {
      return { config: null, gameTypes: publicGameTypes(DEFAULT_GAME_TYPES) };
    }
  }

  function requireMutation(request, response, requestId) {
    if (!sameOrigin(request, publicOrigin) || !hasJsonContentType(request)) {
      sendJson(response, 403, { error: 'Same-origin JSON request required', code: 'SAME_ORIGIN_REQUIRED', request_id: requestId }, requestId);
      return false;
    }
    return true;
  }

  async function stateResponse(raw) {
    const { gameTypes } = await gameTypesAndConfig();
    return publicState(raw, gameTypes);
  }

  async function createInvitation(token, body, idempotencyKey) {
    const key = `${tokenKey(token)}:${idempotencyKey}`;
    const existing = inFlightInvites.get(key);
    if (existing) return existing;
    const promise = (async () => {
      const replay = typeof service.getInviteByIdempotencyKey === 'function'
        ? await service.getInviteByIdempotencyKey(token, idempotencyKey)
        : null;
      if (replay) {
        const { gameTypes } = await gameTypesAndConfig();
        return {
          invite: publicInvite(replay.invite, replay.state),
          state: publicState(replay.state, gameTypes),
        };
      }
      const rawState = await service.getState(token);
      if (!rawState.canInvite) throw new CarnivalError('INVITE_LOCKED', 'Ten text messages are required before inviting a game', 409);
      const { config, gameTypes } = await gameTypesAndConfig();
      const selected = config ? configuredGameType(config.gameTypes, body.templateId) : DEFAULT_GAME_TYPES.find((item) => item.id === body.templateId);
      const publicType = gameTypes.find((item) => item.id === body.templateId);
      if (!selected || !publicType?.enabled) throw new CarnivalError('GAME_TEMPLATE_NOT_ENABLED', 'Game template is not enabled', 400);
      if (!templateForId(selected.id)?.available) throw new CarnivalError('GAME_TEMPLATE_UNAVAILABLE', 'This game template is not available yet', 409);
      const prompt = normalizePlayerPrompt(body.prompt);
      const match = carnivalMatchFromState(rawState);
      let game = buildCarnivalFallbackGame(match, selected.id, selected.label);
      if (config?.apiKey) {
        const slot = capacityGate.acquire();
        if (slot.allowed) {
          try {
            game = await aiService.generate(config, match, {
              templateId: selected.id,
              gameLabel: selected.label,
              prompt,
            });
          } catch {
            // The carnival must stay playable even if the configured provider rejects a request.
          } finally {
            slot.release();
          }
        }
      }
      const created = await service.createInvite(token, {
        templateId: selected.id,
        prompt,
        game,
        idempotencyKey,
      });
      return {
        invite: publicInvite(created.invite, created.state),
        state: publicState(created.state, gameTypes),
      };
    })();
    inFlightInvites.set(key, promise);
    promise.finally(() => {
      if (inFlightInvites.get(key) === promise) inFlightInvites.delete(key);
    }).catch(() => {});
    return promise;
  }

  return async function handleCarnival(request, response) {
    const path = pathFor(request);
    if (!knownPaths.has(path)) return false;
    const requestId = randomUUID();
    try {
      if (path === '/api/carnival/join') {
        if (request.method !== 'POST') methodNotAllowed(response, requestId, 'POST');
        else if (requireMutation(request, response, requestId)) {
          const rate = takeJoinRate(clientAddress(request, trustProxy));
          if (!rate.allowed) sendJson(response, 429, { error: 'Too many carnival join attempts', code: 'RATE_LIMITED', request_id: requestId }, requestId, { 'Retry-After': String(rate.retryAfter) });
          else {
            const joined = await service.joinQueue(await readJson(request, 2_000));
            sendJson(response, 201, { token: joined.token, state: await stateResponse(joined.state) }, requestId);
          }
        }
        return true;
      }

      const token = bearerToken(request);
      if (path === '/api/carnival/state') {
        if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) methodNotAllowed(response, requestId, 'GET, HEAD');
        else sendJson(response, 200, await stateResponse(await service.getState(token)), requestId);
      } else if (path === '/api/carnival/messages') {
        if (request.method !== 'POST') methodNotAllowed(response, requestId, 'POST');
        else if (requireMutation(request, response, requestId)) {
          const rate = takeMessageRate(tokenKey(token));
          if (!rate.allowed) sendJson(response, 429, { error: 'Too many messages', code: 'RATE_LIMITED', request_id: requestId }, requestId, { 'Retry-After': String(rate.retryAfter) });
          else {
            const result = await service.sendMessage(token, await readJson(request, 4_000));
            sendJson(response, 201, await stateResponse(result.state), requestId);
          }
        }
      } else if (path === '/api/carnival/prompt') {
        if (request.method !== 'POST') methodNotAllowed(response, requestId, 'POST');
        else if (requireMutation(request, response, requestId)) {
          const body = await readJson(request, 2_000);
          await service.buildPrompt(token, body);
          const rawState = await service.getState(token);
          const { config, gameTypes } = await gameTypesAndConfig();
          const selected = config ? configuredGameType(config.gameTypes, body.templateId) : DEFAULT_GAME_TYPES.find((item) => item.id === body.templateId);
          const publicType = gameTypes.find((item) => item.id === body.templateId);
          if (!selected || !publicType?.enabled) throw new CarnivalError('GAME_TEMPLATE_NOT_ENABLED', 'Game template is not enabled', 400);
          if (!publicType.available) throw new CarnivalError('GAME_TEMPLATE_UNAVAILABLE', 'This game template is not available yet', 409);
          const preview = buildPromptPreview(carnivalMatchFromState(rawState), selected);
          sendJson(response, 200, {
            templateId: selected.id,
            label: selected.label,
            description: publicType.description,
            prompt: preview,
            maxLength: 1_500,
          }, requestId);
        }
      } else if (path === '/api/carnival/invites') {
        if (request.method !== 'POST') methodNotAllowed(response, requestId, 'POST');
        else if (requireMutation(request, response, requestId)) {
          const rate = takeInviteRate(tokenKey(token));
          if (!rate.allowed) sendJson(response, 429, { error: 'Too many game invitations', code: 'RATE_LIMITED', request_id: requestId }, requestId, { 'Retry-After': String(rate.retryAfter) });
          else {
            const key = request.headers['idempotency-key'];
            if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{20,120}$/.test(key)) {
              throw new CarnivalError('INVALID_IDEMPOTENCY_KEY', 'A valid Idempotency-Key header is required', 400);
            }
            const body = await readJson(request, 8_000);
            if (!isRecord(body) || typeof body.templateId !== 'string' || typeof body.prompt !== 'string') {
              throw new CarnivalError('INVALID_INPUT', 'Invalid carnival invitation', 400);
            }
            sendJson(response, 201, await createInvitation(token, body, key), requestId);
          }
        }
      } else if (path === '/api/carnival/games/action') {
        if (request.method !== 'POST') methodNotAllowed(response, requestId, 'POST');
        else if (requireMutation(request, response, requestId)) {
          const rate = takeActionRate(tokenKey(token));
          if (!rate.allowed) sendJson(response, 429, { error: 'Too many game actions', code: 'RATE_LIMITED', request_id: requestId }, requestId, { 'Retry-After': String(rate.retryAfter) });
          else {
            const body = await readJson(request, 8_000);
            if (!isRecord(body) || typeof body.inviteId !== 'string' || typeof body.action !== 'string') {
              throw new CarnivalError('INVALID_ACTION', 'Invalid carnival game action', 400);
            }
            const payload = isRecord(body.payload) ? body.payload : {};
            let result;
            if (body.action === 'join') result = await service.joinInvite(token, body.inviteId);
            else if (body.action === 'profile-riddle.submit') result = await service.gameAction(token, body.inviteId, { type: 'profile-submit', keywords: payload.keywords, sentence: payload.sentence });
            else if (body.action === 'keyword-wheel.spin') result = await service.gameAction(token, body.inviteId, { type: 'wheel-spin' });
            else if (body.action === 'keyword-wheel.next-follow-up' || body.action.endsWith('.confirm-reveal')) result = await service.getInvite(token, body.inviteId);
            else if (body.action === 'rapid-choice.answer') result = await service.gameAction(token, body.inviteId, { type: 'rapid-answer', questionId: payload.questionId, answer: payload.answer });
            else if (body.action === 'rapid-choice.timeout') result = await service.gameAction(token, body.inviteId, { type: 'rapid-answer', questionId: payload.questionId, answer: 'timeout' });
            else throw new CarnivalError('INVALID_ACTION', 'Unsupported carnival game action', 400);
            const rawState = result.state ?? await service.getState(token);
            if (body.action === 'join') {
              const current = result.invite;
              if (current.templateId === 'rapid-choice' && current.joinedParticipantIds.length === 2 && !current.privateState?.startedAt) {
                try {
                  result = await service.gameAction(token, body.inviteId, { type: 'rapid-start' });
                } catch (error) {
                  if (error?.code !== 'ALREADY_STARTED') throw error;
                }
              }
            }
            const finalState = result.state ?? rawState;
            const finalInvite = result.invite ?? (await service.getInvite(token, body.inviteId)).invite;
            const { gameTypes } = await gameTypesAndConfig();
            sendJson(response, 200, {
              invite: publicInvite(finalInvite, finalState),
              state: publicState(finalState, gameTypes),
            }, requestId);
          }
        }
      } else if (path === '/api/carnival/session') {
        if (request.method !== 'DELETE') methodNotAllowed(response, requestId, 'DELETE');
        else if (!sameOrigin(request, publicOrigin)) sendJson(response, 403, { error: 'Same-origin request required', code: 'SAME_ORIGIN_REQUIRED', request_id: requestId }, requestId);
        else {
          await service.leave(token);
          sendJson(response, 200, { status: 'left' }, requestId);
        }
      }
      return true;
    } catch (error) {
      const status = error instanceof CarnivalError ? error.status : Number(error?.status) || 500;
      const code = error instanceof CarnivalError ? error.code : status < 500 ? 'CARNIVAL_REQUEST_FAILED' : 'CARNIVAL_UNAVAILABLE';
      const message = error instanceof CarnivalError || status < 500 ? error.message : 'Carnival service is temporarily unavailable';
      sendJson(response, status, { error: message, code, request_id: requestId }, requestId);
      return true;
    }
  };
}
