import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  fact: text("fact").notNull(),
  category: text("category", { enum: ["rules", "projects", "references"] }).notNull(),
  tags: text("tags").notNull().default(""),
  timestamp: integer("timestamp").notNull(),
});

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
