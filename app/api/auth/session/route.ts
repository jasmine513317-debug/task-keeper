import { currentUser, json, servicesUnavailable } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const unavailable = servicesUnavailable();
  if (unavailable) return unavailable;
  const user = await currentUser(request);
  if (!user) return json({ error: 'login_required', message: '请先登录' }, 401);
  return json({ user: { id: user.id, email: user.email, isAdmin: user.isAdmin } });
}
