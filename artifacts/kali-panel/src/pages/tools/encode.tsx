import { useState } from "react";
import { BoxSelect, ArrowUpDown, Loader2 } from "lucide-react";

type EncOp = "base64-encode" | "base64-decode" | "url-encode" | "url-decode" | "hex-encode" | "hex-decode";
const OPS: { value: EncOp; label: string }[] = [
  { value: "base64-encode", label: "Base64 Encode" },
  { value: "base64-decode", label: "Base64 Decode" },
  { value: "url-encode", label: "URL Encode" },
  { value: "url-decode", label: "URL Decode" },
  { value: "hex-encode", label: "Hex Encode" },
  { value: "hex-decode", label: "Hex Decode" },
];

const DARK = { background: "rgba(5,0,12,0.88)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16 };
const taStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "10px 14px", outline: "none", width: "100%", resize: "vertical" };

function compute(text: string, op: EncOp): string {
  try {
    if (op === "base64-encode") return btoa(unescape(encodeURIComponent(text)));
    if (op === "base64-decode") return decodeURIComponent(escape(atob(text)));
    if (op === "url-encode") return encodeURIComponent(text);
    if (op === "url-decode") return decodeURIComponent(text);
    if (op === "hex-encode") return Array.from(new TextEncoder().encode(text)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (op === "hex-decode") return new TextDecoder().decode(new Uint8Array(text.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) ?? []));
  } catch (e) { return `Error: ${(e as Error).message}`; }
  return "";
}

export default function EncodeTool() {
  const [text, setText] = useState("");
  const [operation, setOperation] = useState<EncOp>("base64-encode");
  const [result, setResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleCompute = () => {
    if (!text) return;
    setIsLoading(true);
    setTimeout(() => { setResult(compute(text, operation)); setIsLoading(false); }, 200);
  };

  const handleSwap = () => {
    if (result) {
      setText(result);
      if (operation.endsWith("-encode")) setOperation(operation.replace("-encode", "-decode") as EncOp);
      else if (operation.endsWith("-decode")) setOperation(operation.replace("-decode", "-encode") as EncOp);
      setResult(null);
    }
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "rgba(170,68,255,0.1)", border: "1px solid rgba(170,68,255,0.3)" }}>
          <BoxSelect className="w-5 h-5" style={{ color: "#aa44ff" }} />
        </div>
        <div>
          <h1 className="font-black text-xl font-mono" style={{ color: "#aa44ff", textShadow: "0 0 16px rgba(170,68,255,0.4)" }}>التشفير وفك التشفير</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>Encoder / Decoder</p>
        </div>
      </div>

      <div className="rounded-2xl p-5 space-y-4" style={DARK}>
        {/* Op selector + Execute */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            {OPS.map(o => (
              <button key={o.value} onClick={() => setOperation(o.value)}
                className="px-3 py-1.5 rounded-xl font-black text-[9px] font-mono transition-all"
                style={{ background: operation === o.value ? "rgba(170,68,255,0.15)" : "rgba(255,255,255,0.02)", border: `1px solid ${operation === o.value ? "rgba(170,68,255,0.4)" : "rgba(255,255,255,0.06)"}`, color: operation === o.value ? "#aa44ff" : "rgba(255,255,255,0.3)" }}>
                {o.label}
              </button>
            ))}
          </div>
          <button onClick={handleCompute} disabled={!text || isLoading}
            className="px-5 py-2 rounded-xl font-black text-xs font-mono flex items-center gap-2 transition-all disabled:opacity-50"
            style={{ background: "rgba(170,68,255,0.12)", border: "1px solid rgba(170,68,255,0.35)", color: "#aa44ff", whiteSpace: "nowrap" }}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BoxSelect className="w-3.5 h-3.5" />}تنفيذ
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <div className="space-y-1.5">
            <label className="text-[9px] font-black font-mono uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>المدخلات (Input)</label>
            <textarea placeholder="أدخل النص هنا..." value={text} onChange={e => setText(e.target.value)} style={{ ...taStyle, minHeight: 140 }} rows={6} />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[9px] font-black font-mono uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>المخرجات (Output)</label>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono" style={{ color: "rgba(170,68,255,0.5)" }}>{result ? operation : ""}</span>
                {result && (
                  <button onClick={handleSwap}
                    className="p-1.5 rounded-lg transition-all"
                    style={{ background: "rgba(170,68,255,0.08)", border: "1px solid rgba(170,68,255,0.2)", color: "#aa44ff" }}>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            <textarea readOnly value={result ?? ""}
              placeholder="النتيجة ستظهر هنا..."
              style={{ ...taStyle, color: result ? "#44eebb" : "rgba(255,255,255,0.2)", background: result ? "rgba(68,238,187,0.04)" : "rgba(255,255,255,0.02)", border: `1px solid ${result ? "rgba(68,238,187,0.2)" : "rgba(255,255,255,0.06)"}`, minHeight: 140 }} rows={6} />
          </div>
        </div>
      </div>
    </div>
  );
}
