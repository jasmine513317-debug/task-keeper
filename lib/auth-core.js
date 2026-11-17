// Authentication primitives: email normalisation, password hashing, session tokens and
// cookie strings. Pure Web Crypto with no Workers or Node dependency, so tests/index.html
// exercises this exact file in a real browser instead of a reimplementation.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
// Sites serves many tenants under one registrable domain, where a sibling could set a
// Domain=.qoder.site cookie for us. The __Host- prefix forbids that, and the string is a
// fixed constant that never carries user input.
export const SESSION_COOKIE = '__Host-taskkeeper-session';
export const SESSION_DAYS = 30;

// PBKDF2 cost is bounded by the Worker CPU slice, not only by security: 150k SHA-256
// rounds cost roughly a tenth of a second, so deployments with a tight cpu_ms budget must
// lower this through AUTH_PBKDF2_ITERATIONS rather than accept a 500 on every login.
export const DEFAULT_ITERATIONS = 150_000;
export const MIN_ITERATIONS = 1_000;
export const MAX_ITERATIONS = 5_000_000;

const toBase64Url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64Url = (value) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export function newUserId() {
  return crypto.randomUUID();
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// A local-part plus a labelled domain with an alphabetic TLD. Deliberately rejects the
// quoted and comment forms RFC allows, because those only ever appear in crafted input.
const EMAIL_SHAPE = /^[a-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+\/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return '';
  return EMAIL_SHAPE.test(email) ? email : '';
}

export function passwordProblem(password, email = '') {
  if (typeof password !== 'string') return '密码格式无效';
  if ([...password].length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 个字符`;
  // Bound the bytes handed to PBKDF2; a 200-character CJK password is already 600 bytes.
  if ([...password].length > PASSWORD_MAX || encoder.encode(password).length > 1024) {
    return `密码最多 ${PASSWORD_MAX} 个字符`;
  }
  if (email && password.toLowerCase() === String(email).split('@')[0].toLowerCase()) return '密码不能与邮箱前缀相同';
  return '';
}

function validIterations(iterations) {
  return Number.isSafeInteger(iterations) && iterations >= MIN_ITERATIONS && iterations <= MAX_ITERATIONS;
}

async function derive(password, salt, iterations) {
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, baseKey, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password, iterations = DEFAULT_ITERATIONS) {
  if (!validIterations(iterations)) throw Error('迭代次数无效');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(await derive(password, salt, iterations))}`;
}

export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!validIterations(iterations)) return false;
  let salt;
  let expected;
  try {
    salt = fromBase64Url(parts[2]);
    expected = fromBase64Url(parts[3]);
  } catch {
    return false;
  }
  if (salt.byteLength !== 16 || expected.byteLength !== 32) return false;
  return timingSafeEqual(await derive(password, salt, iterations), expected);
}

// How many rounds a stored hash uses, so a login can transparently re-hash onto a higher
// cost once the deployment raises AUTH_PBKDF2_ITERATIONS.
export function storedIterations(stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return 0;
  const iterations = Number(parts[1]);
  return validIterations(iterations) ? iterations : 0;
}

function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// A shared secret shorter than a SHA-256 block is guessable; refuse to issue tokens with one
// instead of silently signing with whatever the deployment happened to set.
export function usableSecret(secret) {
  return typeof secret === 'string' && secret.length >= 32 && secret.length <= 4096;
}

export async function signSession(payload, secret) {
  if (!usableSecret(secret)) throw Error('会话密钥未配置或长度不足');
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`v1.${body}`))));
  return `v1.${body}.${signature}`;
}

export async function readSession(token, secret) {
  if (typeof token !== 'string' || !usableSecret(secret)) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  let signature;
  try {
    signature = fromBase64Url(parts[2]);
  } catch {
    return null;
  }
  const authentic = await crypto.subtle
    .verify('HMAC', await hmacKey(secret), signature, encoder.encode(`${parts[0]}.${parts[1]}`))
    .catch(() => false);
  if (!authentic) return null;
  let payload;
  try {
    payload = JSON.parse(decoder.decode(fromBase64Url(parts[1])));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.uid !== 'string' || !/^[-a-zA-Z0-9]{1,100}$/.test(payload.uid)) return null;
  if (!Number.isSafeInteger(payload.epoch) || payload.epoch < 1) return null;
  if (!Number.isSafeInteger(payload.exp) || payload.exp * 1000 <= Date.now()) return null;
  return { uid: payload.uid, epoch: payload.epoch, exp: payload.exp };
}

export function sessionCookie(value, { maxAge = SESSION_DAYS * 86400 } = {}) {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    `Expires=${new Date(Date.now() + maxAge * 1000).toUTCString()}`,
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
  ].join('; ');
}

export function clearedSessionCookie() {
  return sessionCookie('', { maxAge: 0 });
}

export function parseCookie(header, name) {
  if (typeof header !== 'string' || typeof name !== 'string') return '';
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    if (pair.slice(0, index).trim() === name) return decodeURIComponent(pair.slice(index + 1).trim());
  }
  return '';
}

// Only for the login/register POSTs; the header cannot be set cross-origin without a
// preflight, which is the actual CSRF defence the sync endpoint already relies on.
export const AUTH_HEADER = 'x-task-keeper';
export const AUTH_HEADER_VALUE = 'auth-v1';

export function clientAddress(request) {
  return (request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || '').trim().slice(0, 45);
}
