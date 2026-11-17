import { env } from 'cloudflare:workers';
import {
  currentUser,
  hashPassword,
  json,
  normalizeEmail,
  passwordIterations,
  passwordProblem,
  readJsonBody,
  requestRejected,
  text,
} from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

// There is no email provider wired up, so a forgotten password is reset by the site owner
// (the first account created) and the person affected has to sign in again afterwards.
export async function POST(request: Request) {
  const rejected = requestRejected(request);
  if (rejected) return rejected;
  const user = await currentUser(request);
  if (!user) return json({ error: 'login_required', message: '请先登录' }, 401);
  if (!user.isAdmin) return json({ error: 'admin_required', message: '只有站点管理员可以重置他人密码' }, 403);

  const body = await readJsonBody(request);
  if (!body) return json({ error: 'invalid_json', message: '无法解析请求内容' }, 400);

  const email = normalizeEmail(text(body, 'email'));
  const newPassword = text(body, 'newPassword');
  if (!email) return json({ error: 'invalid_email', message: '请填写有效的邮箱地址' }, 400);
  const problem = passwordProblem(newPassword, email);
  if (problem) return json({ error: 'weak_password', message: problem }, 400);

  const target = await env.DB!.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!target) return json({ error: 'no_such_user', message: '没有找到这个邮箱对应的账号' }, 404);

  const hash = await hashPassword(newPassword, passwordIterations());
  await env.DB!.prepare('UPDATE users SET password_hash = ?, session_epoch = session_epoch + 1 WHERE id = ?')
    .bind(hash, target.id)
    .run();

  return json({ ok: true, message: `已为 ${email} 设置新密码，该账号需要重新登录` });
}
