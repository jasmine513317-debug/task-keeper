import { acceptsAuthRequest, json, logoutCookie } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Clearing the cookie needs no database, but it still must not be triggerable cross-site.
  if (!acceptsAuthRequest(request)) return json({ error: 'invalid_request', message: '请求来源无效，请刷新页面后重试' }, 403);
  return json({ ok: true }, 200, logoutCookie());
}
