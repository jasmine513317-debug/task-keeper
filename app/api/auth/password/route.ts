import { env } from 'cloudflare:workers';
import {
  currentUser,
  hashPassword,
  json,
  logoutCookie,
  passwordIterations,
  passwordProblem,
  readJsonBody,
  requestRejected,
  text,
  verifyPassword,
} from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rejected = requestRejected(request);
  if (rejected) return rejected;
  const user = await currentUser(request);
  if (!user) return json({ error: 'login_required', message: '请先登录' }, 401);

  const body = await readJsonBody(request);
  if (!body) return json({ error: 'invalid_json', message: '无法解析请求内容' }, 400);

  const currentPassword = text(body, 'currentPassword');
  const newPassword = text(body, 'newPassword');

  const row = await env.DB!.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (!row) return json({ error: 'login_required', message: '账号已不存在，请重新登录' }, 401);
  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    return json({ error: 'wrong_password', message: '当前密码不正确' }, 403);
  }
  const problem = passwordProblem(newPassword, user.email);
  if (problem) return json({ error: 'weak_password', message: problem }, 400);
  if (newPassword === currentPassword) return json({ error: 'same_password', message: '新密码与当前密码相同' }, 400);

  // Raising the epoch retires every session issued before this change, including this one,
  // which is how a compromised password gets fully locked out without a session table.
  const hash = await hashPassword(newPassword, passwordIterations());
  await env.DB!.prepare('UPDATE users SET password_hash = ?, session_epoch = session_epoch + 1 WHERE id = ?')
    .bind(hash, user.id)
    .run();

  return json({ ok: true, message: '密码已更新，所有设备都需要重新登录' }, 200, logoutCookie());
}
