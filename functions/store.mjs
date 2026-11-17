// Data access for the Sites database. The SDK speaks PostgREST predicates rather than SQL,
// so one call is one request: there is no atomic increment and no multi-row transaction.
// The three places where the Workers build used a D1 batch are re-expressed here as a
// unique-key claim (first account), a revision predicate (sync) or an epoch compare-and-set
// (password change).

const USERS = 'tk_users';
const SNAPSHOTS = 'tk_snapshots';
const ATTEMPTS = 'tk_attempts';
const LOCKS = 'tk_locks';
const FIRST_ACCOUNT = 'first-account';
const USER_FIELDS = 'id,email,password_hash,session_epoch,is_admin';

// Fixed buckets, so an exhausted window rolls over by itself and the table needs no sweeper.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const LOGIN_LIMIT_PER_EMAIL = 8;
// Deliberately loose: a class shares one school egress IP, and the per-email counter is what
// actually slows down anyone guessing a specific account.
const FAILURE_LIMIT_PER_IP = 200;
const REGISTER_LIMIT_PER_IP = 60;

const emailKey = (email) => `login|e|${email}`;
const ipKey = (ip) => `login|i|${ip}`;
const registerKey = (ip) => `register|i|${ip}`;
const bucketStart = (windowMs) => new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();

export function createStore(db) {
  const table = (name) => db.from(name);
  // Reads throw so every route falls into the same 503, but an insert whose failure the
  // caller has to interpret (a taken email, a lost first-account claim) returns the raw
  // {data, error} pair instead.
  const list = async (builder) => {
    const result = await builder;
    if (result.error) throw result.error;
    return result.data ?? [];
  };
  const head = async (builder) => (await list(builder))[0] ?? null;
  const one = async (builder) => {
    const result = await builder;
    return { rows: result.error ? [] : (result.data ?? []), error: result.error ?? null };
  };
  const count = async (key, windowMs) => {
    const row = await head(table(ATTEMPTS).select('failures,window_start').eq('key', key).limit(1));
    if (!row || row.window_start !== bucketStart(windowMs)) return 0;
    return Number(row.failures) || 0;
  };
  // A counter is advisory, so a lost write under a race is tolerated instead of retried: the
  // next failure reads the stored number again.
  const bump = async (key, windowMs) => {
    const windowStart = bucketStart(windowMs);
    const at = new Date().toISOString();
    const row = await head(table(ATTEMPTS).select('failures,window_start').eq('key', key).limit(1));
    const stored = row && row.window_start === windowStart ? Number(row.failures) || 0 : null;
    if (row) {
      await table(ATTEMPTS).update({ failures: stored + 1, window_start: windowStart, last_attempt: at }).eq('key', key);
      return;
    }
    await table(ATTEMPTS).insertIfAbsent({ key, failures: 1, window_start: windowStart, last_attempt: at }, { onConflict: 'key' });
  };

  return {
    userByEmail: (email) => head(table(USERS).select(USER_FIELDS).eq('email', email).limit(1)),
    userById: (id) => head(table(USERS).select(USER_FIELDS).eq('id', id).limit(1)),
    insertUser: (row) => one(table(USERS).insert(row).select('id')),
    emailTaken: (email) => head(table(USERS).select('id').eq('email', email).limit(1)),
    touchLogin: (id, at) => list(table(USERS).update({ last_login_at: at }).eq('id', id).select('id')),
    setPasswordHash: (id, hash) => list(table(USERS).update({ password_hash: hash }).eq('id', id).select('id')),
    becomeAdmin: (id) => list(table(USERS).update({ is_admin: true }).eq('id', id).select('id')),
    // Replaces `session_epoch = session_epoch + 1`: the caller read this row moments ago and
    // the write only lands while that epoch is still stored, so a racing change is refused.
    setPassword: (id, hash, epoch) => list(
      table(USERS).update({ password_hash: hash, session_epoch: epoch + 1 }).eq('id', id).eq('session_epoch', epoch).select('id'),
    ),
    // Exactly one registration can insert this row, which is how the first account is picked
    // without counting users.
    claimFirstAccount: (owner, at) => one(table(LOCKS).insertIfAbsent({ key: FIRST_ACCOUNT, owner, taken_at: at }, { onConflict: 'key' }).select('owner')),

    snapshot: (userId) => head(table(SNAPSHOTS).select('revision,payload,updated_at').eq('user_id', userId).limit(1)),
    replaceSnapshot: (userId, revision, payload, at) => list(
      table(SNAPSHOTS).update({ revision: revision + 1, payload, updated_at: at }).eq('user_id', userId).eq('revision', revision).select('revision'),
    ),
    createSnapshot: (userId, payload, at) => one(
      table(SNAPSHOTS).insertIfAbsent({ user_id: userId, revision: 1, payload, updated_at: at }, { onConflict: 'user_id' }).select('revision'),
    ),

    loginBlocked: async (email, ip) => {
      if ((await count(emailKey(email), LOGIN_WINDOW_MS)) >= LOGIN_LIMIT_PER_EMAIL) return true;
      return !!ip && (await count(ipKey(ip), LOGIN_WINDOW_MS)) >= FAILURE_LIMIT_PER_IP;
    },
    registerBlocked: async (ip) => !!ip && (await count(registerKey(ip), REGISTER_WINDOW_MS)) >= REGISTER_LIMIT_PER_IP,
    noteLoginFailure: async (email, ip) => {
      await bump(emailKey(email), LOGIN_WINDOW_MS);
      if (ip) await bump(ipKey(ip), LOGIN_WINDOW_MS);
    },
    noteRegisterFailure: async (ip) => { if (ip) await bump(registerKey(ip), REGISTER_WINDOW_MS); },
    // A successful login proves this address/IP pair, so its guess counters start over. The
    // registration counter stays: one proven password must not buy quota to open more accounts.
    clearLoginFailures: (email, ip) => Promise.all(
      [emailKey(email), ...(ip ? [ipKey(ip)] : [])].map((key) => list(table(ATTEMPTS).delete().eq('key', key))),
    ),
  };
}
