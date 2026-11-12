/**
 * OpsTokenBanner · بانر «الأزرار مقفولة لأن التوكن مش محفوظ»
 * ─────────────────────────────────────────────────────────────
 * القياس اللي جاب الملف ده: لوج الإنتاج 2026-11-09 أظهر تسع ضربات 403
 * على أزرار تنفيذية (trigger/ingest/analyzers) لأن السيرفر مفعّل عليه
 * NOVA_EXEC_TOKEN والمالك عمله كل زرار يشتغل — وكان الفقد الوحيد: مفيش مكان
 * واضح يحط فيه التوكن.
 *
 * الميكانيكا: أي رد 403 {error:"token_required"} بيطلق حدث `nova:token-required`
 * (من lib/sse.ts) → البانر يظهر فوق الصفحة. المالك يلصق التوكن مرة واحدة →
 * بيتخزن في localStorage → كل الطلبات تركّبه تلقائيًا (ops-client fetch patch).
 */
import { useEffect, useState } from "react";
import { getOpsToken, setOpsToken } from "@/lib/ops-client";

export function OpsTokenBanner() {
  const [visible, setVisible] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const onRequired = (e: Event) => {
      const detail = (e as CustomEvent<{ endpoint?: string }>).detail;
      setEndpoint(detail?.endpoint ?? "");
      if (!getOpsToken()) setVisible(true);
    };
    window.addEventListener("nova:token-required", onRequired);
    return () => window.removeEventListener("nova:token-required", onRequired);
  }, []);

  if (!visible) return null;

  const save = () => {
    const v = value.trim();
    if (!v) return;
    setOpsToken(v);
    setSaved(true);
    setValue("");
    setTimeout(() => { setVisible(false); setSaved(false); }, 1600);
  };

  return (
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-[9999] border-b border-amber-500/40 bg-amber-950/95 px-4 py-2 text-amber-100 backdrop-blur"
      dir="rtl"
    >
      {saved ? (
        <div className="mx-auto max-w-3xl text-center text-sm font-medium text-emerald-300">
          ✓ التوكن اتخزّن — جرّب الزرار تاني، المفروض يرد دلوقتي.
        </div>
      ) : (
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">
            🔐 الزرار ده محتاج توكن التنفيذ (x-nova-token)
            {endpoint ? <span className="opacity-70"> — `{endpoint}`</span> : null}
          </span>
          <input
            type="password"
            dir="ltr"
            placeholder="الصق NOVA_EXEC_TOKEN هنا"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="min-w-56 flex-1 rounded border border-amber-500/50 bg-black/40 px-2 py-1 font-mono text-xs text-amber-100 placeholder:text-amber-600"
            autoComplete="off"
          />
          <button
            onClick={save}
            disabled={!value.trim()}
            className="rounded bg-amber-500 px-3 py-1 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-40"
          >
            حفظ وتفعيل
          </button>
          <button
            onClick={() => setVisible(false)}
            className="rounded border border-amber-500/40 px-2 py-1 text-xs opacity-80 hover:opacity-100"
            aria-label="إخفاء"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export default OpsTokenBanner;
