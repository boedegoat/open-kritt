import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import express from 'express';

import {
  SESSION_COOKIE_NAME,
  createAuthSession,
  createLoginThrottle,
  createRequireAuth,
  hashPassword,
  hashToken,
  parseCookies,
  randomSessionToken,
  validateCredentials,
  verifyPassword,
} from '../src/lib/auth.js';
import { createAuthRouter } from '../src/routes/auth.js';

// Minimal in-memory prisma stand-in matching the users/auth_sessions usage in
// the auth routes and middleware.
function fakePrisma() {
  let nextUserId = 1;
  let nextSessionId = 1;
  const users = [];
  const sessions = [];
  return {
    users,
    sessions,
    user: {
      count: async () => users.length,
      findUnique: async ({ where }) => users.find((u) => u.username === where.username) || null,
      create: async ({ data }) => {
        const user = { id: BigInt(nextUserId++), insertedAt: new Date(), updatedAt: new Date(), ...data };
        users.push(user);
        return user;
      },
    },
    authSession: {
      findUnique: async ({ where, include }) => {
        const session = sessions.find((s) => s.tokenHash === where.tokenHash) || null;
        if (session && include?.user) return { ...session, user: users.find((u) => u.id === session.userId) };
        return session;
      },
      create: async ({ data }) => {
        const session = { id: BigInt(nextSessionId++), createdAt: new Date(), ...data };
        sessions.push(session);
        return session;
      },
      delete: async ({ where }) => {
        const index = sessions.findIndex((s) => s.id === where.id);
        if (index === -1) throw Object.assign(new Error('Not found'), { code: 'P2025' });
        return sessions.splice(index, 1)[0];
      },
      deleteMany: async ({ where }) => {
        const before = sessions.length;
        for (let i = sessions.length - 1; i >= 0; i -= 1) {
          const s = sessions[i];
          const tokenMatch = !where?.tokenHash || s.tokenHash === where.tokenHash;
          const userMatch = !where?.userId || s.userId === where.userId;
          const expiredMatch = !where?.expiresAt || s.expiresAt < where.expiresAt.lt;
          if (tokenMatch && userMatch && expiredMatch) sessions.splice(i, 1);
        }
        return { count: before - sessions.length };
      },
      update: async ({ where, data }) => {
        const session = sessions.find((s) => s.id === where.id);
        if (!session) throw Object.assign(new Error('Not found'), { code: 'P2025' });
        Object.assign(session, data);
        return session;
      },
    },
  };
}

async function listen(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err, req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function setCookieHeader(response) {
  const header = response.headers.get('set-cookie');
  if (!header) return null;
  const match = header.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

test('passwords hash with scrypt and verify correctly', async () => {
  const stored = await hashPassword('correct horse battery staple');
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await verifyPassword('correct horse battery staple', stored), true);
  assert.equal(await verifyPassword('wrong password', stored), false);
  assert.equal(await verifyPassword('correct horse battery staple', 'garbage'), false);
  assert.equal(await verifyPassword('correct horse battery staple', 'bcrypt$2b$12$abc'), false);
});

test('session tokens are random and stored hashed', () => {
  const a = randomSessionToken();
  const b = randomSessionToken();
  assert.notEqual(a, b);
  assert.equal(hashToken(a), hashToken(a));
  assert.notEqual(hashToken(a), hashToken(b));
  assert.notEqual(hashToken(a), a);
});

test('cookie header parsing is tolerant of malformed input', () => {
  assert.deepEqual(parseCookies('a=1; b=two; c'), { a: '1', b: 'two' });
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies('x=%20hi%20'), { x: ' hi ' });
  assert.deepEqual(parseCookies(undefined), {});
});

test('credential validation enforces username and password rules', () => {
  assert.equal(validateCredentials({ username: 'admin', password: 'password123' }), null);
  assert.match(validateCredentials({ username: 'a', password: 'password123' }), /Username/);
  assert.match(validateCredentials({ username: 'bad name!', password: 'password123' }), /Username/);
  assert.match(validateCredentials({ username: 'admin', password: 'short' }), /Password/);
  assert.match(validateCredentials({ username: 'admin', password: 'x'.repeat(2000) }), /Password/);
  assert.match(validateCredentials({ username: 'admin', password: undefined }), /password/i);
});

test('login throttle allows attempts inside the window then blocks', () => {
  const throttle = createLoginThrottle({ maxAttempts: 3, windowMs: 60_000 });
  assert.equal(throttle.check('a'), true);
  throttle.record('a');
  throttle.record('a');
  throttle.record('a');
  assert.equal(throttle.check('a'), false);
  assert.equal(throttle.check('b'), true);
  throttle.reset('a');
  assert.equal(throttle.check('a'), true);
  throttle.clear();
  assert.equal(throttle.check('a'), true);
});

test('status reports registration open when no users exist', async () => {
  const { base, close } = await listen(createAuthRouter({ prismaClient: fakePrisma() }));
  try {
    const response = await fetch(`${base}/status`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, { authenticated: false, registrationOpen: true });
  } finally {
    await close();
  }
});

test('register creates the first admin, sets a cookie, and closes sign-up', async () => {
  const { base, close } = await listen(createAuthRouter({ prismaClient: fakePrisma() }));
  try {
    const first = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-password' }),
    });
    assert.equal(first.status, 201);
    const firstBody = await first.json();
    assert.equal(firstBody.user.username, 'admin');
    assert.equal(firstBody.user.passwordHash, undefined);
    assert.equal(typeof setCookieHeader(first), 'string');

    const status = await fetch(`${base}/status`);
    assert.deepEqual(await status.json(), { authenticated: false, registrationOpen: false });

    const second = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'other', password: 'another-password' }),
    });
    assert.equal(second.status, 403);
    assert.match((await second.json()).error, /closed/i);
  } finally {
    await close();
  }
});

test('register rejects invalid credentials', async () => {
  const { base, close } = await listen(createAuthRouter({ prismaClient: fakePrisma() }));
  try {
    const response = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'x', password: 'short' }),
    });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.ok(body.errors.length > 0);
  } finally {
    await close();
  }
});

test('login accepts valid credentials and rejects invalid ones', async () => {
  const prisma = fakePrisma();
  const router = createAuthRouter({ prismaClient: prisma });
  const { base, close } = await listen(router);
  try {
    await prisma.user.create({
      data: { username: 'admin', passwordHash: await hashPassword('correct-password') },
    });

    const wrong = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
    });
    assert.equal(wrong.status, 401);
    assert.equal(setCookieHeader(wrong), null);

    const right = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'correct-password' }),
    });
    assert.equal(right.status, 200);
    assert.equal((await right.json()).user.username, 'admin');
    const token = setCookieHeader(right);
    assert.ok(token);

    const status = await fetch(`${base}/status`, { headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` } });
    const statusBody = await status.json();
    assert.equal(statusBody.authenticated, true);
    assert.equal(statusBody.user.username, 'admin');
    assert.equal(statusBody.registrationOpen, false);
  } finally {
    await close();
  }
});

test('login is throttled after repeated failures', async () => {
  const prisma = fakePrisma();
  await prisma.user.create({
    data: { username: 'admin', passwordHash: await hashPassword('correct-password') },
  });
  const router = createAuthRouter({
    prismaClient: prisma,
    throttle: createLoginThrottle({ maxAttempts: 3, windowMs: 60_000 }),
  });
  const { base, close } = await listen(router);
  try {
    for (let i = 0; i < 3; i += 1) {
      const attempt = await fetch(`${base}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
      });
      assert.equal(attempt.status, 401);
    }
    const blocked = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'correct-password' }),
    });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
  } finally {
    await close();
  }
});

test('logout invalidates the session and clears the cookie', async () => {
  const prisma = fakePrisma();
  const router = createAuthRouter({ prismaClient: prisma });
  const { base, close } = await listen(router);
  try {
    const registered = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-password' }),
    });
    const token = setCookieHeader(registered);
    assert.equal(prisma.sessions.length, 1);

    const logout = await fetch(`${base}/logout`, {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    assert.equal(logout.status, 200);
    assert.equal(prisma.sessions.length, 0);
    assert.match(logout.headers.get('set-cookie') || '', new RegExp(`${SESSION_COOKIE_NAME}=;`));
  } finally {
    await close();
  }
});

test('requireAuth rejects missing, unknown, and expired sessions', async () => {
  const prisma = fakePrisma();
  const app = express();
  app.get('/protected', createRequireAuth({ prismaClient: prisma }), (req, res) => res.json({ ok: true }));
  const { base, close } = await listen(app);
  try {
    const missing = await fetch(`${base}/protected`);
    assert.equal(missing.status, 401);

    const unknown = await fetch(`${base}/protected`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=not-a-real-token` },
    });
    assert.equal(unknown.status, 401);

    const token = await createAuthSession(prisma, 1n);
    const valid = await fetch(`${base}/protected`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { ok: true });

    prisma.sessions[0].expiresAt = new Date(Date.now() - 1000);
    const expired = await fetch(`${base}/protected`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    assert.equal(expired.status, 401);
    assert.equal(prisma.sessions.length, 0); // expired session was deleted
  } finally {
    await close();
  }
});

test('requireAuth passes the user through for valid sessions', async () => {
  const prisma = fakePrisma();
  const user = await prisma.user.create({
    data: { username: 'admin', passwordHash: 'x' },
  });
  const token = await createAuthSession(prisma, user.id);

  const app = express();
  app.get('/protected', createRequireAuth({ prismaClient: prisma }), (req, res) =>
    res.json({ user: req.user.username })
  );
  const { base, close } = await listen(app);
  try {
    const response = await fetch(`${base}/protected`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { user: 'admin' });
  } finally {
    await close();
  }
});
