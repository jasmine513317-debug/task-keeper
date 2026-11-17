CREATE TABLE app.tk_users (
 id text PRIMARY KEY,
 email text NOT NULL UNIQUE,
 password_hash text NOT NULL,
 session_epoch integer NOT NULL DEFAULT 1,
 is_admin boolean NOT NULL DEFAULT false,
 created_at text NOT NULL,
 last_login_at text
);
CREATE TABLE app.tk_snapshots (
 user_id text PRIMARY KEY,
 revision integer NOT NULL DEFAULT 0,
 payload text NOT NULL,
 updated_at text NOT NULL
);
CREATE TABLE app.tk_attempts (
 key text PRIMARY KEY,
 failures integer NOT NULL DEFAULT 0,
 window_start text NOT NULL,
 last_attempt text NOT NULL
);
CREATE TABLE app.tk_locks (
 key text PRIMARY KEY,
 owner text NOT NULL,
 taken_at text NOT NULL
);
