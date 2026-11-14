import { novaAuthHeaders, novaTokenQuery } from "./ops-client";
import { resolveStandaloneApi } from "./standalone-api";

/* TEST10 «الشفاء الذاتي»: أي نداء JSON بيرجع HTML (سيرفر قديم بيخدم الصفحة
 * الرئيسة، أو وضع ساكن، أو سيرفر في نص تحديث) — بيتعالج بالترتيب:
 *  ① GET → الشيم المحلي (نفس البيانات الصادقة، بلا شبكة).
 *  ② retry واحد بعد ثانية (نافذة إعادة تشغيل الـauto-update).
 *  ③ خطأ عربي صادق بيسمّي المسار والحل — مش رسالة إنجليزي مشفّرة.
 * المندسون (dedup) بيمنعوا إزعاج الإشعارات بنفس العلة كل ثانية. */
const htmlHealReported = new Set<string>();
function reportHtmlHeal(path: string, method: string, via: string): void {
  const key = `${method} ${path}`;
  if (htmlHealReported.has(key)) return;
  htmlHealReported.add(key);
  setTimeout(() => htmlHealReported.delete(key), 120_000);
  try {
    window.dispatchEvent(new CustomEvent("nova:api-html", { detail: { path, method, via } }));
  } catch { /* بيئة اختبار */ }
}

export interface SseEvent {
  event: string;
  data: unknown;
}

const API_BASE = "/api";

/** بوابة الكتابة ردّت 403 token_required → أبلغ الـUI عشان بانر التوكن يظهر فورًا. */
function maybeSignalTokenRequired(res: Response, body: unknown): void {
  try {
    if (res.status === 403 && (body as { error?: string } | null)?.error === "token_required") {
      window.dispatchEvent(new CustomEvent("nova:token-required", {
        detail: { endpoint: String((body as { endpoint?: string })?.endpoint ?? "") },
      }));
    }
  } catch { /* window مش موجودة (اختبارات) — تجاهل */ }
}

/** Build the request headers once, merging caller headers with the ops token. */
function authHeaders(init: RequestInit): Record<string, string> {
  const headers = new Headers(init.headers ?? undefined);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return novaAuthHeaders(Object.fromEntries(headers.entries()));
}

export async function sseStream(
  path: string,
  init: RequestInit,
  onEvent: (e: SseEvent) => void,
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders(init),
  });
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = raw.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      try {
        onEvent({ event, data: data ? JSON.parse(data) : null });
      } catch {
        onEvent({ event, data });
      }
    }
  }
}

export async function jsonRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders(init),
  });
  if (!res.ok) {
    // If response is HTML (error page), throw a more descriptive error
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) {
      const text = await res.text();
      throw new Error(`Server returned HTML error page instead of JSON: ${res.status} ${res.statusText}`);
    }
    // البوابة بترجع JSON {error:"token_required"} — اقرأ البودي عشان نعلّم الـUI
    try {
      const maybeJson = await res.clone().json();
      maybeSignalTokenRequired(res, maybeJson);
    } catch { /* مش JSON — لا شيء */ }
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;

  // Check if response is actually JSON
  const contentType = res.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    const bodyText = await res.text();
    // ── الشفاء الذاتي بدل الخطأ المشفّر ──
    const isGet = !init.method || init.method.toUpperCase() === "GET";
    if (isGet) {
      const shim = resolveStandaloneApi(path, "GET", null) as unknown | null;
      if (shim !== null && shim !== undefined) {
        reportHtmlHeal(path, "GET", "shim");
        return shim as T;
      }
      try {
        await new Promise((r) => setTimeout(r, 1_000));
        const retry = await fetch(`${API_BASE}${path}`, { ...init, headers: authHeaders(init) });
        if (retry.ok && (retry.headers.get("content-type") ?? "").includes("application/json")) {
          reportHtmlHeal(path, "GET", "retry");
          return (await retry.json()) as T;
        }
      } catch { /* المحاولة التانية فشلت — الخطأ الصادق تحت */ }
    }
    reportHtmlHeal(path, init.method ?? "GET", "error");
    const wasHtml = (contentType ?? "").includes("text/html") || bodyText.trimStart().startsWith("<");
    throw new Error(
      wasHtml
        ? `النقطة ${path} رجّعت صفحة HTML بدل JSON — السيرفر بيحدّث أو النسخة أقدم من اللوحة. ${isGet ? "البيانات الأساسية اتعرضت من المخزن المحلي." : "جرب تاني بعد دقيقة أو حدّث السيرفر."}`
        : `Expected JSON response but got ${contentType || "unknown"}: ${bodyText.substring(0, 100)}...`,
    );
  }

  try {
    return await res.json() as Promise<T>;
  } catch (error) {
    const text = await res.text();
    throw new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : "Unknown error"}. Response: ${text.substring(0, 100)}...`);
  }
}

/* TEST8 «كل زرار له رد فعل حقيقي»: إشعار لمركز الإشعارات الحي (SSE popup +
 * سجل دائم). fire-and-forget — الإشعار ما يفشلش الفعل نفسه ولا يعلّقه،
 * والفشل بتاعه صامت لأن المهمة هي رد الفعل مش التنفيذ. */
export function pushNotify(
  kind: "info" | "success" | "error" | "warning",
  title: string,
  body = "",
  link?: string,
): void {
  void jsonRequest("/push/notify", {
    method: "POST",
    body: JSON.stringify({ kind, title, body, ...(link ? { link } : {}) }),
  }).catch(() => {});
}

// Re-export the query helper so callers that open raw EventSource / WebSocket
// connections (e.g. SystemContext, NovaFleetLive) use the same token source.
export { novaTokenQuery };
