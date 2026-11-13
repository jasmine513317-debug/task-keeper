import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const taskSnapshots = sqliteTable('task_snapshots', {
  userId: text('user_id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
});
