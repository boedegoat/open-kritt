// App authentication: password hashing, session tokens, and the middleware that
// protects every /api route except the public auth endpoints and health check.
//
// No auth dependency is required: passwords are hashed with Node's built-in
// scrypt, session tokens are random 256-bit values of which only the sha-256
// hash is persisted, and the browser receives an httpOnly cookie.

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { prisma } from '../db.js';

const scrypt = promisify(scryptCallback);

export const SESSION_COOKIE_NAME = 'open_kritt_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_MS;

// scrypt parameters: N=16384, r=8, p=1 is a reasonable interactive-work-factor
// default (≈100ms on typical hardware) with a 16-byte salt and 64-byte key.
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 1024;

export function authError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (!salt.length || !expected.length) return false;
  try {
    const derived = await scrypt(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function randomSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of String(header).split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function publicUser(user) {
  return {
    id: user.id.toString(),
    username: user.username,
    createdAt: user.insertedAt?.toISOString?.() || user.insertedAt,
  };
}

export function validateCredentials({ username, password }) {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username.trim())) {
    return 'Username must be 3-32 characters: letters, numbers, dots, dashes, or underscores, starting with a letter or number.';
  }
  if (typeof password !== 'string') return 'Choose a password.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  return null;
}

export function cookieOptions(req, env = process.env) {
  const secure =
    env.AUTH_COOKIE_SECURE === '1' ||
    env.AUTH_COOKIE_SECURE === 'true' ||
    req.secure ||
    req.get('x-forwarded-proto') === 'https';
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  };
}

/**
 * Creates a login session row and returns the raw token to set as the cookie.
 * Expired sessions for the user are swept opportunistically.
 */
export async function createAuthSession(prismaClient, userId) {
  const token = randomSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prismaClient.authSession.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });
  try {
    await prismaClient.authSession.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });
  } catch {
    // Sweeping is best-effort; a failed sweep never fails a fresh login.
  }
  return token;
}

/**
 * Express middleware factory. Verifies the session cookie, loads the user, and
 * attaches req.user/req.session. 401 when missing, unknown, or expired.
 */
export function createRequireAuth({ prismaClient = prisma } = {}) {
  return async function requireAuth(req, res, next) {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
      if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
      const session = await prismaClient.authSession.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: true },
      });
      if (!session || session.expiresAt <= new Date()) {
        if (session) {
          await prismaClient.authSession.delete({ where: { id: session.id } });
        }
        return res.status(401).json({ error: 'Sign in to continue.' });
      }
      req.user = session.user;
      req.sessionId = session.id;
      void prismaClient.authSession
        .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * In-memory login failure throttle keyed by IP + username. Guards the login
 * endpoint against brute force without external dependencies.
 */
export function createLoginThrottle({ maxAttempts = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const attempts = new Map();
  return {
    check(key) {
      const now = Date.now();
      const recent = (attempts.get(key) || []).filter((at) => now - at < windowMs);
      attempts.set(key, recent);
      return recent.length < maxAttempts;
    },
    record(key) {
      const recent = attempts.get(key) || [];
      recent.push(Date.now());
      attempts.set(key, recent);
    },
    reset(key) {
      attempts.delete(key);
    },
    clear() {
      attempts.clear();
    },
  };
}
