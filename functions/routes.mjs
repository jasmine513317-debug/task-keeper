// Port of app/api/** from the Cloudflare build. Paths, status codes and message strings are
// kept identical because public/auth.js and public/cloud.js are shared with that build; only
// the identity source (application cookie) and the data layer (platform SDK) changed.
import {
  AUTH_HEADER,
  AUTH_HEADER_VALUE,
  DEFAULT_ITERATIONS,
  MAX_ITERATIONS,
  MIN_ITERATIONS,
  SESSION_COOKIE,
  SESSION_DAYS,
  clearedSessionCookie,
  hashPassword,
  newUserId,
  normalizeEmail,
  parseCookie,
  passwordProblem,
  readSession,
  sessionCookie,
  signSession,
  storedIterations,
  usableSecret,
  verifyPassword,
} from './auth-core.mjs';
import { createStore } from './store.mjs';

const MAX_AUTH_BODY = 16 * 1024;
const MAX_SYNC_BODY = 8 * 1024 * 1024;

const json = (body, status = 200, cookie = '') => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store, private', Vary: 'Cookie', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
});
const storageUnavailable = (message = '账号服务暂不可用，请稍后再试') => json({ error: 'storage_unavailable', message }, 503);
const configUnavailable = () => json({ error: 'config_unavailable', message: '站点还没有配置会话密钥，暂时无法登录' }, 503);
const loginRequired = (message = '请先登录') => json({ error: 'login_required', message }, 401);
const invalidCredentials = () => json({ error: 'invalid_credentials', message: '邮箱或密码不正确' }, 401);
const invalidRequest = (message = '请求来源无效，请刷新页面后重试') => json({ error: 'invalid_request', message }, 403);
const rejectedBody = () => json({ error: 'invalid_json', message: '无法解析请求内容' }, 400);

const setting = (env, name) => env?.get(name) || '';

// The custom header cannot be attached by a cross-origin form post, which is what makes a
// cookie-authenticated write safe from the SPA. Kept distinct from the sync guard.
function acceptsAuthRequest(request) {
  return (
    request.headers.get(AUTH_HEADER) === AUTH_HEADER_VALUE &&
    !!request.headers.get('content-type')?.startsWith('application/json') &&
    request.headers.get('sec-fetch-site') !== 'cross-site'
  );
}

// Best effort: these headers only widen the throttling grid, and the per-email counter keeps
// working when a deployment does not expose a client address at all.
function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') ||
    (forwarded ? forwarded.split(',')[0] : '');
  return (ip || '').trim().slice(0, 45);
}

// The body has to be capped while it streams: a large upload must not be buffered first.
async function readBounded(request, limit) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > limit) return { error: declared > MAX_SYNC_BODY ? 'payload_too_large' : 'invalid_json' };
  const reader = request.body?.getReader();
  if (!reader) return { error: 'invalid_json' };
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return { error: limit === MAX_SYNC_BODY ? 'payload_too_large' : 'invalid_json' };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { body: parsed } : { error: 'invalid_json' };
  } catch {
    return { error: 'invalid_json' };
  }
}

const text = (body, field) => (typeof body[field] === 'string' ? body[field] : '');

// Verbatim from the Cloudflare sync route: a snapshot the SPA uploads is untrusted input, and
// the merge on another device must never receive something normalizeState would reject.
function validState(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.tasks) || s.tasks.length > 10000 || !Array.isArray(s.sources) || s.sources.length > 300 || !s.profile || typeof s.profile !== 'object') return false;
  const ids = new Set();
  for (const t of s.tasks) {
    if (!t || typeof t.id !== 'string' || !/^[-a-zA-Z0-9]{1,100}$/.test(t.id) || ids.has(t.id) || typeof t.title !== 'string' || !t.title.trim() || t.title.length > 1000 || !['todo', 'pending', 'done', 'ignored', 'deleted'].includes(t.status)) return false;
    ids.add(t.id);
  }
  return s.sources.every((x) => typeof x === 'string' && x.length <= 80);
}

// Both the full /functions/v1/app... path and the Provider-stripped /app... form arrive here,
// and a path that matches neither is the local harness calling the business routes directly.
function routePath(url) {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
  return match ? match[1] || '/' : pathname;
}

// `env` is only injected for the local harness; a deployed Function reads Deno.env, where the
// platform puts AUTH_SECRET and the PBKDF2 cost knob.
export function application({ db, env = (typeof Deno === 'undefined' ? undefined : Deno.env) }) {
  const store = createStore(db);
  const sessionSecret = () => setting(env, 'AUTH_SECRET');
  const passwordIterations = () => {
    const configured = Number(setting(env, 'AUTH_PBKDF2_ITERATIONS') || 0);
    return Number.isSafeInteger(configured) && configured >= MIN_ITERATIONS && configured <= MAX_ITERATIONS
      ? configured
      : DEFAULT_ITERATIONS;
  };

  // Hashing a throwaway password when no such account exists keeps a wrong password and an
  // unknown address taking about the same CPU time, so responses cannot be timed apart.
  async function burnPasswordTime(password) {
    await hashPassword(password, passwordIterations()).catch(() => undefined);
  }

  async function cookieFor(user) {
    const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
    return sessionCookie(await signSession({ uid: user.id, epoch: user.epoch, exp }, sessionSecret()));
  }

  // Every route starts from the same two preconditions, exactly like servicesUnavailable().
  function servicesUnavailable() {
    if (!usableSecret(sessionSecret())) return configUnavailable();
    return null;
  }

  function requestRejected(request) {
    return acceptsAuthRequest(request) ? servicesUnavailable() : invalidRequest();
  }

  // The account session is our own signed cookie, so it is read from the raw request rather
  // than from the platform context, whose user identity refers to a Qoder account.
  async function currentUser(rawRequest) {
    if (!usableSecret(sessionSecret())) return null;
    const token = parseCookie(rawRequest.headers.get('cookie') || '', SESSION_COOKIE);
    if (!token) return null;
    const claims = await readSession(token, sessionSecret());
    if (!claims) return null;
    const row = await store.userById(claims.uid);
    // A changed epoch means the password was reset, which retires every token minted before it.
    if (!row || row.session_epoch !== claims.epoch) return null;
    return { id: row.id, email: row.email, isAdmin: row.is_admin === true || row.is_admin === 1, epoch: row.session_epoch };
  }

  async function login(request) {
    const rejected = requestRejected(request);
    if (rejected) return rejected;
    const { body, error } = await readBounded(request, MAX_AUTH_BODY);
    if (error) return rejectedBody();
    const email = normalizeEmail(text(body, 'email'));
    const password = text(body, 'password');
    const ip = clientIp(request);
    if (!email || !password) return invalidCredentials();
    if (await store.loginBlocked(email, ip)) {
      return json({ error: 'too_many_attempts', message: '尝试次数过多，请 15 分钟后再试' }, 429);
    }
    const row = await store.userByEmail(email);
    if (!row) {
      await burnPasswordTime(password);
      await store.noteLoginFailure(email, ip);
      return invalidCredentials();
    }
    if (!(await verifyPassword(password, row.password_hash))) {
      await store.noteLoginFailure(email, ip);
      return invalidCredentials();
    }
    await store.clearLoginFailures(email, ip);
    // Existing accounts move onto the configured cost the next time they prove the password.
    const target = passwordIterations();
    await store.touchLogin(row.id, new Date().toISOString());
    if (storedIterations(row.password_hash) < target) {
      await store.setPasswordHash(row.id, await hashPassword(password, target));
    }
    return json({ user: { id: row.id, email: row.email } }, 200, await cookieFor({ id: row.id, epoch: row.session_epoch }));
  }

  async function register(request) {
    const rejected = requestRejected(request);
    if (rejected) return rejected;
    const { body, error } = await readBounded(request, MAX_AUTH_BODY);
    if (error) return rejectedBody();
    // The SPA sends it; a human filling the form never sees it. Cheap bot filter, not a defence.
    if (text(body, 'website')) return json({ error: 'spam', message: '注册未能完成' }, 400);
    const email = normalizeEmail(text(body, 'email'));
    const password = text(body, 'password');
    const ip = clientIp(request);
    if (!email) return json({ error: 'invalid_email', message: '请填写有效的邮箱地址' }, 400);
    const problem = passwordProblem(password, email);
    if (problem) return json({ error: 'weak_password', message: problem }, 400);
    if (await store.registerBlocked(ip)) {
      return json({ error: 'too_many_attempts', message: '本机注册尝试过多，请一小时后再试' }, 429);
    }

    const id = newUserId();
    const at = new Date().toISOString();
    const hash = await hashPassword(password, passwordIterations());
    const inserted = await store.insertUser({
      id, email, password_hash: hash, session_epoch: 1, is_admin: false, created_at: at, last_login_at: at,
    });
    if (inserted.error) {
      await store.noteRegisterFailure(ip);
      return inserted.rows.length || (await store.emailTaken(email))
        ? json({ error: 'email_taken', message: '这个邮箱已经注册过，请直接登录' }, 409)
        : storageUnavailable();
    }

    // The Workers build claimed admin inside one atomic batch. Here the claim is a unique row:
    // only the insert that actually lands gets a returned record, so racing first registrations
    // produce exactly one administrator.
    const claim = await store.claimFirstAccount(id, at);
    if (!claim.error && claim.rows.length) {
      await store.becomeAdmin(id);
    }
    return json({ user: { id, email } }, 201, await cookieFor({ id, epoch: 1 }));
  }

  async function session(rawRequest) {
    const down = servicesUnavailable();
    if (down) return down;
    const user = await currentUser(rawRequest);
    if (!user) return loginRequired();
    return json({ user: { id: user.id, email: user.email, isAdmin: user.isAdmin } });
  }

  async function logout(request) {
    // Clearing the cookie needs no database, but it still must not be triggerable cross-site.
    if (!acceptsAuthRequest(request)) return invalidRequest();
    return json({ ok: true }, 200, clearedSessionCookie());
  }

  async function changePassword(request, rawRequest) {
    const rejected = requestRejected(request);
    if (rejected) return rejected;
    const user = await currentUser(rawRequest);
    if (!user) return loginRequired();
    const { body, error } = await readBounded(request, MAX_AUTH_BODY);
    if (error) return rejectedBody();
    const currentPassword = text(body, 'currentPassword');
    const newPassword = text(body, 'newPassword');
    const account = await store.userById(user.id);
    if (!account) return loginRequired('账号已不存在，请重新登录');
    if (!(await verifyPassword(currentPassword, account.password_hash))) {
      return json({ error: 'wrong_password', message: '当前密码不正确' }, 403);
    }
    const problem = passwordProblem(newPassword, user.email);
    if (problem) return json({ error: 'weak_password', message: problem }, 400);
    if (newPassword === currentPassword) return json({ error: 'same_password', message: '新密码与当前密码相同' }, 400);

    // Raising the epoch retires every session issued before this change, including this one,
    // which is how a compromised password gets fully locked out without a session table.
    const hash = await hashPassword(newPassword, passwordIterations());
    const changed = await store.setPassword(user.id, hash, user.epoch);
    if (!changed.length) return storageUnavailable();
    return json({ ok: true, message: '密码已更新，所有设备都需要重新登录' }, 200, clearedSessionCookie());
  }

  async function adminReset(request, rawRequest) {
    const rejected = requestRejected(request);
    if (rejected) return rejected;
    const user = await currentUser(rawRequest);
    if (!user) return loginRequired();
    if (!user.isAdmin) return json({ error: 'admin_required', message: '只有站点管理员可以重置他人密码' }, 403);
    const { body, error } = await readBounded(request, MAX_AUTH_BODY);
    if (error) return rejectedBody();
    const email = normalizeEmail(text(body, 'email'));
    const newPassword = text(body, 'newPassword');
    if (!email) return json({ error: 'invalid_email', message: '请填写有效的邮箱地址' }, 400);
    const problem = passwordProblem(newPassword, email);
    if (problem) return json({ error: 'weak_password', message: problem }, 400);
    const target = await store.userByEmail(email);
    if (!target) return json({ error: 'no_such_user', message: '没有找到这个邮箱对应的账号' }, 404);
    const hash = await hashPassword(newPassword, passwordIterations());
    const changed = await store.setPassword(target.id, hash, target.session_epoch);
    if (!changed.length) return storageUnavailable();
    return json({ ok: true, message: `已为 ${email} 设置新密码，该账号需要重新登录` });
  }

  const conflict = (row) => json(
    { error: 'revision_conflict', revision: row?.revision || 0, state: row ? JSON.parse(row.payload) : null },
    409,
  );

  async function getSync(rawRequest) {
    const down = servicesUnavailable();
    if (down) return down;
    const user = await currentUser(rawRequest);
    if (!user) return loginRequired();
    const row = await store.snapshot(user.id);
    return json({
      user: { id: user.id, name: user.email },
      revision: row?.revision || 0,
      state: row ? JSON.parse(row.payload) : null,
      updatedAt: row?.updated_at || null,
    });
  }

  async function putSync(request, rawRequest) {
    // sync-v1 is the write guard here; the header cannot be set cross-origin, which is what
    // makes the cookie-authenticated PUT safe. It must stay distinct from auth-v1.
    if (
      request.headers.get(AUTH_HEADER) !== 'sync-v1' ||
      !request.headers.get('content-type')?.startsWith('application/json') ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    ) return json({ error: 'invalid_request' }, 403);
    const down = servicesUnavailable();
    if (down) return down;
    const user = await currentUser(rawRequest);
    if (!user) return loginRequired();
    const { body, error } = await readBounded(request, MAX_SYNC_BODY);
    if (error) return json({ error }, 400);
    if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0 || !validState(body.state)) {
      return json({ error: 'invalid_state' }, 400);
    }
    const payload = JSON.stringify(body.state);
    const at = new Date().toISOString();
    if (body.revision === 0) {
      // No row yet, so the first write claims it. A concurrent writer that got there first
      // keeps its own stamp, and the read-back below turns that into the same 409 the
      // Workers build produced.
      const created = await store.createSnapshot(user.id, payload, at);
      if (created.error) throw created.error;
      const row = await store.snapshot(user.id);
      if (!created.rows.length || row?.revision !== 1 || row?.payload !== payload) return conflict(row);
      return json({ revision: 1, updatedAt: at });
    }
    const replaced = await store.replaceSnapshot(user.id, body.revision, payload, at);
    if (!replaced.length) return conflict(await store.snapshot(user.id));
    return json({ revision: body.revision + 1, updatedAt: at });
  }

  return async (context, rawRequest) => {
    const request = context?.request || rawRequest;
    const path = routePath(request.url);
    const method = request.method.toUpperCase();
    try {
      if (path === '/api/health' && method === 'GET') return Response.json({ ok: true, service: 'task-keeper' });
      if (path === '/api/auth/login' && method === 'POST') return await login(request);
      if (path === '/api/auth/register' && method === 'POST') return await register(request);
      if (path === '/api/auth/logout' && method === 'POST') return await logout(request);
      if (path === '/api/auth/password' && method === 'POST') return await changePassword(request, rawRequest);
      if (path === '/api/auth/admin/reset' && method === 'POST') return await adminReset(request, rawRequest);
      if (path === '/api/auth/session' && method === 'GET') return await session(rawRequest);
      if (path === '/api/sync' && method === 'GET') return await getSync(rawRequest);
      if (path === '/api/sync' && method === 'PUT') return await putSync(request, rawRequest);
      return json({ error: 'not_found', message: '接口不存在' }, 404);
    } catch {
      // No provider detail reaches the browser: the snapshot payload and the account email are
      // both user data, and the stack stays in the Function logs.
      return path.startsWith('/api/sync') ? json({ error: 'storage_unavailable' }, 503) : storageUnavailable();
    }
  };
}
