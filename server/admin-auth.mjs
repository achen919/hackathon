import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SESSION_IDLE_MS = 30 * 60_000;
const SESSION_ABSOLUTE_MS = 8 * 60 * 60_000;
const COOKIE_NAME = '__Host-hackathon_admin';

function digest(value) {
  return createHash('sha256').update(value).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function hashAdminPassword(password, salt = randomBytes(16)) {
  const derived = await scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyAdminPassword(password, storedHash) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 1_000) return false;
  const [algorithm, encodedSalt, encodedHash] = String(storedHash).split('$');
  if (algorithm !== 'scrypt' || !encodedSalt || !encodedHash) return false;
  try {
    const expected = Buffer.from(encodedHash, 'base64url');
    const derived = await scrypt(password, Buffer.from(encodedSalt, 'base64url'), expected.length, {
      N: 16_384,
      r: 8,
      p: 1,
    });
    return safeEqual(Buffer.from(derived).toString('base64url'), expected.toString('base64url'));
  } catch {
    return false;
  }
}

function cookieValue(request) {
  const raw = request.headers.cookie;
  if (typeof raw !== 'string') return '';
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return '';
}

export function createAdminSessions({ now = () => Date.now() } = {}) {
  const sessions = new Map();

  function cleanup(timestamp) {
    if (sessions.size < 100) return;
    for (const [key, session] of sessions) {
      if (session.absoluteExpiresAt <= timestamp || session.idleExpiresAt <= timestamp) {
        sessions.delete(key);
      }
    }
  }

  function create() {
    const timestamp = now();
    cleanup(timestamp);
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    sessions.set(digest(token), {
      csrfToken,
      absoluteExpiresAt: timestamp + SESSION_ABSOLUTE_MS,
      idleExpiresAt: timestamp + SESSION_IDLE_MS,
    });
    return { token, csrfToken };
  }

  function get(request) {
    const token = cookieValue(request);
    if (!token) return null;
    const key = digest(token);
    const session = sessions.get(key);
    const timestamp = now();
    if (!session || session.absoluteExpiresAt <= timestamp || session.idleExpiresAt <= timestamp) {
      sessions.delete(key);
      return null;
    }
    session.idleExpiresAt = timestamp + SESSION_IDLE_MS;
    return { ...session, tokenHash: key };
  }

  function destroy(request) {
    const token = cookieValue(request);
    if (token) sessions.delete(digest(token));
  }

  function requireCsrf(request, session) {
    const supplied = request.headers['x-csrf-token'];
    return typeof supplied === 'string' && safeEqual(supplied, session.csrfToken);
  }

  return { create, get, destroy, requireCsrf };
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_ABSOLUTE_MS / 1_000}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
