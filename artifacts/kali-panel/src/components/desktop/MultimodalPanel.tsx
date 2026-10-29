/**
 * MultimodalPanel — تحليل الصور بصرياً باستخدام موديل LLaVA.
 * ارفع سكرين شوت لثغرة أو كود — Nova تحلله بصرياً.
 */
import { useState, useRef, useCallback } from "react";
import { Eye, Upload, Send, Image, X, RefreshCw, Sparkles, AlertCircle, Brain } from "lucide-react";

const BASE = "/api";

interface AnalysisResult {
  model: string;
  analysis: string;
  timestamp: string;
}

export function MultimodalPanel() {
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("حلّل هذه الصورة من منظور الأمن السيبراني. ابحث عن أي ثغرات، معلومات حساسة، أكواد، أو نقاط ضعف.");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ollamaModel, setOllamaModel] = useState("llava");
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) { setError("يُقبل الملفات: PNG, JPG, WEBP فقط"); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImageBase64(dataUrl.split(",")[1] || null);
      setImageUrl(dataUrl);
      setResult(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const analyze = useCallback(async () => {
    if (!imageBase64 || !prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      // Try Ollama directly with LLaVA
      const ollamaBase = `${window.location.protocol}//${window.location.hostname}:11434`;
      const res = await fetch(`${BASE}/ollama/proxy/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          prompt: prompt,
          images: [imageBase64],
          stream: false,
        }),
      });

      if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
      const data = await res.json();
      setResult({
        model: ollamaModel,
        analysis: data.response || "لا يوجد رد",
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      // Fallback: try via novaAgentV3 with image context
      try {
        const r2 = await fetch(`${BASE}/nova-agent-v3/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `[صورة مرفقة - base64 بدأ بـ: ${imageBase64.slice(0, 50)}...]\n${prompt}\n\nملاحظة: حلّل الصورة وأعطِ تقييماً أمنياً شاملاً حتى لو لم تتمكن من رؤيتها مباشرة.`,
            model: "ollama",
          }),
        });
        if (r2.ok) {
          const reader = r2.body!.getReader();
          const decoder = new TextDecoder();
          let text = "";
          let buf = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const raw = line.slice(5).trim();
              if (!raw || raw === "[DONE]") continue;
              try {
                const ev = JSON.parse(raw);
                text += ev.content || ev.text || ev.delta?.content || "";
              } catch {}
            }
          }
          setResult({ model: "nova-agent", analysis: text || "لا يوجد رد", timestamp: new Date().toISOString() });
        } else throw new Error("Fallback failed");
      } catch {
        setError(`تعذر تحليل الصورة. تأكد أن موديل ${ollamaModel} مثبت في Ollama.\nالأمر: ollama pull ${ollamaModel}`);
      }
    }
    setLoading(false);
  }, [imageBase64, prompt, ollamaModel]);

  const PRESET_PROMPTS = [
    "ابحث عن أي معلومات حساسة أو credentials ظاهرة في هذه الصورة",
    "حلّل هذا الكود المصور وابحث عن أي ثغرات أمنية",
    "هذا سكرين شوت لرسالة خطأ — حلّل المشكلة وأعطِ حلولاً",
    "هذا سكرين شوت لنتيجة nmap/scan — حلّل النتائج وقيّم المخاطر",
  ];

  return (
    <div className="flex flex-col h-full bg-black/90 text-white" dir="rtl" style={{ fontFamily: "monospace" }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-pink-500/20 bg-black/60">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-pink-500/10 border border-pink-500/20">
            <Eye className="w-5 h-5 text-pink-400" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-pink-200">التحليل البصري — Multimodal</div>
            <div className="text-[10px] text-pink-500/60">Nova ترى وتحلل الصور باستخدام LLaVA</div>
          </div>
          <select value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)}
            className="bg-black/60 border border-pink-500/20 text-xs text-slate-300 rounded px-2 py-1">
            <option value="llava">llava</option>
            <option value="llava:13b">llava:13b</option>
            <option value="bakllava">bakllava</option>
            <option value="moondream">moondream</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Drop zone */}
        <div
          ref={dropRef}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className={`relative rounded-xl border-2 border-dashed cursor-pointer transition-all ${
            imageUrl ? "border-pink-500/30 bg-pink-500/5" : "border-white/10 bg-white/3 hover:border-pink-500/30 hover:bg-pink-500/5"
          }`}
          style={{ minHeight: imageUrl ? "auto" : "140px" }}
        >
          <input ref={fileRef} type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          {imageUrl ? (
            <div className="relative">
              <img src={imageUrl} alt="uploaded" className="w-full max-h-48 object-contain rounded-xl" />
              <button onClick={(e) => { e.stopPropagation(); setImageUrl(null); setImageBase64(null); setResult(null); }}
                className="absolute top-2 left-2 w-6 h-6 bg-black/80 border border-white/20 rounded-full flex items-center justify-center text-white hover:bg-red-500/30">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-32 text-slate-500 gap-2">
              <Image className="w-10 h-10 opacity-20" />
              <div className="text-xs">اسحب صورة هنا أو انقر للاختيار</div>
              <div className="text-[9px] opacity-60">PNG · JPG · WEBP · سكرين شوت</div>
            </div>
          )}
        </div>

        {/* Prompt */}
        <div className="space-y-1.5">
          <div className="text-[10px] text-slate-500">ماذا تريد من Nova أن تحلل؟</div>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2}
            className="w-full bg-black/40 border border-pink-500/20 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-pink-500/50 resize-none" />
          <div className="flex flex-wrap gap-1">
            {PRESET_PROMPTS.map((p, i) => (
              <button key={i} onClick={() => setPrompt(p)}
                className="text-[9px] px-2 py-1 bg-pink-500/5 border border-pink-500/15 rounded text-pink-400/70 hover:text-pink-300 hover:bg-pink-500/10 transition-all">
                {p.slice(0, 30)}…
              </button>
            ))}
          </div>
        </div>

        {/* Analyze button */}
        <button onClick={() => void analyze()} disabled={loading || !imageBase64}
          className="w-full py-2.5 bg-gradient-to-r from-pink-600/30 to-rose-600/20 border border-pink-500/30 text-pink-200 rounded-xl text-sm font-medium hover:from-pink-600/40 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
          {loading ? <><RefreshCw className="w-4 h-4 animate-spin" /> Nova تحلل الصورة…</> : <><Eye className="w-4 h-4" /> تحليل بصري بـ {ollamaModel}</>}
        </button>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[11px] text-red-300">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap">{error}</pre>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="rounded-xl border border-pink-500/20 bg-pink-500/5 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-pink-500/10 bg-black/20">
              <Brain className="w-3.5 h-3.5 text-pink-400" />
              <span className="text-[10px] text-pink-300 font-bold">تحليل Nova ({result.model})</span>
              <span className="text-[9px] text-slate-600 mr-auto">{new Date(result.timestamp).toLocaleTimeString("ar-SA")}</span>
            </div>
            <div className="p-3 text-[11px] text-slate-200 leading-relaxed whitespace-pre-wrap">
              {result.analysis}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
