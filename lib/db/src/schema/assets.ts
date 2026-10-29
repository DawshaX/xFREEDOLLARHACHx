import { pgTable, uuid, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const assets = pgTable("assets", {
  id:          uuid("id").primaryKey().defaultRandom(),
  name:        text("name").notNull(),
  description: text("description").default(""),
  techStack:   jsonb("tech_stack").$type<string[]>().notNull().default([]),
  domains:     jsonb("domains").$type<string[]>().notNull().default([]),
  ips:         jsonb("ips").$type<string[]>().notNull().default([]),
  category:    text("category").notNull().default("web"),
  criticality: text("criticality").notNull().default("medium"),
  owner:       text("owner").default(""),
  notes:       text("notes").default(""),
  isActive:    boolean("is_active").notNull().default(true),
  tags:        jsonb("tags").$type<string[]>().notNull().default([]),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
