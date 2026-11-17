import { env } from 'cloudflare:workers';
import {
  clientIp,
  hashPassword,
  json,
  newUserId,
  normalizeEmail,
  noteRegisterFailure,
  passwordIterations,
  passwordProblem,
  readJsonBody,
  registerBlocked,
  requestRejected,
  sessionCookieFor,
  text,
} from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rejected = requestRejected(request);
  if (rejected) return rejected;

  const body = await readJsonBody(request);
  if (!body) return json({ error: 'invalid_json', message: '无法解析请求内容' }, 400);

  // The SPA sends it; a human filling the form never sees it. Cheap bot filter, not a defence.
  if (text(body, 'website')) return json({ error: 'spam', message: '注册未能完成' }, 400);

  const email = normalizeEmail(text(body, 'email'));
  const password = text(body, 'password');
  const ip = clientIp(request);
  if (!email) return json({ error: 'invalid_email', message: '请填写有效的邮箱地址' }, 400);
  const problem = passwordProblem(password, email);
  if (problem) return json({ error: 'weak_password', message: problem }, 400);

  if (await registerBlocked(ip)) {
    return json({ error: 'too_many_attempts', message: '本机注册尝试过多，请一小时后再试' }, 429);
  }

  const id = newUserId();
  const at = new Date().toISOString();
  const hash = await hashPassword(password, passwordIterations());
  try {
    // One atomic batch: the row count seen by the follow-up statements already includes this
    // insert, so exactly one racing first registration can claim the admin flag and the
    // snapshots left behind by the previous ChatGPT identity.
    await env.DB!.batch([
      env.DB!.prepare('INSERT INTO users (id, email, password_hash, session_epoch, is_admin, created_at, last_login_at) VALUES (?, ?, ?, 1, 0, ?, ?)').bind(id, email, hash, at, at),
      env.DB!.prepare('UPDATE users SET is_admin = 1 WHERE id = ? AND (SELECT COUNT(*) FROM users) = 1').bind(id),
      env.DB!.prepare('UPDATE task_snapshots SET user_id = ? WHERE (SELECT COUNT(*) FROM users) = 1 AND user_id <> ?').bind(id, id),
    ]);
  } catch {
    await noteRegisterFailure(ip);
    const taken = await env.DB!.prepare('SELECT 1 AS hit FROM users WHERE email = ?').bind(email).first();
    return taken
      ? json({ error: 'email_taken', message: '这个邮箱已经注册过，请直接登录' }, 409)
      : json({ error: 'storage_unavailable', message: '账号服务暂不可用，请稍后再试' }, 503);
  }

  const cookie = await sessionCookieFor({ id, sessionEpoch: 1 });
  return json({ user: { id, email } }, 201, cookie);
}
