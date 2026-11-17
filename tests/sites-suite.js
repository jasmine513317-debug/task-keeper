// Cases for the Qoder Sites port in functions/. The platform database SDK speaks PostgREST
// predicates instead of SQL, so fakeDb below models that surface — chained builders, one call
// per request, no atomic increment and no transactions — while functions/routes.mjs and
// functions/store.mjs run unchanged against it.
//
// Passing proves the ported route contracts. It does not prove the platform SDK, the Gateway's
// header rules, Postgres constraints or a real Deno isolate behave the same way; those are
// checked against the deployed Function.

const SECRET = 'test-secret-0123456789abcdef-0123456789abcdef';
const ORIGIN = 'https://task-keeper.qoder.site/functions/v1/app';
const ACCOUNT = { email: 'zhang@example.edu.cn', password: 'class-2026-keeper' };
const OTHER = { email: 'li@example.edu.cn', password: 'class-2026-keeper' };
const VALID = { tasks: [{ id: 'a', title: '高等数学作业', status: 'pending' }], sources: ['课程群'], profile: {} };

export function fakeDb() {
  const data = { tk_users: [], tk_snapshots: [], tk_attempts: [], tk_locks: [] };
  const unique = { tk_users: ['id', 'email'], tk_snapshots: ['user_id'], tk_attempts: ['key'], tk_locks: ['key'] };
  const hooks = { before: null };
  const project = (row, columns) => {
    if (!columns || columns === '*') return { ...row };
    const out = {};
    for (const column of columns.split(',')) out[column.trim()] = row[column.trim()];
    return out;
  };
  const clashes = (table, row, columns) =>
    columns.some((group) => data[table].some((stored) => group.split(',').every((column) =>
      stored[column.trim()] === row[column.trim()])));

  return {
    data,
    hooks,
    from(table) {
      const state = { mode: 'select', columns: '*', returning: null, filters: [], payload: null, onConflict: null, limit: 0 };
      const matched = () => data[table].filter((row) =>
        state.filters.every(([key, value]) => row[key] === value));
      const builder = {
        select: (columns = '*') => {
          if (state.mode === 'select') state.columns = columns;
          else state.returning = columns;
          return builder;
        },
        eq: (key, value) => {
          state.filters.push([key, value]);
          return builder;
        },
        limit: (count) => {
          state.limit = count;
          return builder;
        },
        order: () => builder,
        insert: (row) => {
          state.mode = 'insert';
          state.payload = row;
          return builder;
        },
        insertIfAbsent: (row, options) => {
          state.mode = 'insertIfAbsent';
          state.payload = row;
          state.onConflict = options?.onConflict || null;
          return builder;
        },
        update: (patch) => {
          state.mode = 'update';
          state.payload = patch;
          return builder;
        },
        delete: () => {
          state.mode = 'delete';
          return builder;
        },
        then: (resolve, reject) =>
          Promise.resolve().then(() => {
            const forced = hooks.before?.(table, state);
            if (forced) return { data: null, error: forced };
            if (state.mode === 'select') {
              const rows = matched().slice(0, state.limit || undefined).map((row) => project(row, state.columns));
              return { data: rows, error: null };
            }
            if (state.mode === 'insert' || state.mode === 'insertIfAbsent') {
              const groups = state.onConflict ? [state.onConflict] : unique[table];
              if (clashes(table, state.payload, groups)) {
                return state.mode === 'insert'
                  ? { data: null, error: { code: '23505', message: 'duplicate key value' } }
                  : { data: [], error: null };
              }
              data[table].push({ ...state.payload });
              return { data: [project(state.payload, state.returning)], error: null };
            }
            if (state.mode === 'update') {
              const rows = matched();
              for (const row of rows) Object.assign(row, state.payload);
              return { data: rows.map((row) => project(row, state.returning)), error: null };
            }
            const removed = matched();
            data[table] = data[table].filter((row) => !removed.includes(row));
            return { data: removed.map((row) => project(row, state.returning)), error: null };
          }).then(resolve, reject),
      };
      return builder;
    },
  };
}

export function buildSitesCases(assert, { application, SitesCore, readText }) {
  const cases = [];
  const test = (name, fn) => cases.push({ name, fn });
  const show = (value) => {
    try { return JSON.stringify(value); } catch { return String(value); }
  };

  function world({ secret = SECRET, iterations = '1000', ...options } = {}) {
    const db = fakeDb();
    const env = new Map([['AUTH_SECRET', secret], ['AUTH_PBKDF2_ITERATIONS', iterations]]);
    const handle = application({ db, env, ...options });
    // A browser realm silently drops Cookie and Sec-Fetch-Site off a Request and Set-Cookie off
    // a Response, and refuses to let a test declare a Content-Length. So the harness hands the
    // routes the same surface Deno does — url, method, headers.get, a streamed body — and
    // records the Set-Cookie the route asked for instead of reading it back off the response.
    const encoder = new TextEncoder();
    const requestOf = (method, path, { body, cookie = '', headers = {}, ip = '', declared } = {}) => {
      const text = body === undefined ? null : show(body);
      const bytes = text === null ? null : encoder.encode(text);
      const given = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
      const list = new Map(Object.entries({
        'x-task-keeper': method === 'POST' ? 'auth-v1' : 'sync-v1',
        ...(text === null ? {} : { 'content-type': 'application/json' }),
        ...given,
        ...(ip ? { 'x-forwarded-for': ip } : {}),
        ...(cookie ? { cookie } : {}),
        ...(bytes === null ? {} : { 'content-length': String(declared === undefined ? bytes.byteLength : declared) }),
      }).map(([key, value]) => [key.toLowerCase(), String(value)]));
      return {
        url: `${ORIGIN}${path}`,
        method,
        headers: { get: (key) => (list.has(String(key).toLowerCase()) ? list.get(String(key).toLowerCase()) : null) },
        body: bytes === null ? null : {
          getReader: () => {
            let handed = false;
            return {
              async read() {
                if (handed) return { done: true, value: undefined };
                handed = true;
                return { done: false, value: bytes };
              },
              async cancel() {
                handed = true;
              },
              releaseLock() {},
            };
          },
        },
      };
    };
    const call = async (method, path, options = {}) => {
      const request = requestOf(method, path, options);
      const issued = [];
      const original = Response.json;
      Response.json = (body, init) => {
        const value = init?.headers?.['Set-Cookie'] || init?.headers?.['set-cookie'];
        if (value) issued.push(value);
        return original.call(Response, body, init);
      };
      let response;
      try {
        response = await handle({ request }, request);
      } finally {
        Response.json = original;
      }
      const text = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
      const cookie = issued[0] || '';
      return { status: response.status, body: parsed, cookie, value: cookie.split(';')[0], cookies: issued };
    };
    const register = (account = ACCOUNT, options) => call('POST', '/api/auth/register', { body: account, ...options });
    const login = (account = ACCOUNT, options) => call('POST', '/api/auth/login', { body: account, ...options });
    const write = (revision, state, cookie, options) => call('PUT', '/api/sync', { body: { revision, state }, cookie, ...options });
    return { db, env, call, register, login, write };
  }

  // ------------------------------------------------------------- route surface
  test('sites: health answers without credentials', async () => {
    const w = world();
    const health = await w.call('GET', '/api/health');
    assert.equal(health.status, 200);
    assert.ok(health.body.ok === true);
    const missing = await w.call('GET', '/api/nothing-here');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'not_found');
    const wrongVerb = await w.call('POST', '/api/auth/session', { body: {} });
    assert.equal(wrongVerb.status, 404);
  });

  test('sites: anonymous reads and unguarded writes are refused', async () => {
    const w = world();
    const session = await w.call('GET', '/api/auth/session');
    assert.equal(session.status, 401);
    assert.equal(session.body.error, 'login_required');
    const read = await w.call('GET', '/api/sync');
    assert.equal(read.status, 401);
    const put = await w.write(0, VALID, '', { headers: { 'x-task-keeper': 'auth-v1' } });
    assert.equal(put.status, 403);
    assert.equal(put.body.error, 'invalid_request');
  });

  test('sites: registration input is validated before anything is stored', async () => {
    const w = world();
    const spam = await w.register({ ...ACCOUNT, website: 'http://spam.example' });
    assert.equal(spam.status, 400);
    assert.equal(spam.body.error, 'spam');
    const email = await w.register({ email: 'not-an-email', password: ACCOUNT.password });
    assert.equal(email.status, 400);
    assert.equal(email.body.error, 'invalid_email');
    const weak = await w.register({ email: ACCOUNT.email, password: 'short' });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.error, 'weak_password');
    const prefix = await w.register({ email: ACCOUNT.email, password: ACCOUNT.email.split('@')[0] });
    assert.equal(prefix.status, 400);
    assert.equal(prefix.body.error, 'weak_password');
    const forged = await w.register(ACCOUNT, { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(forged.status, 403);
    const oversized = await w.register({ email: ACCOUNT.email, password: 'x'.repeat(20000) });
    assert.equal(oversized.status, 400);
    assert.equal(oversized.body.error, 'invalid_json');
    assert.equal(w.db.data.tk_users.length, 0, `nothing should be stored, got ${show(w.db.data.tk_users)}`);
  });

  // ------------------------------------------------------------- accounts
  test('sites: an oversized body is refused before it is buffered', async () => {
    const w = world();
    const created = await w.register();
    const auth = await w.register({ email: 'big@example.edu.cn', password: 'class-2026-keeper' }, { declared: 20 * 1024 });
    assert.equal(auth.status, 400);
    assert.equal(auth.body.error, 'invalid_json', `an oversized auth body gave ${show(auth.body)}`);
    const sync = await w.write(1, VALID, created.value, { declared: 9 * 1024 * 1024 });
    assert.equal(sync.status, 400);
    assert.equal(sync.body.error, 'payload_too_large', `an oversized snapshot gave ${show(sync.body)}`);
  });

  test('sites: the first registrant becomes the administrator', async () => {
    const w = world();
    const created = await w.register();
    assert.equal(created.status, 201);
    assert.ok(created.body.user?.id, `no id in ${show(created.body)}`);
    assert.ok(created.cookie.startsWith('__Host-taskkeeper-session='), `cookie was ${show(created.cookie)}`);
    assert.equal(w.db.data.tk_users[0].is_admin, true);
    assert.equal(w.db.data.tk_snapshots.length, 0, 'registration must not create a snapshot row');
    const session = await w.call('GET', '/api/auth/session', { cookie: created.value });
    assert.equal(session.status, 200);
    assert.equal(session.body.user.email, ACCOUNT.email);
    assert.equal(session.body.user.isAdmin, true);
  });

  test('sites: later registrants are ordinary members', async () => {
    const w = world();
    const first = await w.register();
    const second = await w.register(OTHER);
    assert.equal(second.status, 201);
    assert.equal(w.db.data.tk_users[1].is_admin, false);
    assert.equal(w.db.data.tk_locks.length, 1, `the lock row was claimed twice: ${show(w.db.data.tk_locks)}`);
    assert.equal(w.db.data.tk_locks[0].owner, first.body.user.id);
    const taken = await w.register();
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error, 'email_taken');
  });

  test('sites: a rejected insert distinguishes a taken mailbox from a failure', async () => {
    const w = world();
    await w.register();
    w.db.hooks.before = (table, state) =>
      (table === 'tk_users' && state.mode === 'insert' && state.payload.email === 'ghost@example.edu.cn'
        ? { code: 'XX000', message: 'storage exploded' }
        : null);
    const broken = await w.register({ email: 'ghost@example.edu.cn', password: 'mailbox-in-use-2026' });
    assert.equal(broken.status, 503);
    assert.equal(broken.body.error, 'storage_unavailable');
    assert.equal(w.db.data.tk_locks.length, 1, 'a failed registration must not claim the administrator lock');
    const known = await w.register();
    assert.equal(known.status, 409);
    assert.equal(known.body.error, 'email_taken');
  });

  test('sites: cookies that were not signed here are refused', async () => {
    const w = world();
    const created = await w.register();
    const forged = await w.call('GET', '/api/auth/session', { cookie: 'v1.eyJ1aWQiOiJhIn0.deadbeef' });
    assert.equal(forged.status, 401);
    const tampered = await w.call('GET', '/api/auth/session', { cookie: `${created.value.slice(0, created.value.lastIndexOf('.'))}.deadbeef` });
    assert.equal(tampered.status, 401);
    const otherSite = await w.call('GET', '/api/auth/session', { cookie: created.value.replace('taskkeeper', 'taskkeeperx') });
    assert.equal(otherSite.status, 401);
  });

  test('sites: no session secret means no account service', async () => {
    const w = world({ secret: '' });
    const session = await w.call('GET', '/api/auth/session');
    assert.equal(session.status, 503);
    assert.equal(session.body.error, 'config_unavailable');
    const login = await w.login();
    assert.equal(login.status, 503);
    assert.equal(login.body.error, 'config_unavailable');
  });

  // ------------------------------------------------------------- login
  test('sites: a wrong password and an unknown mailbox answer the same way', async () => {
    const w = world();
    await w.register();
    const wrong = await w.login({ email: ACCOUNT.email, password: 'wrong-password-here' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, 'invalid_credentials');
    const unknown = await w.login({ email: 'nobody@example.edu.cn', password: 'wrong-password-here' });
    assert.equal(unknown.status, 401);
    assert.deepEqual(Object.keys(unknown.body).sort(), Object.keys(wrong.body).sort());
    const keys = w.db.data.tk_attempts.map((row) => row.key);
    assert.ok(keys.includes(`login|e|nobody@example.edu.cn`), `counters were ${show(keys)}`);
  });

  test('sites: the ninth try on one mailbox is throttled', async () => {
    const w = world();
    await w.register();
    let last;
    for (let i = 0; i < 8; i += 1) last = await w.login({ email: ACCOUNT.email, password: 'wrong-password-here' }, { ip: '203.0.113.7' });
    assert.equal(last.status, 401);
    const blocked = await w.login({ email: ACCOUNT.email, password: 'wrong-password-here' }, { ip: '203.0.113.7' });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'too_many_attempts');
    const row = w.db.data.tk_attempts.find((attempt) => attempt.key === `login|e|${ACCOUNT.email}`);
    assert.equal(row.failures, 8, `counter was ${show(row)}`);
    const keys = w.db.data.tk_attempts.map((attempt) => attempt.key);
    assert.ok(keys.includes('login|i|203.0.113.7'), `address counter missing in ${show(keys)}`);
    const proven = await w.login();
    assert.equal(proven.status, 429, 'the window refuses a correct password too, which is the point of the counter');
    assert.equal((await w.register(OTHER)).status, 201);
    for (let i = 0; i < 2; i += 1) await w.login({ email: OTHER.email, password: 'wrong-password-here' });
    assert.ok(w.db.data.tk_attempts.some((attempt) => attempt.key === `login|e|${OTHER.email}`), 'two failures should be counted');
    const cleared = await w.login(OTHER);
    assert.equal(cleared.status, 200);
    assert.ok(!w.db.data.tk_attempts.some((attempt) => attempt.key === `login|e|${OTHER.email}`), 'a proven password clears its own counter');
  });

  test('sites: registration attempts are capped per address', async () => {
    const w = world();
    const ip = '198.51.100.9';
    assert.equal((await w.register(ACCOUNT, { ip })).status, 201);
    let last;
    for (let i = 0; i < 60; i += 1) last = await w.register(ACCOUNT, { ip });
    assert.equal(last.status, 409, `the loop ended on ${show(last.body)}`);
    const row = w.db.data.tk_attempts.find((attempt) => attempt.key === `register|i|${ip}`);
    assert.equal(row.failures, 60, `counter was ${show(row)}`);
    const blocked = await w.register(OTHER, { ip });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'too_many_attempts');
    const elsewhere = await w.register(OTHER, { ip: '198.51.100.10' });
    assert.equal(elsewhere.status, 201, `a different address should still register: ${show(elsewhere.body)}`);
  });

  test('sites: a proven password lifts the hash to the configured cost', async () => {
    const w = world();
    await w.register();
    const before = w.db.data.tk_users[0].password_hash;
    assert.ok(before.startsWith('pbkdf2-sha256$1000$'), `seed hash was ${before.slice(0, 24)}`);
    w.env.set('AUTH_PBKDF2_ITERATIONS', '1500');
    const again = await w.login();
    assert.equal(again.status, 200);
    const after = w.db.data.tk_users[0].password_hash;
    assert.ok(after.startsWith('pbkdf2-sha256$1500$'), `hash stayed ${after.slice(0, 24)}`);
    const stillWorks = await w.login();
    assert.equal(stillWorks.status, 200);
  });

  test('sites: logout needs the same guard as login', async () => {
    const w = world();
    await w.register();
    const open = await w.call('POST', '/api/auth/logout', { body: {} });
    assert.equal(open.status, 200);
    assert.ok(open.cookie.includes('Max-Age=0'), `cookie was ${show(open.cookie)}`);
    const blind = await w.call('POST', '/api/auth/logout', { body: {}, headers: { 'x-task-keeper': 'none' } });
    assert.equal(blind.status, 403);
  });

  // ------------------------------------------------------------- sync
  test('sites: a snapshot is read, stamped and advanced', async () => {
    const w = world();
    const created = await w.register();
    const empty = await w.call('GET', '/api/sync', { cookie: created.value });
    assert.equal(empty.status, 200);
    assert.equal(empty.body.revision, 0);
    assert.equal(empty.body.state, null);
    assert.equal(empty.body.user.name, ACCOUNT.email, `sync should name the account: ${show(empty.body.user)}`);
    const first = await w.write(0, VALID, created.value);
    assert.equal(first.status, 200, `first write gave ${show(first.body)}`);
    assert.equal(first.body.revision, 1);
    assert.equal(w.db.data.tk_snapshots.length, 1);
    const reread = await w.call('GET', '/api/sync', { cookie: created.value });
    assert.deepEqual(reread.body.state, VALID);
    const stale = await w.write(7, VALID, created.value);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'revision_conflict');
    assert.equal(stale.body.revision, 1);
    assert.deepEqual(stale.body.state, VALID);
    const merged = { ...VALID, tasks: [{ id: 'a', title: '改过的标题', status: 'pending' }] };
    const next = await w.write(1, merged, created.value);
    assert.equal(next.status, 200);
    assert.equal(next.body.revision, 2);
    assert.equal(w.db.data.tk_snapshots[0].revision, 2);
  });

  test('sites: an unsafe snapshot payload never reaches storage', async () => {
    const w = world();
    const created = await w.register();
    await w.write(0, VALID, created.value);
    const rejected = [
      ['no tasks', { sources: [], profile: {} }],
      ['too many tasks', { tasks: Array.from({ length: 10001 }, (_, i) => ({ id: `t${i}`, title: 'x', status: 'todo' })), sources: [], profile: {} }],
      ['duplicate ids', { tasks: [{ id: 'a', title: 'x', status: 'todo' }, { id: 'a', title: 'y', status: 'todo' }], sources: [], profile: {} }],
      ['id with a space', { tasks: [{ id: 'a b', title: 'x', status: 'todo' }], sources: [], profile: {} }],
      ['blank title', { tasks: [{ id: 'a', title: '   ', status: 'todo' }], sources: [], profile: {} }],
      ['unknown status', { tasks: [{ id: 'a', title: 'x', status: 'archived' }], sources: [], profile: {} }],
      ['too many sources', { tasks: [], sources: Array.from({ length: 301 }, (_, i) => `s${i}`), profile: {} }],
      ['source too long', { tasks: [], sources: ['x'.repeat(81)], profile: {} }],
      ['no profile', { tasks: [], sources: [] }],
    ];
    for (const [label, state] of rejected) {
      const response = await w.write(1, state, created.value);
      assert.equal(response.status, 400, `${label} gave ${response.status} ${show(response.body)}`);
      assert.equal(response.body.error, 'invalid_state', `${label} gave ${show(response.body)}`);
    }
    assert.equal((await w.write(-1, VALID, created.value)).body.error, 'invalid_state');
    assert.equal((await w.write('1', VALID, created.value)).body.error, 'invalid_state');
    const notObject = await w.call('PUT', '/api/sync', { body: ['tasks'], cookie: created.value });
    assert.equal(notObject.status, 400);
    assert.equal(notObject.body.error, 'invalid_json');
    assert.equal(w.db.data.tk_snapshots[0].revision, 1, 'rejected writes must not advance the revision');
  });

  test('sites: each account keeps its own snapshot', async () => {
    const w = world();
    const first = await w.register();
    await w.write(0, VALID, first.value);
    const second = await w.register(OTHER);
    const own = await w.call('GET', '/api/sync', { cookie: second.value });
    assert.equal(own.body.revision, 0);
    const stamped = await w.write(0, { ...VALID, tasks: [{ id: 'b', title: '另一个人的事项', status: 'todo' }] }, second.value);
    assert.equal(stamped.status, 200);
    assert.equal(w.db.data.tk_snapshots.length, 2);
    assert.equal(w.db.data.tk_snapshots[0].user_id, first.body.user.id);
    const crossSite = await w.write(2, VALID, first.value, { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(crossSite.status, 403);
  });

  test('sites: a storage failure is reported without provider detail', async () => {
    const w = world();
    const created = await w.register();
    w.db.hooks.before = (table) => (table === 'tk_snapshots' ? { code: 'PGRST301', message: 'signed url?secret=leak' } : null);
    const read = await w.call('GET', '/api/sync', { cookie: created.value });
    assert.equal(read.status, 503);
    assert.equal(read.body.error, 'storage_unavailable');
    assert.equal(read.body.message, undefined, `the sync read leaked ${show(read.body)}`);
    const write = await w.write(0, VALID, created.value);
    assert.equal(write.status, 503);
    assert.ok(!show(write.body).includes('leak'), `detail leaked: ${show(write.body)}`);
    w.db.hooks.before = (table) => (table === 'tk_users' ? { code: 'XX000', message: 'users down' } : null);
    const login = await w.login();
    assert.equal(login.status, 503);
    assert.equal(login.body.error, 'storage_unavailable');
  });

  // ------------------------------------------------------------- password lifecycle
  test('sites: changing a password retires every session', async () => {
    const w = world();
    const created = await w.register();
    await w.write(0, VALID, created.value);
    const wrong = await w.call('POST', '/api/auth/password', { body: { currentPassword: 'nope', newPassword: 'another-good-password' }, cookie: created.value });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.error, 'wrong_password');
    const same = await w.call('POST', '/api/auth/password', { body: { currentPassword: ACCOUNT.password, newPassword: ACCOUNT.password }, cookie: created.value });
    assert.equal(same.status, 400);
    assert.equal(same.body.error, 'same_password');
    const weak = await w.call('POST', '/api/auth/password', { body: { currentPassword: ACCOUNT.password, newPassword: 'weak' }, cookie: created.value });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.error, 'weak_password');
    assert.equal(w.db.data.tk_users[0].session_epoch, 1, 'a refused change must not retire sessions');
    const changed = await w.call('POST', '/api/auth/password', { body: { currentPassword: ACCOUNT.password, newPassword: 'a-brand-new-keeper' }, cookie: created.value });
    assert.equal(changed.status, 200, `change gave ${show(changed.body)}`);
    assert.ok(changed.cookie.includes('Max-Age=0'), `cookie was ${show(changed.cookie)}`);
    assert.equal(w.db.data.tk_users[0].session_epoch, 2);
    assert.equal((await w.call('GET', '/api/auth/session', { cookie: created.value })).status, 401);
    assert.equal((await w.write(1, VALID, created.value)).status, 401);
    const renewed = await w.login({ email: ACCOUNT.email, password: 'a-brand-new-keeper' });
    assert.equal(renewed.status, 200);
    assert.equal((await w.call('GET', '/api/sync', { cookie: renewed.value })).body.revision, 1);
  });

  test('sites: a lost compare-and-set on the epoch is a service problem', async () => {
    const w = world();
    const created = await w.register();
    w.db.hooks.before = (table, state) =>
      (table === 'tk_users' && state.mode === 'update' && 'session_epoch' in state.payload
        ? { code: 'PGRST116', message: 'the epoch moved on' }
        : null);
    const changed = await w.call('POST', '/api/auth/password', { body: { currentPassword: ACCOUNT.password, newPassword: 'a-brand-new-keeper' }, cookie: created.value });
    assert.equal(changed.status, 503);
    assert.equal(changed.body.error, 'storage_unavailable');
    assert.equal(w.db.data.tk_users[0].session_epoch, 1);
  });

  test('sites: an administrator resets a forgotten password', async () => {
    const w = world();
    const owner = await w.register();
    const member = await w.register(OTHER);
    const ghost = await w.call('POST', '/api/auth/admin/reset', { body: { email: 'ghost@example.edu.cn', newPassword: 'reset-by-owner-2026' }, cookie: owner.value });
    assert.equal(ghost.status, 404);
    assert.equal(ghost.body.error, 'no_such_user');
    const notAdmin = await w.call('POST', '/api/auth/admin/reset', { body: { email: ACCOUNT.email, newPassword: 'reset-by-owner-2026' }, cookie: member.value });
    assert.equal(notAdmin.status, 403);
    assert.equal(notAdmin.body.error, 'admin_required');
    const weak = await w.call('POST', '/api/auth/admin/reset', { body: { email: OTHER.email, newPassword: 'weak' }, cookie: owner.value });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.error, 'weak_password');
    const reset = await w.call('POST', '/api/auth/admin/reset', { body: { email: OTHER.email, newPassword: 'reset-by-owner-2026' }, cookie: owner.value });
    assert.equal(reset.status, 200, `reset gave ${show(reset.body)}`);
    assert.equal(w.db.data.tk_users[1].session_epoch, 2);
    assert.equal((await w.call('GET', '/api/auth/session', { cookie: member.value })).status, 401, 'the reset must retire that account sessions');
    assert.equal((await w.login({ email: OTHER.email, password: 'class-2026-keeper' })).status, 401);
    assert.equal((await w.login({ email: OTHER.email, password: 'reset-by-owner-2026' })).status, 200);
  });

  // ------------------------------------------------------------- shared primitives
  test('sites: the function runs on the same primitives as the workers build', async () => {
    const copied = (await readText('functions/auth-core.mjs')).trim();
    const original = (await readText('lib/auth-core.js')).trim();
    assert.equal(copied, original, 'functions/auth-core.mjs must stay a byte copy of lib/auth-core.js');
    const token = await SitesCore.signSession({ uid: 'u1', epoch: 1, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
    assert.deepEqual(await SitesCore.readSession(token, SECRET), { uid: 'u1', epoch: 1, exp: JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp });
    assert.equal(await SitesCore.readSession(token, 'another-secret-0123456789abcdef'), null, 'a different secret must not verify');
    const hash = await SitesCore.hashPassword('class-2026-keeper', 1000);
    assert.ok(await SitesCore.verifyPassword('class-2026-keeper', hash));
    assert.ok(!(await SitesCore.verifyPassword('class-2026-keepeR', hash)));
  });

  return cases;
}
