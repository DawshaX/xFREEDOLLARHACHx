import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// ============================================================================
// Agent Sessions — long-running conversational sessions for the Live Agent.
// Each session aggregates a list of messages (user / assistant / tool_use / tool_result).
// ============================================================================
export const agentSessions = pgTable("agent_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("جلسة جديدة"),
  status: text("status").notNull().default("active"), // active, paused, ended
  model: text("model").notNull().default("llama3-cyber"),
  provider: text("provider").notNull().default("ollama"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  totalTokens: integer("total_tokens").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentSessionMessages = pgTable("agent_session_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user, assistant, tool_use, tool_result, system
  content: text("content").notNull().default(""),
  toolName: text("tool_name"),
  toolInput: jsonb("tool_input"),
  toolResult: jsonb("tool_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentSession = typeof agentSessions.$inferSelect;
export type AgentSessionMessage = typeof agentSessionMessages.$inferSelect;
