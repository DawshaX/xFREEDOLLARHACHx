# CyberNova 2099 — Offensive Security Platform

> **English** | [العربية](#العربية)

An integrated offensive-security / bug-bounty platform with the **NOVA** AI agent,
a free multi-provider AI router, a live fleet, a vulnerability corpus, and full
Kali Linux control.

## Stack

- pnpm workspaces · Node.js 24 · TypeScript 5.9
- **API:** Express 5 (`artifacts/api-server`, port 8080, path `/api`)
- **Frontend:** React + Vite (`artifacts/kali-panel`)
- **DB:** PostgreSQL + Drizzle ORM
- **AI:** Ollama (local) + free providers — Groq, OpenRouter, Mistral, Gemini,
  Together, HuggingFace, **NVIDIA NIM**, **Cloudflare Workers AI**
- **Real-time:** WebSocket (local-agent) + SSE (streaming, CVE monitor, gateway)

## Run & Operate

```bash
pnpm --filter @workspace/api-server run dev      # API server (port 8080, /api)
pnpm run typecheck                               # full typecheck across all packages
pnpm run typecheck:libs                          # rebuild lib declarations (after schema changes)
pnpm --filter @workspace/db run push             # push DB schema changes (dev only)
```

Required env: `DATABASE_URL` — Postgres connection string.

## Free AI providers (all optional, env-gated)

| Provider | Env var | Notes |
|---|---|---|
| Groq | `GROQ_API_KEY` | very fast |
| OpenRouter | `OPENROUTER_API_KEY` | many free models |
| Mistral | `MISTRAL_API_KEY` | free tier |
| Google Gemini | `GEMINI_API_KEY` | multimodal |
| Together | `TOGETHER_API_KEY` | free models |
| HuggingFace | `HUGGINGFACE_API_KEY` | inference API |
| NVIDIA NIM | `NVIDIA_API_KEY` | open models on GPU |
| Cloudflare Workers AI | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | daily free quota |
| Ollama (local) | `OLLAMA_BASE_URL` | fully offline |

## Free database fallbacks

- **Supabase** (primary) — `DATABASE_URL`
- **Neon** — serverless Postgres, free tier
- **Turso** — libSQL/SQLite, free tier

## Responsible use

This platform is for **authorized** security testing only. Only scan systems you
own or have explicit written permission to test. See [LICENSE](./LICENSE).

---

## العربية

> [English](#cybernova-2099--offensive-security-platform) | **العربية**

منصة أمن سيبراني هجومية متكاملة مع وكيل **NOVA** الذكي، وموجّه مزوّدي ذكاء
اصطناعي مجانيين، وأسطول حيّ، وقاعدة بيانات ثغرات، وتحكّم كامل بـ Kali Linux.

### التشغيل

```bash
pnpm --filter @workspace/api-server run dev      # سيرفر الـ API (بورت 8080، مسار /api)
pnpm run typecheck                               # فحص الأنواع الكامل لكل الحزم
pnpm run typecheck:libs                          # إعادة بناء تعريفات المكتبات (بعد تغيير الـ schema)
pnpm --filter @workspace/db run push             # دفع تغييرات قاعدة البيانات (للتطوير فقط)
```

المتغيّر المطلوب: `DATABASE_URL` — رابط اتصال Postgres.

### مزوّدو الذكاء المجانيون (كلهم اختياريون، عبر متغيّرات البيئة)

Groq · OpenRouter · Mistral · Gemini · Together · HuggingFace ·
**NVIDIA NIM** · **Cloudflare Workers AI** · Ollama (محلي).

### قواعد بيانات مجانية بديلة

**Supabase** (الأساسي) · **Neon** · **Turso**.

### الاستخدام المسؤول

هذه المنصة للاختبار الأمني **المصرّح به** فقط. افحص فقط الأنظمة التي تملكها أو
لديك تصريح كتابي صريح باختبارها. راجع [LICENSE](./LICENSE).

### أين توجد الأشياء

- `artifacts/api-server/src/routes/` — كل مسارات الـ API
- `artifacts/api-server/src/lib/ai-multi-router.ts` — موجّه مزوّدي الذكاء المجانيين
- `artifacts/kali-panel/src/components/desktop/LiveAgentPanel.tsx` — العقل/المتحكّم الرئيسي
- `NOVA.md` — دليل NOVA السريع بالعربي
