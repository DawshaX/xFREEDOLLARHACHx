/*
 * probe-services — «الخدمة شغالة؟» سؤال ليه إجابة واحدة: جرّبها وقِس.
 * ─────────────────────────────────────────────────────────────────
 * قبل كده كانت `pages/status.tsx` بتكتب في useEffect ست سطور `{status:
 * "operational", uptime: 99.9, latencyMs: 45}` من غير أي طلب شبكة، وكانت
 * `Dashboard.tsx` بتعرض «حالة الوحدات» بسبعة أسماء كلها online. الشاشة كانت
 * بتطمّن على حاجة ما اتجرّبتش. الدالة دي بتعمل الطلب الحقيقي وترجّع الزمن
 * المقاس، ولو مفيش مصدر بترجع status:"unknown" — والصفحة بتكتب «غير مقاس».
 */
export interface ProbeResult {
  name: string;
  path: string;
  /** online = رد 2xx · down = رد غلط أو الشبكة رفضت · unknown = مفيش مصدر أصلاً */
  status: "online" | "down" | "unknown";
  latencyMs: number;
  measured: boolean;
  httpStatus: number | null;
  errorAr: string;
  at: string;
}

export interface ProbeSpec {
  name: string;
  path: string;
}

const ERR_AR: Record<string, string> = {
  AbortError: "انتهت المهلة — الخدمة ما ردتش في الوقت",
  TypeError: "الشبكة رفضت الطلب (مفيش سيرفر أو الوصول متمنع)",
};

/** بيفترض إن `/api` هي الـbase النسبي — نفس اصطلاح البانل في الصفحات. */
export async function probeService(spec: ProbeSpec, timeoutMs = 4000): Promise<ProbeResult> {
  const base = (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? "/api";
  const url = spec.path.startsWith("http") ? spec.path : `${base}${spec.path.startsWith("/") ? "" : "/"}${spec.path}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
    const latencyMs = Date.now() - t0;
    return {
      name: spec.name,
      path: spec.path,
      status: res.ok ? "online" : "down",
      latencyMs,
      measured: true,
      httpStatus: res.status,
      errorAr: res.ok ? "" : `رد HTTP ${res.status}`,
      at: new Date().toISOString(),
    };
  } catch (err) {
    const msg = (err as Error)?.name ?? "";
    return {
      name: spec.name,
      path: spec.path,
      status: "down",
      latencyMs: Date.now() - t0,
      measured: true,
      httpStatus: null,
      errorAr: ERR_AR[msg] ?? `فشل القياس: ${msg || "خطأ غير معروف"}`,
      at: new Date().toISOString(),
    };
  }
}

export async function probeServices(specs: ProbeSpec[], timeoutMs = 4000): Promise<ProbeResult[]> {
  return Promise.all(specs.map((s) => probeService(s, timeoutMs)));
}
