import { randomUUID } from 'node:crypto';
import { clearSessionCookie, createAdminSessions, sessionCookie, verifyAdminPassword } from './admin-auth.mjs';
import { compactMatchForAi, createAiGameService } from './ai-game.mjs';
import { createConfigStore, publicConfig } from './config-store.mjs';

export const DEFAULT_UPSTREAM_URL =
  'https://intellimatch.cn/api/v7/hackathon/match?format=json';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value) {
  return (
    Array.isArray(value) &&
    value.length <= 200 &&
    value.every((item) => typeof item === 'string' && item.length <= 10_000)
  );
}

function isMatchUser(value) {
  return (
    isRecord(value) &&
    typeof value.nickname === 'string' &&
    value.nickname.length <= 100 &&
    typeof value.gender === 'string' &&
    value.gender.length <= 40 &&
    typeof value.profile === 'string' &&
    value.profile.length <= 100_000 &&
    isStringArray(value.memories_self) &&
    isStringArray(value.memories_ideal)
  );
}

export function isMatchPayload(value) {
  return (
    isRecord(value) &&
    typeof value.match_id === 'string' &&
    value.match_id.length <= 200 &&
    typeof value.match_status === 'string' &&
    value.match_status.length <= 100 &&
    typeof value.message_count === 'number' &&
    Number.isFinite(value.message_count) &&
    isMatchUser(value.user_a) &&
    isMatchUser(value.user_b) &&
    Array.isArray(value.messages) &&
    value.messages.length <= 5_000 &&
    value.messages.every(
      (message) =>
        isRecord(message) &&
        (message.from === 'a' || message.from === 'b') &&
        typeof message.type === 'string' &&
        message.type.length <= 40 &&
        typeof message.content === 'string' &&
        message.content.length <= 20_000 &&
        typeof message.sent_at === 'string' &&
        message.sent_at.length <= 100,
    )
  );
}

function setCommonHeaders(response, requestId) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-Request-Id', requestId);
}

function sendJson(response, statusCode, payload, requestId, extraHeaders = {}) {
  setCommonHeaders(response, requestId);
  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);
  response.statusCode = statusCode;
  response.end(JSON.stringify(payload));
}

function requestPath(request) {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function clientAddress(request, trustProxy) {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  }
  return request.socket?.remoteAddress ?? 'unknown';
}

function createRateLimiter(limit, windowMs) {
  const buckets = new Map();
  return (key, now = Date.now()) => {
    if (buckets.size > 1_000) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    if (!buckets.has(key) && buckets.size >= 5_000) key = '__overflow__';
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= limit,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    };
  };
}

function rateHeaders(rate) {
  return {
    'RateLimit-Limit': String(rate.limit),
    'RateLimit-Remaining': String(rate.remaining),
  };
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

async function readJsonBody(request, maxBytes) {
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw Object.assign(new Error('Request body is too large'), { status: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON'), { status: 400 });
  }
}

async function readResponseText(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > maxBytes) throw Object.assign(new Error('Upstream response is too large'), { code: 'TOO_LARGE' });
  if (!response.body) return '';
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) {
      await response.body.cancel().catch(() => {});
      throw Object.assign(new Error('Upstream response is too large'), { code: 'TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function methodNotAllowed(response, requestId, allow) {
  sendJson(response, 405, { error: 'Method not allowed', request_id: requestId }, requestId, { Allow: allow });
}

function requireAdmin(request, response, requestId, sessions, { csrf = false } = {}) {
  const session = sessions.get(request);
  if (!session) {
    sendJson(response, 401, { error: 'Administrator authentication required', request_id: requestId }, requestId);
    return null;
  }
  if (csrf && !sessions.requireCsrf(request, session)) {
    sendJson(response, 403, { error: 'Invalid CSRF token', request_id: requestId }, requestId);
    return null;
  }
  return session;
}

function pruneCache(cache, now = Date.now()) {
  if (cache.size < 100) return;
  for (const [key, value] of cache) if (value.expiresAt <= now) cache.delete(key);
}

export function createApiHandler({
  token = process.env.LIANGPEI_TOKEN ?? '',
  upstreamUrl = process.env.LIANGPEI_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL,
  timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 10_000),
  rateLimit = Number(process.env.MATCH_RATE_LIMIT_PER_MINUTE ?? 24),
  maxResponseBytes = Number(process.env.UPSTREAM_MAX_RESPONSE_BYTES ?? 2_000_000),
  trustProxy = process.env.TRUST_PROXY === '1',
  publicOrigin = process.env.PUBLIC_ORIGIN ?? '',
  adminPasswordHash = process.env.ADMIN_PASSWORD_HASH ?? '',
  aiRateLimit = Number(process.env.AI_RATE_LIMIT_PER_10_MINUTES ?? 8),
  aiHourlyLimit = Number(process.env.AI_GENERATION_PER_HOUR ?? 20),
  aiFreshLimit = Number(process.env.AI_FRESH_PER_CONTEXT ?? 2),
  aiMaxConcurrency = Number(process.env.AI_MAX_CONCURRENCY ?? 2),
  fetchImpl = globalThis.fetch,
  configStore = createConfigStore(),
  sessions = createAdminSessions(),
  aiService = createAiGameService({ fetchImpl }),
} = {}) {
  const safeRateLimit = Number.isFinite(rateLimit) ? Math.max(1, rateLimit) : 24;
  const safeTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(1_000, timeoutMs) : 10_000;
  const safeMaxResponseBytes = Number.isFinite(maxResponseBytes) ? Math.max(100_000, maxResponseBytes) : 2_000_000;
  const takeMatchRate = createRateLimiter(safeRateLimit, 60_000);
  const takeLoginRate = createRateLimiter(5, 15 * 60_000);
  const takeGlobalLoginRate = createRateLimiter(40, 15 * 60_000);
  const takeAiRate = createRateLimiter(Number.isFinite(aiRateLimit) ? Math.max(1, aiRateLimit) : 8, 10 * 60_000);
  const takeGlobalAiRate = createRateLimiter(Number.isFinite(aiHourlyLimit) ? Math.max(1, aiHourlyLimit) : 20, 60 * 60_000);
  const maxConcurrency = Number.isFinite(aiMaxConcurrency) ? Math.max(1, aiMaxConcurrency) : 2;
  const maxFreshGenerations = Number.isFinite(aiFreshLimit) ? Math.max(0, aiFreshLimit) : 2;
  const gameCache = new Map();
  const inFlight = new Map();
  const matchContexts = new Map();
  let activeGenerations = 0;
  let activeLogins = 0;

  function storeMatchContext(match) {
    const now = Date.now();
    for (const [id, context] of matchContexts) {
      if (context.expiresAt <= now) matchContexts.delete(id);
    }
    while (matchContexts.size >= 100) matchContexts.delete(matchContexts.keys().next().value);
    const id = randomUUID();
    matchContexts.set(id, {
      match: compactMatchForAi(match),
      expiresAt: now + 15 * 60_000,
      freshGenerations: 0,
    });
    return id;
  }

  function getMatchContext(id) {
    const context = matchContexts.get(id);
    if (!context || context.expiresAt <= Date.now()) {
      matchContexts.delete(id);
      return null;
    }
    return context;
  }

  async function handleMatch(request, response, requestId) {
    if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      methodNotAllowed(response, requestId, 'GET, HEAD');
      return;
    }
    const rate = takeMatchRate(clientAddress(request, trustProxy));
    const headers = rateHeaders(rate);
    if (!rate.allowed) {
      sendJson(response, 429, { error: 'Too many match requests', request_id: requestId }, requestId, {
        ...headers,
        'Retry-After': String(rate.retryAfterSeconds),
      });
      return;
    }
    if (!token) {
      sendJson(response, 503, { error: 'Match service is not configured', request_id: requestId }, requestId, headers);
      return;
    }
    try {
      const upstream = await fetchImpl(upstreamUrl, {
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'liangpei-hackathon/1.0',
          'X-Token': token,
        },
        signal: AbortSignal.timeout(safeTimeoutMs),
      });
      if (!upstream.ok) {
        sendJson(response, 502, { error: 'Upstream match service rejected the request', request_id: requestId }, requestId, headers);
        return;
      }
      const raw = await readResponseText(upstream, safeMaxResponseBytes);
      const payload = JSON.parse(raw);
      if (!isMatchPayload(payload)) {
        sendJson(response, 502, { error: 'Upstream returned an unexpected payload', request_id: requestId }, requestId, headers);
        return;
      }
      sendJson(response, 200, payload, requestId, {
        ...headers,
        'X-Data-Source': 'intellimatch',
        'X-Game-Context-Id': storeMatchContext(payload),
      });
    } catch (error) {
      const timedOut = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      sendJson(
        response,
        timedOut ? 504 : 502,
        { error: timedOut ? 'Upstream match service timed out' : 'Upstream match service is unavailable', request_id: requestId },
        requestId,
        headers,
      );
    }
  }

  async function handleGenerate(request, response, requestId) {
    if (request.method !== 'POST') {
      methodNotAllowed(response, requestId, 'POST');
      return;
    }
    if (!sameOrigin(request, publicOrigin) || !hasJsonContentType(request)) {
      sendJson(response, 403, { error: 'Same-origin JSON request required', request_id: requestId }, requestId);
      return;
    }
    const perClient = takeAiRate(clientAddress(request, trustProxy));
    if (!perClient.allowed) {
      sendJson(response, 429, { error: 'Too many AI game requests', request_id: requestId }, requestId, {
        ...rateHeaders(perClient),
        'Retry-After': String(perClient.retryAfterSeconds),
      });
      return;
    }
    let body;
    try {
      body = await readJsonBody(request, 2_000);
    } catch (error) {
      sendJson(response, error.status ?? 400, { error: error.message, request_id: requestId }, requestId);
      return;
    }
    if (
      !isRecord(body) ||
      typeof body.contextId !== 'string' ||
      body.contextId.length > 100 ||
      (body.fresh !== undefined && typeof body.fresh !== 'boolean')
    ) {
      sendJson(response, 400, { error: 'Invalid game generation request', request_id: requestId }, requestId);
      return;
    }
    const context = getMatchContext(body.contextId);
    if (!context) {
      sendJson(response, 410, { error: 'Match context expired; load a new case', code: 'MATCH_CONTEXT_EXPIRED', request_id: requestId }, requestId);
      return;
    }
    const { match } = context;
    let config;
    try {
      config = await configStore.get();
    } catch {
      sendJson(response, 503, { error: 'AI configuration is unavailable', code: 'AI_CONFIG_UNAVAILABLE', request_id: requestId }, requestId);
      return;
    }
    if (!config.apiKey) {
      sendJson(response, 503, { error: 'AI game service is not configured', code: 'AI_NOT_CONFIGURED', request_id: requestId }, requestId);
      return;
    }
    pruneCache(gameCache);
    const key = aiService.cacheKey(config, match);
    const cached = gameCache.get(key);
    if (!body.fresh && cached?.expiresAt > Date.now()) {
      sendJson(response, 200, { game: cached.game, cached: true }, requestId);
      return;
    }
    let promise = inFlight.get(key);
    if (!promise) {
      if (body.fresh && context.freshGenerations >= maxFreshGenerations) {
        sendJson(response, 429, {
          error: 'Fresh game limit reached for this match context',
          code: 'AI_REFRESH_LIMIT',
          request_id: requestId,
        }, requestId);
        return;
      }
      if (activeGenerations >= maxConcurrency) {
        sendJson(response, 503, { error: 'AI game service is busy, please try again shortly', code: 'AI_BUSY', request_id: requestId }, requestId, {
          'Retry-After': '3',
        });
        return;
      }
      const globalRate = takeGlobalAiRate('global');
      if (!globalRate.allowed) {
        sendJson(response, 503, { error: 'AI game service is busy, please try again shortly', code: 'AI_BUSY', request_id: requestId }, requestId, {
          'Retry-After': String(globalRate.retryAfterSeconds),
        });
        return;
      }
      if (body.fresh) context.freshGenerations += 1;
      activeGenerations += 1;
      promise = aiService.generate(config, match);
      inFlight.set(key, promise);
      promise.finally(() => {
        activeGenerations -= 1;
        if (inFlight.get(key) === promise) inFlight.delete(key);
      }).catch(() => {});
    }
    try {
      const game = await promise;
      gameCache.set(key, { game, expiresAt: Date.now() + 15 * 60_000 });
      sendJson(response, 200, { game, cached: false }, requestId);
    } catch (error) {
      const timedOut = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      const status = error?.status;
      const code = timedOut
        ? 'AI_TIMEOUT'
        : status === 401 || status === 403
          ? 'AI_AUTH_FAILED'
          : status === 429
            ? 'AI_RATE_LIMITED'
            : 'AI_GENERATION_FAILED';
      sendJson(
        response,
        timedOut ? 504 : status === 429 ? 503 : 502,
        { error: timedOut ? 'AI game generation timed out' : 'Unable to generate a valid AI game', code, request_id: requestId },
        requestId,
      );
    }
  }

  async function handleAdminSession(request, response, requestId) {
    if (request.method === 'GET') {
      const session = sessions.get(request);
      sendJson(response, 200, session ? { authenticated: true, csrfToken: session.csrfToken } : { authenticated: false }, requestId);
      return;
    }
    if (!sameOrigin(request, publicOrigin) || !hasJsonContentType(request)) {
      sendJson(response, 403, { error: 'Same-origin JSON request required', request_id: requestId }, requestId);
      return;
    }
    if (request.method === 'POST') {
      const rate = takeLoginRate(clientAddress(request, trustProxy));
      const globalRate = takeGlobalLoginRate('global');
      if (!rate.allowed || !globalRate.allowed || activeLogins >= 2) {
        sendJson(response, 429, { error: 'Too many login attempts', request_id: requestId }, requestId, { 'Retry-After': String(rate.retryAfterSeconds) });
        return;
      }
      let body;
      try {
        body = await readJsonBody(request, 2_000);
      } catch (error) {
        sendJson(response, error.status ?? 400, { error: error.message, request_id: requestId }, requestId);
        return;
      }
      if (!adminPasswordHash) {
        sendJson(response, 503, { error: 'Administrator login is not configured', request_id: requestId }, requestId);
        return;
      }
      let passwordValid = false;
      if (isRecord(body)) {
        activeLogins += 1;
        try {
          passwordValid = await verifyAdminPassword(body.password, adminPasswordHash);
        } finally {
          activeLogins -= 1;
        }
      }
      if (!passwordValid) {
        sendJson(response, 401, { error: 'Invalid administrator credentials', request_id: requestId }, requestId);
        return;
      }
      const session = sessions.create();
      sendJson(response, 200, { authenticated: true, csrfToken: session.csrfToken }, requestId, { 'Set-Cookie': sessionCookie(session.token) });
      return;
    }
    if (request.method === 'DELETE') {
      const session = requireAdmin(request, response, requestId, sessions, { csrf: true });
      if (!session) return;
      sessions.destroy(request);
      sendJson(response, 200, { authenticated: false }, requestId, { 'Set-Cookie': clearSessionCookie() });
      return;
    }
    methodNotAllowed(response, requestId, 'GET, POST, DELETE');
  }

  async function handleAdminConfig(request, response, requestId) {
    const session = requireAdmin(request, response, requestId, sessions, { csrf: request.method !== 'GET' });
    if (!session) return;
    if (request.method === 'GET') {
      try {
        sendJson(response, 200, publicConfig(await configStore.get()), requestId);
      } catch {
        sendJson(response, 503, { error: 'AI configuration is unavailable', request_id: requestId }, requestId);
      }
      return;
    }
    if (request.method !== 'PUT') {
      methodNotAllowed(response, requestId, 'GET, PUT');
      return;
    }
    if (!sameOrigin(request, publicOrigin) || !hasJsonContentType(request)) {
      sendJson(response, 403, { error: 'Same-origin JSON request required', request_id: requestId }, requestId);
      return;
    }
    try {
      const body = await readJsonBody(request, 25_000);
      const config = await configStore.update(body);
      gameCache.clear();
      sendJson(response, 200, publicConfig(config), requestId);
    } catch (error) {
      const message = error.message === 'AI configuration encryption key is missing or invalid' ? 'Server encryption is not configured' : error.message;
      sendJson(response, error.status ?? 400, { error: message, request_id: requestId }, requestId);
    }
  }

  async function handleAdminModels(request, response, requestId) {
    if (request.method !== 'POST') {
      methodNotAllowed(response, requestId, 'POST');
      return;
    }
    const session = requireAdmin(request, response, requestId, sessions, { csrf: true });
    if (!session) return;
    if (!sameOrigin(request, publicOrigin) || !hasJsonContentType(request)) {
      sendJson(response, 403, { error: 'Same-origin JSON request required', request_id: requestId }, requestId);
      return;
    }
    try {
      const models = await aiService.listModels(await configStore.get());
      sendJson(response, 200, { models }, requestId);
    } catch (error) {
      const status = error?.status;
      const code = status === 401 || status === 403 ? 'AI_AUTH_FAILED' : status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_UNAVAILABLE';
      sendJson(response, status === 429 ? 503 : 502, { error: 'Unable to load models from the AI provider', code, request_id: requestId }, requestId);
    }
  }

  return async function handleApiRequest(request, response) {
    const path = requestPath(request);
    const knownPaths = new Set([
      '/api/health',
      '/api/match',
      '/api/games/status',
      '/api/games/generate',
      '/api/admin/session',
      '/api/admin/config',
      '/api/admin/models',
    ]);
    if (!knownPaths.has(path)) return false;
    const requestId = randomUUID();

    if (path === '/api/health') {
      if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) methodNotAllowed(response, requestId, 'GET, HEAD');
      else {
        let aiConfigured = false;
        try {
          aiConfigured = Boolean((await configStore.get()).apiKey);
        } catch {}
        const ready = Boolean(token);
        sendJson(response, ready ? 200 : 503, {
          status: ready ? 'ok' : 'degraded',
          service: 'liangpei-hackathon-api',
          upstream_configured: ready,
          ai_configured: aiConfigured,
          admin_configured: Boolean(adminPasswordHash),
          request_id: requestId,
        }, requestId);
      }
      return true;
    }
    if (path === '/api/match') await handleMatch(request, response, requestId);
    else if (path === '/api/games/status') {
      if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) methodNotAllowed(response, requestId, 'GET, HEAD');
      else {
        try {
          const config = await configStore.get();
          sendJson(response, 200, { configured: Boolean(config.apiKey), model: config.apiKey ? config.model : null }, requestId);
        } catch {
          sendJson(response, 200, { configured: false, model: null }, requestId);
        }
      }
    } else if (path === '/api/games/generate') await handleGenerate(request, response, requestId);
    else if (path === '/api/admin/session') await handleAdminSession(request, response, requestId);
    else if (path === '/api/admin/config') await handleAdminConfig(request, response, requestId);
    else if (path === '/api/admin/models') await handleAdminModels(request, response, requestId);
    return true;
  };
}
