/**
 * NOVA · الوعي — the state of the whole organism, for `/nova-fleet`
 * ────────────────────────────────────────────────────────────────
 * Two worlds, one shape:
 *
 *   • **With a server** (`/api` on the same origin, or the remote base you typed
 *     in «محطة نوفا»): one call to `/api/nova-core/awareness` and we render what
 *     the engine measured — seats, nodes, programs, jobs, tools, the live bus,
 *     its outbound internet and its own public sites.
 *   • **On GitHub Pages** (no backend at all): the browser measures what a
 *     browser can honestly measure — the Pages site itself, the published state
 *     files (`state/programs.json`), the outbound paths a browser is allowed to
 *     touch (DNS-over-HTTPS, GitHub's public API) and the local engine's memory.
 *     Everything that only a server can know is reported as `unknown`, with a
 *     line saying so. Not as `down`, and definitely not as a green dot.
 *
 * The rule that makes this file worth having: **a number we did not measure is
 * not shown as a number.**
 */
import { NOVA_CARD, resolveNovaServer } from "./nova-core";
import { BACKEND_URL } from "./backend";
import { isRemoteConfigured, remoteUrl } from "./remote";

export type OrganState = "up" | "down" | "partial" | "unknown";

export interface OrganView {
  id: string;
  label: string;
  state: OrganState;
  says: string;
  fixAr?: string;
  route?: string;
}

export interface SiteView {
  id: string;
  label: string;
  url: string;
  ok: boolean;
  status: number | null;
  ms: number | null;
  note: string;
}

export interface AwarenessView {
  at: string;
  source: "server" | "browser";
  verdict: "alive" | "degraded" | "blind" | "asleep" | "headless";
  moodAr: string;
  organs: OrganView[];
  sites: SiteView[];
  counters: Record<string, unknown> | null;
  identity: typeof NOVA_CARD;
  error?: string;
}

let cache: { at: number; view: AwarenessView } | null = null;
const TTL_MS = 4_000;

export async function fetchAwareness(force = false): Promise<AwarenessView> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.view;
  const view = await (async () => {
    const base = await resolveNovaServer(force).catch(() => null);
    if (base) {
      try {
        const res = await fetch(`${base}/nova-core/awareness`, { signal: AbortSignal.timeout(9000) });
        if (res.ok) {
          const json = (await res.json()) as Record<string, unknown>;
          // A static bundle answers this shape: no organs, because there is no
          // engine. Fall through to the browser reading and keep its explanation.
          if (json.awarenessUnavailable || !Array.isArray(json.organs)) {
            const local = await browserAwareness();
            local.error = [json.reasonAr, json.howAr].filter(Boolean).join(" ");
            return local;
          }
          return {
            ...json,
            source: "server" as const,
            identity: (json.identity as typeof NOVA_CARD) ?? NOVA_CARD,
            organs: (json.organs as OrganView[]) ?? [],
            sites: (json.sites as SiteView[]) ?? [],
          } as AwarenessView;
        }
        // A server that answers but not here is a PRE-OPS bundle — say that, and
        // still show the browser-side reading of the organs it cannot report.
        const local = await browserAwareness();
        local.error = `المحرك رد HTTP ${res.status} على /api/nova-core/awareness — الباندل المنشور أقدم من طبقة ops.`;
        local.organs = local.organs.map((o) =>
          o.id === "brain" ? { ...o, fixAr: `${local.error} اعمل redeploy من الريبو.` } : o,
        );
        return local;
      } catch (err) {
        const local = await browserAwareness();
        local.error = `قراية وعي المحرك فشلت: ${(err as Error).message}`;
        return local;
      }
    }
    return browserAwareness();
  })();
  cache = { at: Date.now(), view };
  return view;
}

/** A HEAD-ish read that never throws and never lies. */
async function ping(id: string, label: string, url: string, ms = 4500): Promise<SiteView> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms), method: "GET", redirect: "follow" });
    return {
      id,
      label,
      url,
      ok: res.ok || res.type === "opaque",
      status: res.status,
      ms: Date.now() - t0,
      note: res.ok ? `ردّ ${res.status} في ${Date.now() - t0}ms` : `HTTP ${res.status}`,
    };
  } catch (err) {
    const msg = (err as Error).message || "";
    return {
      id,
      label,
      url,
      ok: false,
      status: null,
      ms: Date.now() - t0,
      note: /Failed to fetch|CORS|AbortError/i.test(msg)
        ? "مفيش مسار من المتصفح for العنوان ده (CORS أو حجب) — مش بالضرورة إن الموقع واقع"
        : msg.slice(0, 90),
    };
  }
}

/**
 * The brain writes one file per turn (`state/nova-brain-latest.json`). Reading it
 * is the difference between "the brain might be running somewhere" and "the brain
 * thought at 22:14 and here is what it said". Two rules kept from the rest of this
 * file: an old file is reported as OLD (with its age), and a missing file is
 * `unknown` — never a green dot.
 */
export interface BrainDoc {
  at: string;
  seat: string | null;
  thinking: { reply: string | null; why: string; action: { kind: string; arg: string } };
  action: { kind: string; ok?: boolean; hits?: number; error?: string } | null;
  answered: { question: string; at: string | null } | null;
  says_ar?: string;
  failures?: string[];
}

const BRAIN_FRESH_MS = 45 * 60 * 1000;

export function describeBrain(doc: BrainDoc, now = Date.now()): { state: OrganState; says: string } {
  const at = Date.parse(doc.at);
  const ageMin = Number.isFinite(at) ? Math.round((now - at) / 60000) : null;
  const line = (doc.thinking?.reply ?? "").split("\n")[0].slice(0, 160);
  const seat = doc.seat ? ` · ${doc.seat}` : "";
  if (ageMin !== null && now - at > BRAIN_FRESH_MS) {
    return { state: "partial", says: `آخر تفكير كان من ${ageMin} دقيقة (${doc.at.slice(11, 16)}Z)${seat} — مش لحظي، بس حقيقي: ${line}` };
  }
  return { state: "up", says: `فكّر ${ageMin === null ? "" : `من ${ageMin} دقيقة`}${seat} — ${line}` };
}

/** Which home answered, said out loud — "the workflow wrote this" and "the edge
 *  brain thought this" are different claims about freshness. */
export function brainSourceLabel(doc: BrainDoc & { source?: string }): string {
  return doc.source === "edge" ? "على Supabase Edge (pg_cron)" : "من ملف الـworkflow";
}

/**
 * The brain has two homes now, and the panel should not care which one answered:
 *
 *   1. `state/nova-brain-latest.json` — written by the GitHub workflow. Good, but
 *      only as fresh as the last cron run, and measured 2026-11-04 the crons
 *      stopped firing for over an hour.
 *   2. `/nova-brain` on Supabase Edge — thinks on a pg_cron tick every 5 minutes
 *      and stores the same shape of document in Postgres.
 *
 * So: read the file, and if it is missing or older than 15 minutes, ask the edge
 * brain. Whichever is newer wins; `source` says which one spoke.
 */
const BRAIN_EDGE_URL = BACKEND_URL.replace(/\/ops-api$/, "/nova-brain");
const BRAIN_FILE_STALE_MS = 15 * 60 * 1000;

async function readBrainFile(base: string): Promise<(BrainDoc & { source?: string }) | null> {
  if (!base) return null;
  try {
    const res = await fetch(`${base}/state/nova-brain-latest.json`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return { source: "workflow", ...((await res.json()) as BrainDoc) };
  } catch {
    return null;
  }
}

async function readBrainEdge(): Promise<(BrainDoc & { source?: string }) | null> {
  try {
    const res = await fetch(BRAIN_EDGE_URL, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { doc?: BrainDoc | null };
    if (!body?.doc?.at) return null;
    return { source: "edge", ...body.doc };
  } catch {
    return null;
  }
}

async function readBrain(base: string): Promise<(BrainDoc & { source?: string }) | null> {
  const file = await readBrainFile(base);
  const fileAge = file?.at ? Date.now() - Date.parse(file.at) : Number.POSITIVE_INFINITY;
  if (file && fileAge < BRAIN_FILE_STALE_MS) return file;
  const edge = await readBrainEdge();
  if (!edge) return file;
  const edgeAge = Date.now() - Date.parse(edge.at);
  return Number.isFinite(edgeAge) && edgeAge < fileAge ? edge : file;
}

const NO_SERVER = "اللوحة على Pages من غير سيرفر — القياس ده محتاج محرك. اربط سيرفر من «محطة نوفا» في نفس الصفحة.";

async function browserAwareness(): Promise<AwarenessView> {
  const BASE = typeof location !== "undefined" ? (import.meta.env.BASE_URL || "/").replace(/\/$/, "") : "";
  const origin = typeof location !== "undefined" ? location.origin + BASE : "";
  const base = origin.replace(/\/$/, "");

  const [pagesSite, programsProbe, doh, ghZen, brainDoc, backendProbe] = await Promise.all([
    ping("pages", "اللوحة (GitHub Pages)", base ? `${base}/` : "", 5000),
    (async () => {
      if (!base) return null;
      try {
        const res = await fetch(`${base}/state/programs.json`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return null;
        return (await res.json()) as { programs?: Array<Record<string, unknown>> };
      } catch {
        return null;
      }
    })(),
    ping("doh", "خروج للإنترنت (DNS-over-HTTPS)", "https://dns.google/resolve?name=github.com&type=A", 4000),
    ping("github", "GitHub API (مصدر المعلومات)", "https://api.github.com/zen", 4000),
    readBrain(base),
    ping("backend", "الـbackend (Supabase Edge)", `${BACKEND_URL}/health`, 6000),
  ]);

  const outbound = doh.ok || ghZen.ok;
  const programs = Array.isArray(programsProbe?.programs) ? programsProbe!.programs! : null;
  const enabled = programs ? programs.filter((p) => p.enabled !== false).length : 0;
  const remoteSet = isRemoteConfigured();

  const organs: OrganView[] = [
    (() => {
      const described = brainDoc ? describeBrain(brainDoc) : null;
      if (described && brainDoc) {
        return {
          id: "brain",
          label: "العقل اللغوي",
          state: described.state,
          says: `${described.says} · ${brainSourceLabel(brainDoc)}`,
          route: "/nova-fleet",
        };
      }
      return {
        id: "brain",
        label: "العقل اللغوي",
        state: "unknown" as OrganState,
        says: remoteSet
          ? "السيرفر اللي ربطته مابيتجاوبش على /api/nova-core/status"
          : "مفيش تفكير منشور: لا ملف `state/nova-brain-latest.json` ولا رد من `/nova-brain` على الحافة",
        route: "/nova-fleet",
        fixAr: remoteSet
          ? "الرابط المحفوظ وصلش — راجعه من «محطة نوفا»"
          : "الحافة بتفكّر كل 5 دقايق لوحدها — لو ده ظاهر يبقى الاتنين واقعين، وده يحتاج تدخل",
      };
    })(),
    {
      id: "chat",
      label: "الشات والذاكرة",
      state: backendProbe.ok ? "up" : "down",
      says: backendProbe.ok
        ? `الـbackend بيرد (${backendProbe.ms}ms) — الشات بيتكلم ويتخزن في chat_messages`
        : `الـbackend ماردّش: ${backendProbe.note}`,
      route: "/nova-fleet",
    },
    { id: "council", label: "المجلس", state: "unknown", says: NO_SERVER, route: "/nova-core" },
    { id: "fleet", label: "الأسطول", state: "unknown", says: NO_SERVER, route: "/nova-fleet" },
    { id: "ops", label: "محرك التنفيذ", state: "unknown", says: NO_SERVER, route: "/nova-fleet" },
    {
      id: "scope",
      label: "سجل التصريح",
      state: programs ? (enabled > 0 ? "up" : "partial") : "unknown",
      says: programs
        ? `${programs.length} برنامج في ` + "state/programs.json" + ` المنشور (${enabled} مفعّل)`
        : "مفيش state/programs.json منشور — السجل على السيرفر مش على Pages",
      fixAr: programs ? undefined : "شغّل `program_discover` على المحرك، وادفع السجل لـ`artifacts/kali-panel/public/state/` لو عايزه يبان هنا",
    },
    { id: "proof", label: "الأدلة", state: "unknown", says: NO_SERVER, route: "/evidence" },
    { id: "bus", label: "البث اللحظي", state: "unknown", says: "مفيش /api/ws من غير سيرفر", route: "/live-agent" },
    {
      id: "memory",
      label: "ذاكرة المتصفح",
      state: "partial",
      says: "ملاحظات نوفا ومحركاتها شغالة على localStorage (بتفضل هنا بعد الريفريش)",
      route: "/nova-core",
    },
    {
      id: "net",
      label: "الإنترنت من المتصفح",
      state: outbound ? "up" : "partial",
      says: outbound
        ? `منفذ خروج شغال (${[doh, ghZen].filter((p) => p.ok).map((p) => p.id).join(" · ")})`
        : "المتصفح ماقدرش يوصل أي منفذ خارجي — غالباً سياسة خصوصية/حظر",
      fixAr: outbound ? undefined : "ده قياس المتصفح؛ القياس الحقيقي بيتعمل من السيرفر (`/api/ops/kinds` + الـwatchdog)",
    },
    {
      id: "sites",
      label: "مواقع المنصة",
      state: pagesSite.ok ? "up" : "down",
      says: pagesSite.ok ? `الصفحة دي بتخدم من ${base}` : `الـorigin ماردّش (${pagesSite.note})`,
    },
  ];

  const dead = organs.filter((o) => o.state === "down").length;
  const verdict: AwarenessView["verdict"] = dead > 0 ? "degraded" : "headless";

  return {
    at: new Date().toISOString(),
    source: "browser",
    verdict,
    moodAr:
      `أنا ${NOVA_CARD.name}: في وضع المتصفح (Pages) — عارف مواقعى كويس (${pagesSite.ok ? "اللوحة تردّ" : "اللوحة ماردّتش"})، ` +
      `الإنترنت من هنا ${outbound ? "متاح" : "محبوس"}، ` +
      `وسجل التصريح ${programs ? `${programs.length} برنامج منشور` : "مش منشور"}. ` +
      `العقل والأسطول ومحرك التنفيذ محتاجين سيرفر متصل بيا عشان أبقى وعي كامل، مش عرض جميل.`,
    organs,
    sites: [pagesSite, { ...doh, label: "خروج: dns.google" }, { ...ghZen, label: "خروج: api.github.com" }].filter(Boolean),
    counters: {
      programsPublished: programs?.length ?? null,
      programsEnabled: programs ? enabled : null,
      remoteConfigured: remoteSet,
      outboundFromBrowser: outbound,
    },
    identity: NOVA_CARD,
  };
}

/** Exposed for the page: the same request the server-side manager uses, with a short poll. */
export function awarenessPollingEnabled(): boolean {
  return true;
}

/** The endpoint a connected hub answers; kept here so the audit sees one call site. */
export function awarenessUrl(): string {
  return remoteUrl("/api/nova-core/awareness");
}
