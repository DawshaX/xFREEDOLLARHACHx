import { Skull } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }}>
      <div className="text-center space-y-6">
        <Skull className="w-24 h-24 mx-auto" style={{ color: "rgba(255,50,50,0.3)", filter: "drop-shadow(0 0 20px rgba(255,30,30,0.3))" }} />
        <div>
          <div className="font-black text-8xl font-mono" style={{ color: "#ff3333", textShadow: "0 0 30px rgba(255,50,50,0.5)" }}>404</div>
          <div className="font-black text-xl mt-2" style={{ color: "rgba(255,255,255,0.5)" }}>الصفحة غير موجودة</div>
        </div>
        <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>
          هذه الصفحة غير موجودة أو لم يتم تسجيلها في الراوتر
        </p>
        <a href="/" className="inline-block px-6 py-2.5 rounded-xl font-black text-sm transition-all"
          style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff5555" }}>
          العودة للرئيسية
        </a>
      </div>
    </div>
  );
}
