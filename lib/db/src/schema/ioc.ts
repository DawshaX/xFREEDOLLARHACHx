import { pgTable, uuid, text, timestamp, boolean, doublePrecision, jsonb } from "drizzle-orm/pg-core";

export const iocTracker = pgTable("ioc_tracker", {
  id:          uuid("id").primaryKey().defaultRandom(),
  iocType:     text("ioc_type").notNull(),
  value:       text("value").notNull(),
  source:      text("source").notNull().default("manual"),
  confidence:  doublePrecision("confidence").notNull().default(0.8),
  severity:    text("severity").notNull().default("medium"),
  description: text("description").default(""),
  relatedCves: jsonb("related_cves").$type<string[]>().notNull().default([]),
  tags:        jsonb("tags").$type<string[]>().notNull().default([]),
  isActive:    boolean("is_active").notNull().default(true),
  isVerified:  boolean("is_verified").notNull().default(false),
  firstSeen:   timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  lastSeen:    timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  expiresAt:   timestamp("expires_at", { withTimezone: true }),
});

export type IocEntry = typeof iocTracker.$inferSelect;
export type NewIocEntry = typeof iocTracker.$inferInsert;
