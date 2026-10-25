// Fake Supabase Auth (GoTrue) + Mailpit inbox for the E2E runs where no Supabase CLI (Docker) is
// available. Plain Node, no dependencies. It speaks only what @supabase/ssr + supabase-js need for
// ADR-012: magic link (PKCE), passkeys (no signature check), getUser, refresh, logout, admin user
// creation; plus the two Mailpit endpoints the tests read the magic link from. Never deployed.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';

const port = Number(process.env.FAKE_AUTH_PORT ?? 54329);
const secret = 'fake-auth-secret-not-for-production';
const users = new Map(); // email -> { id, email, password, created_at }
const sessions = new Map(); // sessionId -> { userId, accessToken, refreshToken, expiresAt }
const magicTokens = new Map(); // token -> { email, challenge }
const authCodes = new Map(); // code -> { email, challenge }
const messages = []; // Mailpit-shaped, newest first
const passkeyChallenges = new Map(); // challenge_id -> { kind: 'registration' | 'authentication', userId }
const passkeys = new Map(); // credential id -> userId (fake: the signature is never checked)

function passkeyOptions(kind, user) {
  const challenge = b64url(randomBytes(32));
  if (kind === 'registration') {
    return {
      rp: { id: 'localhost', name: 'Shoebox' },
      user: { id: b64url(Buffer.from(user.id)), name: user.email, displayName: user.email },
      challenge,
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    };
  }
  return { challenge, rpId: 'localhost', timeout: 60000, userVerification: 'preferred' };
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...extra });
  res.end(JSON.stringify(body));
};
const gotrueError = (res, status, code, msg) =>
  json(res, status, { code: status, error_code: code, msg });

function publicUser(user) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: user.created_at,
    phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: user.created_at,
    updated_at: user.created_at,
    is_anonymous: false,
  };
}

function jwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function createSession(user) {
  const sessionId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600;
  const accessToken = jwt({
    iss: `http://127.0.0.1:${port}/auth/v1`,
    sub: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    session_id: sessionId,
    iat: now,
    exp: now + expiresIn,
    aal: 'aal1',
    amr: [{ method: 'password', timestamp: now }],
    is_anonymous: false,
  });
  const refreshToken = b64url(randomBytes(24));
  sessions.set(sessionId, {
    userId: user.id,
    accessToken,
    refreshToken,
    expiresAt: now + expiresIn,
  });
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: now + expiresIn,
    refresh_token: refreshToken,
    user: publicUser(user),
  };
}

function sessionFromBearer(req) {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  for (const [id, session] of sessions) {
    if (session.accessToken === token) return { id, session };
  }
  return null;
}

function userById(id) {
  for (const user of users.values()) if (user.id === id) return user;
  return undefined;
}

function getOrCreateUser(email, password) {
  let user = users.get(email);
  if (!user) {
    user = { id: randomUUID(), email, password, created_at: new Date().toISOString() };
    users.set(email, user);
  }
  return user;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function appendRedirect(redirectTo, params) {
  const url = new URL(redirectTo);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const { pathname } = url;
  const method = req.method ?? 'GET';

  if (pathname === '/health') return json(res, 200, { ok: true });

  // Mailpit API subset (https://mailpit.axllent.org/docs/api-v1/)
  if (pathname === '/api/v1/messages' && method === 'GET') {
    return json(res, 200, {
      total: messages.length,
      messages: messages.map(({ Text, HTML, ...m }) => m),
    });
  }
  if (pathname === '/api/v1/messages' && method === 'DELETE') {
    messages.length = 0;
    return json(res, 200, { ok: true });
  }
  if (pathname.startsWith('/api/v1/message/') && method === 'GET') {
    const message = messages.find((m) => m.ID === pathname.slice('/api/v1/message/'.length));
    return message ? json(res, 200, message) : json(res, 404, { error: 'not found' });
  }

  // GoTrue admin
  if (pathname === '/auth/v1/admin/users' && method === 'POST') {
    const body = await readBody(req);
    if (!body.email) return gotrueError(res, 422, 'validation_failed', 'email required');
    if (users.has(body.email)) {
      return gotrueError(
        res,
        422,
        'email_exists',
        'A user with this email address has already been registered',
      );
    }
    const user = getOrCreateUser(body.email, body.password ?? null);
    return json(res, 200, publicUser(user));
  }

  // GoTrue auth
  if (pathname === '/auth/v1/token' && method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    const body = await readBody(req);
    if (grant === 'password') {
      const user = users.get(body.email);
      if (!user || user.password === null || user.password !== body.password) {
        return gotrueError(res, 400, 'invalid_credentials', 'Invalid login credentials');
      }
      return json(res, 200, createSession(user));
    }
    if (grant === 'pkce') {
      const entry = authCodes.get(body.auth_code);
      authCodes.delete(body.auth_code);
      if (!entry)
        return gotrueError(
          res,
          404,
          'flow_state_not_found',
          'invalid flow state, no valid flow state found',
        );
      const challenge = createHash('sha256')
        .update(body.code_verifier ?? '')
        .digest('base64url');
      if (challenge !== entry.challenge)
        return gotrueError(res, 403, 'bad_code_verifier', 'code challenge does not match');
      const user = users.get(entry.email);
      return json(res, 200, createSession(user));
    }
    if (grant === 'refresh_token') {
      for (const [id, session] of sessions) {
        if (session.refreshToken === body.refresh_token) {
          const user = userById(session.userId);
          sessions.delete(id);
          return json(res, 200, createSession(user));
        }
      }
      return gotrueError(
        res,
        400,
        'refresh_token_not_found',
        'Invalid Refresh Token: Refresh Token Not Found',
      );
    }
    return gotrueError(res, 400, 'unsupported_grant_type', 'unsupported grant type');
  }

  // Passkeys (supabase-js two-step API). Shapes as GoTrue; nothing cryptographic is verified.
  const passkeyRoute =
    /^\/auth\/v1\/passkeys\/(registration|authentication)\/(options|verify)$/.exec(pathname);
  if (passkeyRoute && method === 'POST') {
    const [, kind, step] = passkeyRoute;
    const body = await readBody(req);
    const bearer = sessionFromBearer(req);
    const user = bearer ? userById(bearer.session.userId) : undefined;
    if (kind === 'registration' && !user) {
      return gotrueError(res, 401, 'no_authorization', 'session required');
    }
    if (step === 'options') {
      const challengeId = randomUUID();
      passkeyChallenges.set(challengeId, { kind, userId: user?.id ?? null });
      return json(res, 200, {
        challenge_id: challengeId,
        options: passkeyOptions(kind, user),
        expires_at: Math.floor(Date.now() / 1000) + 300,
      });
    }
    const challenge = passkeyChallenges.get(body.challenge_id);
    passkeyChallenges.delete(body.challenge_id);
    const credentialId = body.credential?.id;
    if (!challenge || challenge.kind !== kind || typeof credentialId !== 'string') {
      return gotrueError(res, 400, 'webauthn_challenge_not_found', 'unknown challenge');
    }
    if (kind === 'registration') {
      passkeys.set(credentialId, user.id);
      return json(res, 200, { id: randomUUID(), created_at: new Date().toISOString() });
    }
    const owner = userById(passkeys.get(credentialId));
    if (!owner) return gotrueError(res, 400, 'webauthn_credential_not_found', 'unknown passkey');
    return json(res, 200, createSession(owner));
  }

  if (pathname === '/auth/v1/otp' && method === 'POST') {
    const body = await readBody(req);
    if (!body.email) return gotrueError(res, 422, 'validation_failed', 'email required');
    getOrCreateUser(body.email, null);
    const token = b64url(randomBytes(18));
    magicTokens.set(token, { email: body.email, challenge: body.code_challenge ?? null });
    const redirectTo =
      url.searchParams.get('redirect_to') ??
      body.redirect_to ??
      `http://localhost:3100/auth/callback`;
    const link = `http://127.0.0.1:${port}/auth/v1/verify?token=${token}&type=magiclink&redirect_to=${encodeURIComponent(redirectTo)}`;
    messages.unshift({
      ID: randomUUID(),
      From: { Name: 'Supabase Auth', Address: 'noreply@mail.app.supabase.io' },
      To: [{ Name: '', Address: body.email }],
      Subject: 'Your Magic Link',
      Created: new Date().toISOString(),
      Text: `Follow this link to login:\n${link}\n`,
      HTML: `<p><a href="${link}">Log In</a></p>`,
    });
    return json(res, 200, {});
  }

  if (pathname === '/auth/v1/verify' && method === 'GET') {
    const token = url.searchParams.get('token') ?? '';
    const redirectTo = url.searchParams.get('redirect_to') ?? 'http://localhost:3100/';
    const entry = magicTokens.get(token);
    magicTokens.delete(token);
    if (!entry) {
      res.writeHead(303, {
        location: appendRedirect(redirectTo, {
          error: 'access_denied',
          error_code: 'otp_expired',
          error_description: 'Email link is invalid or has expired',
        }),
      });
      return res.end();
    }
    const code = randomUUID();
    authCodes.set(code, entry);
    res.writeHead(303, { location: appendRedirect(redirectTo, { code }) });
    return res.end();
  }

  if (pathname === '/auth/v1/user' && method === 'GET') {
    const found = sessionFromBearer(req);
    if (!found)
      return gotrueError(
        res,
        403,
        'session_not_found',
        'Session from session_id claim in JWT does not exist',
      );
    return json(res, 200, publicUser(userById(found.session.userId)));
  }

  if (pathname === '/auth/v1/logout' && method === 'POST') {
    const found = sessionFromBearer(req);
    if (found) {
      const scope = url.searchParams.get('scope') ?? 'global';
      if (scope === 'global') {
        for (const [id, session] of sessions)
          if (session.userId === found.session.userId) sessions.delete(id);
      } else {
        sessions.delete(found.id);
      }
    }
    res.writeHead(204);
    return res.end();
  }

  return gotrueError(res, 404, 'not_found', `fake-auth-server: no route for ${method} ${pathname}`);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`fake-auth-server listening on http://127.0.0.1:${port}\n`);
});
