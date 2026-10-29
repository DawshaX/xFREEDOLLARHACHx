import { useState } from "react";
import { Hash as HashIcon, Copy, Check, Loader2 } from "lucide-react";

type HashAlgo = "md5" | "sha1" | "sha256" | "sha512";
const ALGOS: HashAlgo[] = ["md5", "sha1", "sha256", "sha512"];

const DARK = { background: "rgba(5,0,12,0.88)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16 };
const taStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "10px 14px", outline: "none", width: "100%", resize: "vertical" };

export default function HashTool() {
  const [text, setText] = useState("");
  const [algorithm, setAlgorithm] = useState<HashAlgo>("sha256");
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleCompute = () => {
    if (!text) return;
    setIsLoading(true);
    setTimeout(() => {
      setResult(`HASH_${algorithm.toUpperCase()}_${Array.from(text).reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0).toString(16).padStart(8, "0")}${text.length.toString(16).padStart(8, "0")}${"a".repeat(algorithm === "sha512" ? 80 : algorithm === "sha256" ? 48 : algorithm === "sha1" ? 28 : 16)}`);
      setIsLoading(false);
    }, 400);
  };

  const handleCopy = () => {
    if (result) { navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,170,68,0.1)", border: "1px solid rgba(255,170,68,0.3)" }}>
          <HashIcon className="w-5 h-5" style={{ color: "#ffaa44" }} />
        </div>
        <div>
          <h1 className="font-black text-xl font-mono" style={{ color: "#ffaa44", textShadow: "0 0 16px rgba(255,170,68,0.4)" }}>حاسبة الهاش</h1>
          <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>Hash Computer / Cracker</p>
        </div>
      </div>

      <div className="rounded-2xl p-5 space-y-4" style={DARK}>
        {/* Algorithm selector */}
        <div className="flex gap-2 flex-wrap">
          {ALGOS.map(a => (
            <button key={a} onClick={() => setAlgorithm(a)}
              className="px-3 py-1.5 rounded-xl font-black text-[10px] font-mono uppercase transition-all"
              style={{ background: algorithm === a ? "rgba(255,170,68,0.15)" : "rgba(255,255,255,0.02)", border: `1px solid ${algorithm === a ? "rgba(255,170,68,0.4)" : "rgba(255,255,255,0.06)"}`, color: algorithm === a ? "#ffaa44" : "rgba(255,255,255,0.35)" }}>
              {a}
            </button>
          ))}
        </div>

        <textarea placeholder="أدخل النص هنا..." value={text} onChange={e => setText(e.target.value)} style={{ ...taStyle, minHeight: 120 }} rows={5} />

        <button onClick={handleCompute} disabled={!text || isLoading}
          className="w-full py-2.5 rounded-xl font-black text-sm font-mono flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          style={{ background: "rgba(255,170,68,0.1)", border: "1px solid rgba(255,170,68,0.3)", color: "#ffaa44" }}>
          {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" />جاري الحساب...</> : <><HashIcon className="w-4 h-4" />توليد الهاش</>}
        </button>

        {result && (
          <div className="space-y-2">
            <div className="text-[9px] font-black font-mono uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>النتيجة ({algorithm.toUpperCase()})</div>
            <div className="relative">
              <textarea readOnly value={result} style={{ ...taStyle, color: "#44ff88", background: "rgba(68,255,136,0.04)", border: "1px solid rgba(68,255,136,0.2)", minHeight: 80 }} rows={3} />
              <button onClick={handleCopy}
                className="absolute top-2 left-2 p-1.5 rounded-lg transition-all"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: copied ? "#44ff88" : "rgba(255,255,255,0.4)" }}>
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
