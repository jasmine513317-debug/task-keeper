import { env } from 'cloudflare:workers';
import {
  AUTH_HEADER,
  AUTH_HEADER_VALUE,
  DEFAULT_ITERATIONS,
  MAX_ITERATIONS,
  MIN_ITERATIONS,
  SESSION_COOKIE,
  SESSION_DAYS,
  clearedSessionCookie,
  clientAddress,
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
} from './auth-core';

export type AuthUser = { id: string; email: string; isAdmin: boolean; sessionEpoch: number };

export const json = (body: unknown, status = 200, cookie = '') =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, private', Vary: 'Cookie', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
  });

export const storageReady = () => !!env.DB;
export const secretReady = () => usableSecret(env.AUTH_SECRET || '');
export const clientIp = clientAddress;

export function passwordIterations() {
  const configured = Number(env.AUTH_PBKDF2_ITERATIONS || 0);
  return Number.isSafeInteger(configured) && configured >= MIN_ITERATIONS && configured <= MAX_ITERATIONS
    ? configured
    : DEFAULT_ITERATIONS;
}

// An auth payload is a handful of short strings; anything larger is abuse.
const MAX_BODY = 16 * 1024;

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function text(body: Record<string, unknown>, field: string) {
  const value = body[field];
  return typeof value === 'string' ? value : '';
}

// The custom header cannot be attached by a cross-origin form post, which is what makes a
// cookie-authenticated write safe from the SPA. Same contract the sync endpoint enforces.
export function acceptsAuthRequest(request: Request) {
  return (
    request.headers.get(AUTH_HEADER) === AUTH_HEADER_VALUE &&
    !!request.headers.get('content-type')?.startsWith('application/json') &&
    request.headers.get('sec-fetch-site') !== 'cross-site'
  );
}

// Fixed buckets, so an exhausted window rolls over by itself and the table needs no sweeper.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const LOGIN_LIMIT_PER_EMAIL = 8;
// Deliberately loose. A class shares one school egress IP, and the per-email counter is what
// actually slows down anyone guessing a specific account.
const FAILURE_LIMIT_PER_IP = 200;
const REGISTER_LIMIT_PER_IP = 60;

const bucketStart = (windowMs: number) => new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();

async function failureCount(key: string, windowMs: number) {
  const row = await env.DB!.prepare('SELECT failures, window_start FROM auth_attempts WHERE key = ?')
    .bind(key)
    .first<{ failures: number; window_start: string }>();
  if (!row || row.window_start !== bucketStart(windowMs)) return 0;
  return row.failures;
}

// Increment the current bucket, reset a stale one, then create a missing row. Order matters:
// after the reset the row is current, so the insert is ignored.
async function countFailure(key: string, windowMs: number) {
  const windowStart = bucketStart(windowMs);
  const at = new Date().toISOString();
  await env.DB!.batch([
    env.DB!.prepare('UPDATE auth_attempts SET failures = failures + 1, last_attempt = ? WHERE key = ? AND window_start = ?').bind(at, key, windowStart),
    env.DB!.prepare('UPDATE auth_attempts SET failures = 1, window_start = ?, last_attempt = ? WHERE key = ? AND window_start <> ?').bind(windowStart, at, key, windowStart),
    env.DB!.prepare('INSERT OR IGNORE INTO auth_attempts (key, failures, window_start, last_attempt) VALUES (?, 1, ?, ?)').bind(key, windowStart, at),
  ]);
}

const emailKey = (email: string) => `login|e|${email}`;
const ipKey = (ip: string) => `login|i|${ip}`;
const registerKey = (ip: string) => `register|i|${ip}`;

export async function loginBlocked(email: string, ip: string) {
  if ((await failureCount(emailKey(email), LOGIN_WINDOW_MS)) >= LOGIN_LIMIT_PER_EMAIL) return true;
  return !!ip && (await failureCount(ipKey(ip), LOGIN_WINDOW_MS)) >= FAILURE_LIMIT_PER_IP;
}

export async function registerBlocked(ip: string) {
  return !!ip && (await failureCount(registerKey(ip), REGISTER_WINDOW_MS)) >= REGISTER_LIMIT_PER_IP;
}

export async function noteLoginFailure(email: string, ip: string) {
  await countFailure(emailKey(email), LOGIN_WINDOW_MS);
  if (ip) await countFailure(ipKey(ip), LOGIN_WINDOW_MS);
}

export async function noteRegisterFailure(ip: string) {
  if (ip) await countFailure(registerKey(ip), REGISTER_WINDOW_MS);
}

// A successful login proves this address/IP combination, so its guess counters start over.
// The registration counter stays: proving one password must not buy quota to open more accounts.
export async function clearAuthFailures(email: string, ip: string) {
  await env.DB!.prepare('DELETE FROM auth_attempts WHERE key IN (?, ?)').bind(emailKey(email), ipKey(ip)).run();
}

export const invalidCredentials = () => json({ error: 'invalid_credentials', message: '邮箱或密码不正确' }, 401);

// Every auth route starts from the same three preconditions.
export function servicesUnavailable() {
  if (!storageReady()) return json({ error: 'storage_unavailable', message: '账号服务暂不可用，请稍后再试' }, 503);
  if (!secretReady()) return json({ error: 'config_unavailable', message: '站点还没有配置会话密钥，暂时无法登录' }, 503);
  return null;
}

export function requestRejected(request: Request) {
  if (!acceptsAuthRequest(request)) return json({ error: 'invalid_request', message: '请求来源无效，请刷新页面后重试' }, 403);
  return servicesUnavailable();
}

// Hashing a throwaway password when no such account exists keeps a wrong password and an
// unknown address taking about the same CPU time, so responses cannot be timed apart.
export async function burnPasswordTime(password: string) {
  await hashPassword(password, passwordIterations()).catch(() => undefined);
}

export async function currentUser(request: Request): Promise<AuthUser | null> {
  if (!storageReady() || !secretReady()) return null;
  const token = parseCookie(request.headers.get('cookie') || '', SESSION_COOKIE);
  if (!token) return null;
  const claims = await readSession(token, env.AUTH_SECRET || '');
  if (!claims) return null;
  const row = await env.DB!.prepare('SELECT id, email, session_epoch, is_admin FROM users WHERE id = ?')
    .bind(claims.uid)
    .first<{ id: string; email: string; session_epoch: number; is_admin: number }>();
  // A changed epoch means the password was reset, which retires every token issued before it.
  if (!row || row.session_epoch !== claims.epoch) return null;
  return { id: row.id, email: row.email, isAdmin: row.is_admin === 1, sessionEpoch: row.session_epoch };
}

export async function sessionCookieFor(user: { id: string; sessionEpoch: number }) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return sessionCookie(await signSession({ uid: user.id, epoch: user.sessionEpoch, exp }, env.AUTH_SECRET || ''));
}

export const logoutCookie = clearedSessionCookie;
export { hashPassword, newUserId, normalizeEmail, passwordProblem, storedIterations, verifyPassword };
