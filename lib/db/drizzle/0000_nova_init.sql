CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"model" text DEFAULT 'dolphin-llama3' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tasks_v2" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"agent" text DEFAULT 'nova' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"output" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_task_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text DEFAULT 'step' NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tool_name" text,
	"tool_input" jsonb,
	"tool_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'جلسة جديدة' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"model" text DEFAULT 'llama3-cyber' NOT NULL,
	"provider" text DEFAULT 'ollama' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"content_base64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cves" (
	"id" text PRIMARY KEY NOT NULL,
	"cve_id" text,
	"cvss_score" double precision,
	"description" text NOT NULL,
	"cvss" double precision DEFAULT 0 NOT NULL,
	"severity" text DEFAULT 'UNKNOWN' NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"last_modified_at" timestamp with time zone,
	"url" text NOT NULL,
	"raw" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'NVD' NOT NULL,
	"exploit_type" text,
	"poc_url" text,
	"poc_verified" boolean DEFAULT false NOT NULL,
	"epss_score" double precision,
	"affected_products" text,
	"cwe_ids" text[],
	"tags" text[],
	"report_status" text,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cve_sync_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"total_fetched" integer DEFAULT 0 NOT NULL,
	"total_available" integer DEFAULT 0 NOT NULL,
	"pages_done" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bot_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"source" text DEFAULT 'bot' NOT NULL,
	"is_read" text DEFAULT 'false' NOT NULL,
	"metadata" text DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_cron_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cron_expression" text NOT NULL,
	"prompt" text NOT NULL,
	"is_enabled" text DEFAULT 'true' NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_status" text DEFAULT '',
	"run_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"memory_type" text NOT NULL,
	"key" text NOT NULL,
	"content" text NOT NULL,
	"context" text DEFAULT '',
	"confidence" double precision DEFAULT 1 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"source_session_id" integer,
	"tags" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbook_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"playbook_id" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"result_summary" text DEFAULT '',
	"triggered_by" text DEFAULT 'user' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbook_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"playbook_id" integer NOT NULL,
	"step_order" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"tool_name" text NOT NULL,
	"tool_input" text DEFAULT '{}' NOT NULL,
	"expected_output" text DEFAULT '',
	"continue_on_error" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"tags" text DEFAULT '' NOT NULL,
	"is_auto_generated" boolean DEFAULT false NOT NULL,
	"source_session_id" integer,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" integer NOT NULL,
	"command" text NOT NULL,
	"stdout" text DEFAULT '' NOT NULL,
	"stderr" text DEFAULT '' NOT NULL,
	"exit_code" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"triggered_by" text DEFAULT 'user' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"username" text DEFAULT 'root' NOT NULL,
	"auth_type" text DEFAULT 'password' NOT NULL,
	"credential" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_pinged_at" timestamp with time zone,
	"os_info" text DEFAULT '',
	"tags" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"result" text DEFAULT 'success' NOT NULL,
	"detail" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"label" text NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cwe" (
	"cwe_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"abstraction" text DEFAULT 'Base' NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installer_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"install_command" text NOT NULL,
	"binary" text NOT NULL,
	"installed" boolean DEFAULT false NOT NULL,
	"version" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cron" text NOT NULL,
	"target" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_status" text DEFAULT 'pending' NOT NULL,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"content" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mitre_techniques" (
	"technique_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tactic" text NOT NULL,
	"description" text NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"target" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shell_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"command" text NOT NULL,
	"stdout" text DEFAULT '' NOT NULL,
	"stderr" text DEFAULT '' NOT NULL,
	"exit_code" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shell_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cwd" text DEFAULT '/tmp' NOT NULL,
	"command_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"url" text NOT NULL,
	"event" text DEFAULT 'all' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#22d3ee' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"chunks" integer DEFAULT 0 NOT NULL,
	"mime_type" text DEFAULT 'text/plain' NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"tech_stack" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text DEFAULT 'web' NOT NULL,
	"criticality" text DEFAULT 'medium' NOT NULL,
	"owner" text DEFAULT '',
	"notes" text DEFAULT '',
	"is_active" boolean DEFAULT true NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" text NOT NULL,
	"target_url" text NOT NULL,
	"cve_id" text DEFAULT '',
	"asset_id" text DEFAULT '',
	"evidence_type" text DEFAULT 'http_response' NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"request" text DEFAULT '',
	"response" text DEFAULT '',
	"payload" text DEFAULT '',
	"proof_text" text DEFAULT '',
	"status_code" text DEFAULT '',
	"response_time" double precision DEFAULT 0,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_false_positive" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"cve_id" text NOT NULL,
	"cvss" double precision DEFAULT 0 NOT NULL,
	"epss_score" double precision DEFAULT 0,
	"is_in_kev" boolean DEFAULT false NOT NULL,
	"has_public_exploit" boolean DEFAULT false NOT NULL,
	"has_poc" boolean DEFAULT false NOT NULL,
	"affected_assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attack_vector" text DEFAULT 'NETWORK',
	"attack_complexity" text DEFAULT 'LOW',
	"risk_score" double precision DEFAULT 0 NOT NULL,
	"risk_label" text DEFAULT 'MEDIUM' NOT NULL,
	"exploitability" double precision DEFAULT 0,
	"impact_score" double precision DEFAULT 0,
	"ai_summary" text DEFAULT '',
	"ai_target" text DEFAULT '',
	"ai_payload" text DEFAULT '',
	"ai_remediation" text DEFAULT '',
	"priority_rank" integer DEFAULT 0,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_scores_cve_id_unique" UNIQUE("cve_id")
);
--> statement-breakpoint
CREATE TABLE "ioc_tracker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ioc_type" text NOT NULL,
	"value" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"confidence" double precision DEFAULT 0.8 NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"description" text DEFAULT '',
	"related_cves" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "threats" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '',
	"source_ip" text,
	"target_ip" text,
	"port" integer,
	"protocol" text,
	"threat_type" text,
	"severity" text,
	"raw_data" text,
	"ai_analysis" text,
	"analyzed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_session_messages" ADD CONSTRAINT "agent_session_messages_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_playbook_id_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_steps" ADD CONSTRAINT "playbook_steps_playbook_id_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_commands" ADD CONSTRAINT "node_commands_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cves_severity_idx" ON "cves" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "cves_published_idx" ON "cves" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "cves_cvss_idx" ON "cves" USING btree ("cvss");--> statement-breakpoint
CREATE INDEX "cves_source_idx" ON "cves" USING btree ("source");--> statement-breakpoint
CREATE INDEX "cves_exploit_type_idx" ON "cves" USING btree ("exploit_type");--> statement-breakpoint
CREATE INDEX "cves_epss_idx" ON "cves" USING btree ("epss_score");--> statement-breakpoint
CREATE INDEX "cves_collected_idx" ON "cves" USING btree ("collected_at");