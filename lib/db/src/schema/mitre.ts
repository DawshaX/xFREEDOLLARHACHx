import { pgTable, text, jsonb } from "drizzle-orm/pg-core";

export const mitreTechniquesTable = pgTable("mitre_techniques", {
  techniqueId: text("technique_id").primaryKey(),
  name: text("name").notNull(),
  tactic: text("tactic").notNull(),
  description: text("description").notNull(),
  platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
});

export type MitreTechnique = typeof mitreTechniquesTable.$inferSelect;
