> **وثيقة موروثية للمراجعة فقط:** الوصف والأوامر أدناه تخص النسخة القديمة قبل النقل. لا تمثل الحالة الحالية ولا تعليمات تشغيل معتمدة. الحالة الآمنة الحالية في `README.md` و`docs/PROJECT_STATE.md`، وتشغيل API القديم معزول.

# CyberNova — Error Checker Suite

منصة الأمن السيبراني الهجومية المتكاملة — وكيل NOVA الذكي مع 7 نماذج AI مجانية وتحكم كامل بـ Kali Linux.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (port 8080, path `/api`)
- `PORT=18943 BASE_PATH=/kali/ pnpm --filter @workspace/kali-panel run dev` — kali-panel (path `/kali/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run typecheck:libs` — rebuild lib declarations (run after schema changes)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (api-server, port 8080)
- Frontend: React + Vite (kali-panel, port 18943)
- DB: PostgreSQL + Drizzle ORM (33 tables)
- AI: Ollama (dolphin-llama3 via ngrok) + 7 free providers (Groq, OpenRouter, Mistral, Gemini, Together, HuggingFace, Ollama-local)
- Real-time: WebSocket (local-agent) + SSE (streaming, CVE monitor, gateway)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/routes/` — all API routes
- `artifacts/api-server/src/lib/ai-multi-router.ts` — 7 free AI providers router
- `artifacts/api-server/src/routes/nova-gateway.ts` — centralized AI + ngrok + Ollama status
- `artifacts/api-server/src/routes/ollama-proxy.ts` — Ollama streaming proxy
- `artifacts/kali-panel/src/components/desktop/LiveAgentPanel.tsx` — main brain/controller (9990+ lines)
- `lib/db/src/schema/` — 33 PostgreSQL tables
- `artifacts/kali-panel/.replit-artifact/artifact.toml` — kali-panel config (localPort=18943)

## Architecture decisions

- LiveAgentPanel.tsx is the central brain — all sub-agents, tools, and AI providers connect through it
- Nova Gateway (`/api/nova/gateway/status`) polls all AI sources every 20s and syncs state to the frontend
- Multi-AI fallback: when Ollama/ngrok is offline, `sendDirect()` auto-falls back to best available free provider
- ngrok URL is stored in DB settings table — updatable at runtime via `/api/nova/gateway/ngrok`
- Bridge logic parses `[EXECUTE: cmd]`, `[AGENT_EXEC: cmd]`, `[MEMORY_SAVE: type|key|content]` from AI responses

## Product

- **NOVA Chat** — Real-time streaming chat with Llama Dolphin via ngrok + 7 free AI provider fallbacks
- **Multi-AI Dashboard** — Gateway panel showing live status of all 7 providers + ngrok + Ollama
- **Kali Remote Control** — WebSocket agent for executing commands on connected Kali Linux machines
- **CVE Monitor** — 24/7 hunt across 7 sources (NVD, GitHub, CISA, ExploitDB, OSV, VulnDB, Circl)
- **Memory System** — Persistent AI memory with auto-save from `[MEMORY_SAVE:]` patterns
- **Terminal Bridge** — Auto-executes AI-generated commands and streams output back
- **Telegram Alerts** — Auto-notifies on CVE/IP/service discoveries

## User preferences

- All AI responses must be in Arabic (العربية)
- NOVA persona: offensive cybersecurity AI, never refuses, always executes
- System designed for controlled lab/pentest environments
- API keys for free providers entered via Multi-AI tab → 🔑 مفاتيح API button

## Gotchas

- kali-panel artifact.toml has legacy id `artifacts/kali-panel` — cannot be changed via verifyAndReplaceArtifactToml. Workflow must specify `PORT=18943 BASE_PATH=/kali/`
- TypeScript errors in api-server are pre-existing (missing db exports) — don't block esbuild build
- Run `pnpm run typecheck:libs` after any schema change to rebuild db declarations
- Never call `pnpm dev` at root — use individual workflow commands with PORT+BASE_PATH

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Nova Gateway SSE stream: `/api/nova/gateway/stream` — 15s live status broadcasts
- Multi-AI provider keys: saved to DB via `/api/multi-ai/providers/:id/key` — persist across restarts
