import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ARCADE_GAME_ENGINE,
  ARCADE_GAME_SCHEMA_VERSION,
  arcadeScriptCspSources,
  assertArcadeGameDefinition,
} from './arcade-game.mjs';
import { createAiCapacityGate } from './ai-capacity.mjs';
import { createAiGameService } from './ai-game.mjs';
import { buildCarnivalFallbackGame, carnivalMatchFromState } from './carnival-games.mjs';
import { CarnivalError, createCarnivalService } from './carnival-service.mjs';
import { createConfigStore, DEFAULT_GAME_TYPES } from './config-store.mjs';
import { exclusiveSeriesForId, requireExclusiveSeries } from './exclusive-series.mjs';
import {
  buildPromptPreview,
  configuredGameType,
  hasUnsafeGameText,
  normalizePlayerPrompt,
  publicGameTypes,
  templateForId,
} from './game-templates.mjs';
import { assertPromptGameDefinition } from './prompt-game.mjs';

const GAME_PREVIEW_TTL_MS = 5 * 60_000;
const GAME_PREVIEW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,120}$/;
const MAX_GAME_PREVIEWS = 2_000;

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

function sendArcadeDocument(response, request, artifact, requestId) {
  const body = request.method === 'HEAD' ? '' : artifact.document;
  const scriptSources = arcadeScriptCspSources(artifact.document).join(' ');
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Origin-Agent-Cluster', '?1');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('X-Request-Id', requestId);
  response.setHeader('X-Arcade-Code-Hash', artifact.codeHash);
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; script-src ${scriptSources}; script-src-attr 'none'; style-src 'unsafe-inline'; img-src 'none'; ` +
      "font-src 'none'; media-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; " +
      "child-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'; frame-ancestors 'self'; sandbox allow-scripts",
  );
  response.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), sync-xhr=(), usb=()',
  );
  response.end(body);
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

function publicGeneratedGame(game) {
  const projected = structuredClone(game);
  if (
    projected?.schemaVersion === ARCADE_GAME_SCHEMA_VERSION &&
    projected?.engine === ARCADE_GAME_ENGINE &&
    projected.artifact
  ) {
    projected.artifact = {
      artifactId: projected.artifact.artifactId,
      codeHash: projected.artifact.codeHash,
      runtimePath: `/api/carnival/games/runtime/${projected.artifact.artifactId}`,
    };
  }
  return projected;
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
  const revision = rawInvite.templateId === 'custom' && Number.isSafeInteger(rawInvite.revision)
    ? rawInvite.revision
    : state.revision;
  const revealed = rawInvite.internalStatus === 'revealed' || rawInvite.status === 'revealed' || rawInvite.status === 'completed';
  const base = {
    inviteId: rawInvite.id,
    revision,
    serverNowMs,
    templateId: rawInvite.templateId,
    schemaVersion: game.schemaVersion,
    title: game.title,
    description: game.description,
    generatedBy: game.generatedBy,
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
  if (
    rawInvite.templateId === 'custom' &&
    game.schemaVersion === ARCADE_GAME_SCHEMA_VERSION &&
    game.engine === ARCADE_GAME_ENGINE
  ) {
    const arcade = rawInvite.shared?.arcade ?? {};
    return {
      ...base,
      engine: ARCADE_GAME_ENGINE,
      seriesId: rawInvite.seriesId,
      phase: arcade.phase ?? 'waiting',
      arcade: structuredClone(game.arcade),
      artifact: structuredClone(game.artifact),
      self: structuredClone(arcade.self ?? rawInvite.privateState ?? {}),
      peer: structuredClone(arcade.peer ?? {}),
      frame: structuredClone(arcade.frame ?? {}),
      events: structuredClone(arcade.events ?? []),
      eventCursor: Number(arcade.eventCursor ?? 0),
      countdownEndsAtMs: arcade.countdownEndsAt ?? undefined,
      startedAtMs: arcade.startedAt ?? undefined,
      deadlineAtMs: arcade.deadlineAt ?? undefined,
      outcome: structuredClone(arcade.outcome ?? null),
    };
  }
  if (rawInvite.templateId === 'custom') {
    const series = requireExclusiveSeries(rawInvite.seriesId);
    const progress = rawInvite.progress ?? {};
    const roundIndex = Number.isInteger(progress.roundIndex) ? progress.roundIndex : 0;
    const question = game.questions[roundIndex] ?? null;
    const roleForId = (participantId) => roles.get(participantId) ?? null;
    const publicResult = (result) => {
      const resultQuestion = game.questions[result.roundIndex] ?? game.questions.find((item) => item.id === result.questionId);
      return {
        roundIndex: result.roundIndex,
        questionId: result.questionId,
        answer: result.answer,
        guess: result.guess,
        protagonistId: roleForId(result.answererId),
        guesserId: roleForId(result.guesserId),
        matched: result.answer === result.guess,
        followUp: result.answer === result.guess
          ? resultQuestion?.matchedFollowUp
          : resultQuestion?.differentFollowUp,
        revealedAt: result.revealedAt,
      };
    };
    const rawResults = Array.isArray(rawInvite.shared?.exclusive?.revealedRounds)
      ? rawInvite.shared.exclusive.revealedRounds
      : [];
    const results = rawResults.map(publicResult);
    const revealedRound = question
      ? results.find((result) => result.questionId === question.id) ?? null
      : results.at(-1) ?? null;
    const protagonistId = roleForId(progress.answererId);
    const guesserId = roleForId(progress.guesserId);
    const selfRole = protagonistId === 'a' ? 'answerer' : guesserId === 'a' ? 'guesser' : 'spectator';
    const selfSelection = question && selfRole === 'answerer'
      ? rawInvite.privateState?.answers?.[question.id]
      : question && selfRole === 'guesser'
        ? rawInvite.privateState?.guesses?.[question.id]
        : undefined;
    const completed = rawInvite.internalStatus === 'revealed' || rawInvite.status === 'completed';
    const joined = rawInvite.joinedParticipantIds.length >= 2;
    const phase = completed
      ? 'completed'
      : !joined
        ? 'waiting-peer'
        : revealedRound
          ? 'revealed'
          : selfRole === 'answerer'
            ? progress.answerSubmitted ? 'waiting-guess' : 'answering'
            : progress.answerSubmitted ? 'guessing' : 'waiting-answer';
    return {
      ...base,
      ...(game.engine ? {
        engine: game.engine,
        presentation: structuredClone(game.presentation),
        ending: structuredClone(game.ending),
      } : {}),
      seriesId: series.seriesId,
      series: {
        seriesId: series.seriesId,
        templateKey: series.templateKey,
        title: series.title,
        shortTitle: series.shortTitle,
        icon: series.icon,
        tone: series.tone,
        eyebrow: series.eyebrow,
        description: series.description,
        duration: series.duration,
        tags: [...series.tags],
        matchedEyebrow: series.matchedEyebrow,
        matchedTitle: series.matchedTitle,
        differentEyebrow: series.differentEyebrow,
        differentTitle: series.differentTitle,
        resultUnit: series.resultUnit,
      },
      phase,
      roundIndex,
      totalRounds: game.questions.length,
      protagonistId,
      guesserId,
      question: question ? {
        id: question.id,
        label: question.label,
        source: question.source,
        prompt: question.prompt,
        options: question.options,
        ...(question.interaction ? { interaction: structuredClone(question.interaction) } : {}),
      } : null,
      questions: game.questions.map((item) => ({
        id: item.id,
        label: item.label,
        source: item.source,
        prompt: item.prompt,
        options: item.options,
        matchedFollowUp: item.matchedFollowUp,
        differentFollowUp: item.differentFollowUp,
        ...(item.interaction ? { interaction: structuredClone(item.interaction) } : {}),
      })),
      self: {
        participantId: 'a',
        role: selfRole,
        submitted: Number.isInteger(selfSelection),
        ...(Number.isInteger(selfSelection) ? { selection: selfSelection } : {}),
      },
      peer: {
        participantId: 'b',
        role: selfRole === 'answerer' ? 'guesser' : selfRole === 'guesser' ? 'answerer' : 'spectator',
        submitted: selfRole === 'answerer' ? Boolean(progress.guessSubmitted) : Boolean(progress.answerSubmitted),
      },
      revealedRound,
      results,
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
  const series = rawInvite.seriesId ? exclusiveSeriesForId(rawInvite.seriesId) : null;
  const revision = rawInvite.templateId === 'custom' && Number.isSafeInteger(rawInvite.revision)
    ? rawInvite.revision
    : state.revision;
  return {
    inviteId: rawInvite.id,
    creatorId: rawInvite.creatorId,
    templateId: rawInvite.templateId,
    seriesId: rawInvite.seriesId ?? null,
    ...(series ? {
      series: {
        seriesId: series.seriesId,
        templateKey: series.templateKey,
        title: series.title,
        shortTitle: series.shortTitle,
        icon: series.icon,
        tone: series.tone,
      },
    } : {}),
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
      version: revision,
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

function invitationRequestFingerprint(body, normalizedPrompt) {
  return createHash('sha256')
    .update(JSON.stringify([
      body.templateId,
      body.seriesId ?? null,
      normalizedPrompt,
      body.previewToken ?? null,
    ]))
    .digest('base64url');
}

function promptFingerprint(prompt) {
  return createHash('sha256').update(prompt).digest('base64url');
}

function roomContextRevision(rawState) {
  if (rawState?.status !== 'matched' || !rawState.room) {
    throw new CarnivalError('NOT_MATCHED', 'Participant is not in a carnival room', 409);
  }
  const messages = Array.isArray(rawState.room.messages) ? rawState.room.messages : [];
  return createHash('sha256')
    .update(rawState.room.id)
    .update('\0')
    .update(JSON.stringify(messages.map((message) => [
      message.id,
      message.senderId,
      message.content,
      message.createdAt,
    ])))
    .digest('base64url');
}

export function createCarnivalHttpHandler({
  publicOrigin = process.env.PUBLIC_ORIGIN ?? '',
  trustProxy = process.env.TRUST_PROXY === '1',
  service = createCarnivalService(),
  configStore = createConfigStore(),
  aiService = createAiGameService(),
  aiGate,
  now = Date.now,
  previewTokenFactory = () => randomBytes(32).toString('base64url'),
} = {}) {
  const knownPaths = new Set([
    '/api/carnival/join',
    '/api/carnival/state',
    '/api/carnival/messages',
    '/api/carnival/prompt',
    '/api/carnival/game-preview',
    '/api/carnival/invites',
    '/api/carnival/games/action',
    '/api/carnival/session',
  ]);
  const takeJoinRate = createRateLimiter(20, 10 * 60_000);
  const takeMessageRate = createRateLimiter(90, 60_000);
  const takeInviteRate = createRateLimiter(8, 10 * 60_000);
  const takePreviewRate = createRateLimiter(8, 10 * 60_000);
  const takeActionRate = createRateLimiter(180, 10 * 60_000);
  const takeArcadeActionRate = createRateLimiter(6_000, 10 * 60_000);
  const capacityGate = aiGate ?? createAiCapacityGate();
  const inFlightInvites = new Map();
  const gamePreviews = new Map();
  const previewArtifacts = new Map();

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

  function currentTimestamp() {
    const value = Number(now());
    if (!Number.isFinite(value)) throw new TypeError('Carnival HTTP clock must return a finite timestamp');
    return value;
  }

  function pruneGamePreviews(timestamp = currentTimestamp()) {
    for (const [previewToken, preview] of gamePreviews) {
      if (preview.expiresAt <= timestamp) {
        gamePreviews.delete(previewToken);
        if (preview.artifactId) previewArtifacts.delete(preview.artifactId);
      }
    }
    while (gamePreviews.size >= MAX_GAME_PREVIEWS) {
      const oldest = gamePreviews.keys().next().value;
      if (!oldest) break;
      const evicted = gamePreviews.get(oldest);
      gamePreviews.delete(oldest);
      if (evicted?.artifactId) previewArtifacts.delete(evicted.artifactId);
    }
  }

  async function runtimeArtifact(artifactId) {
    pruneGamePreviews();
    const previewArtifact = previewArtifacts.get(artifactId);
    if (previewArtifact) {
      return {
        artifactId,
        codeHash: previewArtifact.codeHash,
        document: previewArtifact.document,
      };
    }
    return service.getArcadeArtifact(artifactId);
  }

  function allocatePreviewToken() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const previewToken = previewTokenFactory();
      if (typeof previewToken !== 'string' || !GAME_PREVIEW_TOKEN_PATTERN.test(previewToken)) {
        throw new TypeError('previewTokenFactory must return a 20 to 120 character base64url token');
      }
      if (!gamePreviews.has(previewToken)) return previewToken;
    }
    throw new Error('Unable to allocate a unique game preview token');
  }

  async function prepareGameRequest(token, body, normalizedPrompt) {
    const rawState = await service.getState(token);
    if (!rawState.canInvite) {
      throw new CarnivalError('INVITE_LOCKED', 'Ten text messages are required before inviting a game', 409);
    }
    const { config, gameTypes } = await gameTypesAndConfig();
    const selected = config
      ? configuredGameType(config.gameTypes, body.templateId)
      : DEFAULT_GAME_TYPES.find((item) => item.id === body.templateId);
    const publicType = gameTypes.find((item) => item.id === body.templateId);
    if (!selected || !publicType?.enabled) {
      throw new CarnivalError('GAME_TEMPLATE_NOT_ENABLED', 'Game template is not enabled', 400);
    }
    if (!templateForId(selected.id)?.available) {
      throw new CarnivalError('GAME_TEMPLATE_UNAVAILABLE', 'This game template is not available yet', 409);
    }
    const series = selected.id === 'custom' ? exclusiveSeriesForId(body.seriesId) : null;
    if (selected.id === 'custom' && !series) {
      throw new CarnivalError('INVALID_GAME_SERIES', 'Unsupported exclusive game series', 400);
    }
    if (selected.id !== 'custom' && body.seriesId !== undefined) {
      throw new CarnivalError('INVALID_GAME_SERIES', 'seriesId is only valid for the custom template', 400);
    }
    return {
      rawState,
      config,
      gameTypes,
      selected,
      series,
      prompt: normalizedPrompt,
      match: carnivalMatchFromState(rawState),
    };
  }

  function assertPreviewGameMatchesSelection(game, prepared) {
    if (prepared.series?.seriesId === 'prompt-arcade') {
      assertArcadeGameDefinition(game, { hasUnsafeText: hasUnsafeGameText });
      if (
        game.templateId !== prepared.selected.id ||
        game.seriesId !== prepared.series.seriesId
      ) {
        throw new Error('Arcade game does not match the selected prompt-arcade series');
      }
      return;
    }
    assertPromptGameDefinition(game, { hasUnsafeText: hasUnsafeGameText });
    if (
      game.templateId !== prepared.selected.id ||
      game.seriesId !== prepared.series?.seriesId ||
      game.mechanics?.seriesId !== prepared.series?.seriesId ||
      game.mechanics?.templateKey !== prepared.series?.templateKey
    ) {
      throw new Error('Prompt game mechanics do not match the selected series');
    }
  }

  async function generateGame(prepared, { requirePromptGame = false } = {}) {
    const { config, match, prompt, selected, series } = prepared;
    let game = buildCarnivalFallbackGame(match, selected.id, selected.label, {
      seriesId: series?.seriesId,
      prompt,
    });
    if (config?.apiKey) {
      const slot = capacityGate.acquire();
      if (slot.allowed) {
        try {
          const candidate = await aiService.generate(config, match, {
            templateId: selected.id,
            gameLabel: selected.label,
            prompt,
            seriesId: series?.seriesId,
          });
          if (requirePromptGame) {
            assertPreviewGameMatchesSelection(candidate, prepared);
          }
          game = candidate;
        } catch {
          // Keep the safe local game when the provider or its generated schema fails.
        } finally {
          slot.release();
        }
      }
    }
    if (requirePromptGame) {
      try {
        assertPreviewGameMatchesSelection(game, prepared);
      } catch {
        throw new CarnivalError('GAME_PREVIEW_UNAVAILABLE', 'A safe prompt game could not be generated', 503);
      }
    }
    return game;
  }

  async function createGamePreview(token, body) {
    if (body.templateId !== 'custom') {
      throw new CarnivalError('GAME_PREVIEW_UNSUPPORTED', 'Game preview is only available for custom games', 400);
    }
    const prompt = normalizePlayerPrompt(body.prompt);
    const prepared = await prepareGameRequest(token, body, prompt);
    const roomIdAtStart = prepared.rawState.room.id;
    const roomRevisionAtStart = roomContextRevision(prepared.rawState);
    const game = await generateGame(prepared, { requirePromptGame: true });
    const latestState = await service.getState(token);
    if (
      latestState?.status !== 'matched' ||
      latestState.room?.id !== roomIdAtStart ||
      roomContextRevision(latestState) !== roomRevisionAtStart
    ) {
      throw new CarnivalError(
        'GAME_PREVIEW_STALE',
        'The room chat changed while this preview was being generated',
        409,
      );
    }
    const timestamp = currentTimestamp();
    pruneGamePreviews(timestamp);
    const previewToken = allocatePreviewToken();
    const expiresAt = timestamp + GAME_PREVIEW_TTL_MS;
    gamePreviews.set(previewToken, {
      ownerTokenHash: tokenKey(token),
      roomId: roomIdAtStart,
      roomRevision: roomRevisionAtStart,
      seriesId: prepared.series.seriesId,
      promptHash: promptFingerprint(prompt),
      game: structuredClone(game),
      expiresAt,
      consumedBy: null,
      artifactId: game.artifact?.artifactId ?? null,
    });
    if (game.artifact?.artifactId && game.artifact?.document) {
      previewArtifacts.set(game.artifact.artifactId, {
        codeHash: game.artifact.codeHash,
        document: game.artifact.document,
        expiresAt,
      });
    }
    return {
      previewToken,
      expiresAt: new Date(expiresAt).toISOString(),
      game: publicGeneratedGame(game),
    };
  }

  function gameForPreview(token, previewToken, prepared, idempotencyKey) {
    if (typeof previewToken !== 'string' || !GAME_PREVIEW_TOKEN_PATTERN.test(previewToken)) {
      throw new CarnivalError('INVALID_GAME_PREVIEW', 'A valid previewToken is required', 400);
    }
    const timestamp = currentTimestamp();
    const preview = gamePreviews.get(previewToken);
    if (!preview || preview.expiresAt <= timestamp) {
      if (preview) gamePreviews.delete(previewToken);
      throw new CarnivalError('GAME_PREVIEW_EXPIRED', 'This game preview is missing or expired', 410);
    }
    if (
      preview.ownerTokenHash !== tokenKey(token) ||
      preview.roomId !== prepared.rawState.room.id
    ) {
      throw new CarnivalError('GAME_PREVIEW_FORBIDDEN', 'This game preview belongs to another participant', 403);
    }
    if (
      prepared.selected.id !== 'custom' ||
      preview.seriesId !== prepared.series?.seriesId ||
      preview.promptHash !== promptFingerprint(prepared.prompt)
    ) {
      throw new CarnivalError('GAME_PREVIEW_MISMATCH', 'The preview does not match this series and prompt', 409);
    }
    if (preview.roomRevision !== roomContextRevision(prepared.rawState)) {
      throw new CarnivalError('GAME_PREVIEW_STALE', 'The room chat changed after this preview was generated', 409);
    }
    const consumer = createHash('sha256').update(idempotencyKey).digest('base64url');
    if (preview.consumedBy && preview.consumedBy !== consumer) {
      throw new CarnivalError('GAME_PREVIEW_ALREADY_USED', 'This game preview has already been sent', 409);
    }
    preview.consumedBy = consumer;
    return structuredClone(preview.game);
  }

  async function createInvitation(token, body, idempotencyKey) {
    const normalizedPrompt = normalizePlayerPrompt(body.prompt);
    const previewVersionHash = body.previewToken === undefined ? null : tokenKey(body.previewToken);
    const requestFingerprint = invitationRequestFingerprint(body, normalizedPrompt);
    const key = `${tokenKey(token)}:${idempotencyKey}`;
    const existing = inFlightInvites.get(key);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new CarnivalError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for another invitation', 409);
      }
      return existing.promise;
    }
    const promise = (async () => {
      const replay = typeof service.getInviteByIdempotencyKey === 'function'
        ? await service.getInviteByIdempotencyKey(token, idempotencyKey, {
            templateId: body.templateId,
            seriesId: body.seriesId,
            prompt: normalizedPrompt,
            previewVersionHash,
          })
        : null;
      if (replay) {
        const { gameTypes } = await gameTypesAndConfig();
        return {
          invite: publicInvite(replay.invite, replay.state),
          state: publicState(replay.state, gameTypes),
        };
      }
      const prepared = await prepareGameRequest(token, body, normalizedPrompt);
      const game = body.previewToken !== undefined
        ? gameForPreview(token, body.previewToken, prepared, idempotencyKey)
        : await generateGame(prepared);
      const created = await service.createInvite(token, {
        templateId: prepared.selected.id,
        seriesId: prepared.series?.seriesId,
        prompt: prepared.prompt,
        game,
        idempotencyKey,
        previewVersionHash,
      });
      return {
        invite: publicInvite(created.invite, created.state),
        state: publicState(created.state, prepared.gameTypes),
      };
    })();
    inFlightInvites.set(key, { requestFingerprint, promise });
    promise.finally(() => {
      if (inFlightInvites.get(key)?.promise === promise) inFlightInvites.delete(key);
    }).catch(() => {});
    return promise;
  }

  return async function handleCarnival(request, response) {
    const path = pathFor(request);
    const runtimeMatch = path.match(/^\/api\/carnival\/games\/runtime\/(artifact_[A-Za-z0-9_-]{32,80})$/);
    if (!knownPaths.has(path) && !runtimeMatch) return false;
    const requestId = randomUUID();
    try {
      if (runtimeMatch) {
        if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
          methodNotAllowed(response, requestId, 'GET, HEAD');
        } else {
          sendArcadeDocument(
            response,
            request,
            await runtimeArtifact(runtimeMatch[1]),
            requestId,
          );
        }
        return true;
      }
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
          const series = selected.id === 'custom' ? exclusiveSeriesForId(body.seriesId) : null;
          if (selected.id === 'custom' && !series) {
            throw new CarnivalError('INVALID_GAME_SERIES', 'Unsupported exclusive game series', 400);
          }
          if (selected.id !== 'custom' && body.seriesId !== undefined) {
            throw new CarnivalError('INVALID_GAME_SERIES', 'seriesId is only valid for the custom template', 400);
          }
          const preview = buildPromptPreview(carnivalMatchFromState(rawState), selected, { seriesId: series?.seriesId });
          sendJson(response, 200, {
            templateId: selected.id,
            seriesId: series?.seriesId ?? null,
            label: selected.label,
            description: publicType.description,
            prompt: preview,
            maxLength: 1_500,
          }, requestId);
        }
      } else if (path === '/api/carnival/game-preview') {
        if (request.method !== 'POST') methodNotAllowed(response, requestId, 'POST');
        else if (requireMutation(request, response, requestId)) {
          const rate = takePreviewRate(tokenKey(token));
          if (!rate.allowed) {
            sendJson(response, 429, {
              error: 'Too many game preview requests',
              code: 'RATE_LIMITED',
              request_id: requestId,
            }, requestId, { 'Retry-After': String(rate.retryAfter) });
          } else {
            const body = await readJson(request, 8_000);
            if (
              !isRecord(body) ||
              body.templateId !== 'custom' ||
              typeof body.seriesId !== 'string' ||
              typeof body.prompt !== 'string'
            ) {
              throw new CarnivalError('INVALID_INPUT', 'Invalid carnival game preview request', 400);
            }
            sendJson(response, 201, await createGamePreview(token, body), requestId);
          }
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
            if (!isRecord(body) || typeof body.templateId !== 'string' || typeof body.prompt !== 'string' ||
              (body.seriesId !== undefined && typeof body.seriesId !== 'string') ||
              (body.previewToken !== undefined && typeof body.previewToken !== 'string')) {
              throw new CarnivalError('INVALID_INPUT', 'Invalid carnival invitation', 400);
            }
            sendJson(response, 201, await createInvitation(token, body, key), requestId);
          }
        }
      } else if (path === '/api/carnival/games/action') {
        if (request.method !== 'POST') methodNotAllowed(response, requestId, 'POST');
        else if (requireMutation(request, response, requestId)) {
          const body = await readJson(request, 8_000);
          if (!isRecord(body) || typeof body.inviteId !== 'string' || typeof body.action !== 'string') {
            throw new CarnivalError('INVALID_ACTION', 'Invalid carnival game action', 400);
          }
          const arcadeAction = body.action.startsWith('arcade.');
          const rate = (arcadeAction ? takeArcadeActionRate : takeActionRate)(tokenKey(token));
          if (!rate.allowed) sendJson(response, 429, { error: 'Too many game actions', code: 'RATE_LIMITED', request_id: requestId }, requestId, { 'Retry-After': String(rate.retryAfter) });
          else {
            const payload = isRecord(body.payload) ? body.payload : {};
            let result;
            if (body.action === 'join') result = await service.joinInvite(token, body.inviteId);
            else if (body.action === 'profile-riddle.submit') result = await service.gameAction(token, body.inviteId, { type: 'profile-submit', keywords: payload.keywords, sentence: payload.sentence });
            else if (body.action === 'keyword-wheel.spin') result = await service.gameAction(token, body.inviteId, { type: 'wheel-spin' });
            else if (body.action === 'keyword-wheel.next-follow-up' || body.action.endsWith('.confirm-reveal')) result = await service.getInvite(token, body.inviteId);
            else if (body.action === 'rapid-choice.answer') result = await service.gameAction(token, body.inviteId, { type: 'rapid-answer', questionId: payload.questionId, answer: payload.answer });
            else if (body.action === 'rapid-choice.timeout') result = await service.gameAction(token, body.inviteId, { type: 'rapid-answer', questionId: payload.questionId, answer: 'timeout' });
            else if (body.action === 'exclusive.answer') result = await service.gameAction(token, body.inviteId, {
              type: 'exclusive-answer',
              questionId: payload.questionId,
              answer: payload.answer,
              requestId: payload.requestId,
              expectedRevision: payload.expectedRevision,
            });
            else if (body.action === 'exclusive.guess') result = await service.gameAction(token, body.inviteId, {
              type: 'exclusive-guess',
              questionId: payload.questionId,
              guess: payload.guess,
              requestId: payload.requestId,
              expectedRevision: payload.expectedRevision,
            });
            else if (body.action === 'exclusive.next') result = await service.gameAction(token, body.inviteId, {
              type: 'exclusive-next',
              questionId: payload.questionId,
              requestId: payload.requestId,
              expectedRevision: payload.expectedRevision,
            });
            else if (body.action === 'arcade.ready') result = await service.gameAction(token, body.inviteId, {
              type: 'arcade-ready',
              seq: payload.seq,
              requestId: payload.requestId,
            });
            else if (body.action === 'arcade.input') result = await service.gameAction(token, body.inviteId, {
              type: 'arcade-input',
              seq: payload.seq,
              control: payload.control,
              value: payload.value,
              requestId: payload.requestId,
            });
            else if (body.action === 'arcade.tick') result = await service.gameAction(token, body.inviteId, {
              type: 'arcade-tick',
              seq: payload.seq,
              requestId: payload.requestId,
            });
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
