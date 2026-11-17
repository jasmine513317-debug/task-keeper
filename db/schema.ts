import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const taskSnapshots = sqliteTable('task_snapshots', {
  userId: text('user_id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// session_epoch is bumped whenever the password changes, so a stolen cookie stops working
// without a server-side session table: tokens carry the epoch they were minted with.
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  sessionEpoch: integer('session_epoch').notNull().default(1),
  isAdmin: integer('is_admin').notNull().default(0),
  createdAt: text('created_at').notNull(),
  lastLoginAt: text('last_login_at'),
});

// Failure counters bucketed by window, so a window simply rolls over instead of expiring rows.
export const authAttempts = sqliteTable('auth_attempts', {
  key: text('key').primaryKey(),
  failures: integer('failures').notNull().default(0),
  windowStart: text('window_start').notNull(),
  lastAttempt: text('last_attempt').notNull(),
});
