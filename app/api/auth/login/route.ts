import { env } from 'cloudflare:workers';
import {
  clearAuthFailures,
  clientIp,
  burnPasswordTime,
  hashPassword,
  invalidCredentials,
  json,
  loginBlocked,
  noteLoginFailure,
  normalizeEmail,
  passwordIterations,
  readJsonBody,
  requestRejected,
  sessionCookieFor,
  storedIterations,
  text,
  verifyPassword,
} from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

type Row = { id: string; email: string; password_hash: string; session_epoch: number };

export async function POST(request: Request) {
  const rejected = requestRejected(request);
  if (rejected) return rejected;

  const body = await readJsonBody(request);
  if (!body) return json({ error: 'invalid_json', message: '无法解析请求内容' }, 400);

  const email = normalizeEmail(text(body, 'email'));
  const password = text(body, 'password');
  const ip = clientIp(request);
  if (!email || !password) return invalidCredentials();

  if (await loginBlocked(email, ip)) {
    return json({ error: 'too_many_attempts', message: '尝试次数过多，请 15 分钟后再试' }, 429);
  }

  let row: Row | null = null;
  try {
    row = await env.DB!.prepare('SELECT id, email, password_hash, session_epoch FROM users WHERE email = ?')
      .bind(email)
      .first<Row>();
  } catch {
    return json({ error: 'storage_unavailable', message: '账号服务暂不可用，请稍后再试' }, 503);
  }

  // Hash a throwaway password when the address is unknown so both failures cost the same.
  if (!row) {
    await burnPasswordTime(password);
    await noteLoginFailure(email, ip);
    return invalidCredentials();
  }

  if (!(await verifyPassword(password, row.password_hash))) {
    await noteLoginFailure(email, ip);
    return invalidCredentials();
  }

  await clearAuthFailures(email, ip);

  // Existing accounts move onto the configured cost the next time they prove the password.
  const target = passwordIterations();
  const statements = [
    env.DB!.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id),
  ];
  if (storedIterations(row.password_hash) < target) {
    statements.push(env.DB!.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password, target), row.id));
  }
  await env.DB!.batch(statements).catch(() => undefined);

  const cookie = await sessionCookieFor({ id: row.id, sessionEpoch: row.session_epoch });
  return json({ user: { id: row.id, email: row.email } }, 200, cookie);
}
