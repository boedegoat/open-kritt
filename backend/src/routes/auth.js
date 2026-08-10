import { Router } from 'express';

import { prisma } from '../db.js';
import {
  SESSION_COOKIE_NAME,
  authError,
  cookieOptions,
  createAuthSession,
  createLoginThrottle,
  hashPassword,
  hashToken,
  parseCookies,
  publicUser,
  validateCredentials,
  verifyPassword,
} from '../lib/auth.js';

export function createAuthRouter({ prismaClient = prisma, throttle = createLoginThrottle() } = {}) {
  const router = Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Public: tells the UI whether to show the admin registration form (no users
  // exist yet) or the sign-in form, and whether the current session is valid.
  router.get('/status', async (req, res, next) => {
    try {
      const userCount = await prismaClient.user.count();
      const registrationOpen = userCount === 0;
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
      if (token) {
        const session = await prismaClient.authSession.findUnique({
          where: { tokenHash: hashToken(token) },
          include: { user: true },
        });
        if (session && session.expiresAt > new Date()) {
          return res.json({ authenticated: true, registrationOpen, user: publicUser(session.user) });
        }
      }
      return res.json({ authenticated: false, registrationOpen });
    } catch (error) {
      next(error);
    }
  });

  // Public only while no user exists: creates the initial admin account and
  // signs it in immediately. Once the first account exists, sign-up is closed.
  router.post('/register', async (req, res, next) => {
    try {
      const userCount = await prismaClient.user.count();
      if (userCount > 0) {
        throw authError('Admin account already exists. Sign-up is closed.', 403);
      }
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const validationError = validateCredentials({ username, password });
      if (validationError) {
        return res.status(422).json({
          error: 'Validation failed.',
          errors: [
            { field: validationError.startsWith('Username') ? 'username' : 'password', message: validationError },
          ],
        });
      }
      const user = await prismaClient.user.create({
        data: { username, passwordHash: await hashPassword(password) },
      });
      const token = await createAuthSession(prismaClient, user.id);
      res.cookie(SESSION_COOKIE_NAME, token, cookieOptions(req));
      return res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const key = `${req.ip}|${username.toLowerCase()}`;
      if (!throttle.check(key)) {
        res.set('Retry-After', '900');
        return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
      }
      const user = await prismaClient.user.findUnique({ where: { username } });
      const valid = user && (await verifyPassword(password, user.passwordHash));
      if (!valid) {
        throttle.record(key);
        return res.status(401).json({ error: 'Incorrect username or password.' });
      }
      throttle.reset(key);
      const token = await createAuthSession(prismaClient, user.id);
      res.cookie(SESSION_COOKIE_NAME, token, cookieOptions(req));
      return res.json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
      if (token) {
        await prismaClient.authSession.deleteMany({ where: { tokenHash: hashToken(token) } }).catch(() => {});
      }
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      return res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createAuthRouter();
