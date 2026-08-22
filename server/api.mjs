import { randomUUID } from 'node:crypto';

export const DEFAULT_UPSTREAM_URL =
  'https://intellimatch.cn/api/v7/hackathon/match?format=json';

const WINDOW_MS = 60_000;

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
    value.messages.length <= 2_000 &&
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
  for (const [name, value] of Object.entries(extraHeaders)) {
    response.setHeader(name, value);
  }
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
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
  }
  return request.socket?.remoteAddress ?? 'unknown';
}

function createRateLimiter(limit) {
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
      bucket = { count: 0, resetAt: now + WINDOW_MS };
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

export function createApiHandler({
  token = process.env.LIANGPEI_TOKEN ?? '',
  upstreamUrl = process.env.LIANGPEI_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL,
  timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 10_000),
  rateLimit = Number(process.env.MATCH_RATE_LIMIT_PER_MINUTE ?? 24),
  maxResponseBytes = Number(process.env.UPSTREAM_MAX_RESPONSE_BYTES ?? 2_000_000),
  trustProxy = process.env.TRUST_PROXY === '1',
  fetchImpl = globalThis.fetch,
} = {}) {
  const safeRateLimit = Number.isFinite(rateLimit) ? Math.max(1, rateLimit) : 24;
  const safeTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(1_000, timeoutMs) : 10_000;
  const safeMaxResponseBytes = Number.isFinite(maxResponseBytes)
    ? Math.max(100_000, maxResponseBytes)
    : 2_000_000;
  const takeRateLimit = createRateLimiter(safeRateLimit);

  return async function handleApiRequest(request, response) {
    const path = requestPath(request);
    if (path !== '/api/health' && path !== '/api/match') return false;

    const requestId = randomUUID();
    const method = request.method ?? 'GET';

    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(
        response,
        405,
        { error: 'Method not allowed', request_id: requestId },
        requestId,
        { Allow: 'GET, HEAD' },
      );
      return true;
    }

    if (path === '/api/health') {
      const ready = Boolean(token);
      sendJson(
        response,
        ready ? 200 : 503,
        {
          status: ready ? 'ok' : 'degraded',
          service: 'liangpei-hackathon-api',
          upstream_configured: ready,
          request_id: requestId,
        },
        requestId,
      );
      return true;
    }

    const rate = takeRateLimit(clientAddress(request, trustProxy));
    const rateHeaders = {
      'RateLimit-Limit': String(rate.limit),
      'RateLimit-Remaining': String(rate.remaining),
    };

    if (!rate.allowed) {
      sendJson(
        response,
        429,
        { error: 'Too many match requests', request_id: requestId },
        requestId,
        { ...rateHeaders, 'Retry-After': String(rate.retryAfterSeconds) },
      );
      return true;
    }

    if (!token) {
      sendJson(
        response,
        503,
        { error: 'Match service is not configured', request_id: requestId },
        requestId,
        rateHeaders,
      );
      return true;
    }

    try {
      const upstream = await fetchImpl(upstreamUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'liangpei-hackathon/1.0',
          'X-Token': token,
        },
        signal: AbortSignal.timeout(safeTimeoutMs),
      });

      if (!upstream.ok) {
        sendJson(
          response,
          502,
          { error: 'Upstream match service rejected the request', request_id: requestId },
          requestId,
          rateHeaders,
        );
        return true;
      }

      const contentLength = Number(upstream.headers.get('content-length') ?? 0);
      if (contentLength > safeMaxResponseBytes) {
        sendJson(
          response,
          502,
          { error: 'Upstream response is too large', request_id: requestId },
          requestId,
          rateHeaders,
        );
        return true;
      }

      const rawPayload = await upstream.text();
      if (Buffer.byteLength(rawPayload, 'utf8') > safeMaxResponseBytes) {
        sendJson(
          response,
          502,
          { error: 'Upstream response is too large', request_id: requestId },
          requestId,
          rateHeaders,
        );
        return true;
      }

      const payload = JSON.parse(rawPayload);
      if (!isMatchPayload(payload)) {
        sendJson(
          response,
          502,
          { error: 'Upstream returned an unexpected payload', request_id: requestId },
          requestId,
          rateHeaders,
        );
        return true;
      }

      sendJson(response, 200, payload, requestId, {
        ...rateHeaders,
        'X-Data-Source': 'intellimatch',
      });
      return true;
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      sendJson(
        response,
        timedOut ? 504 : 502,
        {
          error: timedOut ? 'Upstream match service timed out' : 'Upstream match service is unavailable',
          request_id: requestId,
        },
        requestId,
        rateHeaders,
      );
      return true;
    }
  };
}
