import React from "react";

interface KaliLogo2099Props {
  size?: number;
  className?: string;
  glow?: boolean;
}

/**
 * 🐉 الشعار المخصص الرسمي لـ NOVA KALI LINUX 2099 CUSTOM EDITION
 * يجمع بين درع الحماية السيبراني وأجنحة تنين كالي وهندسة الكوانتم 2099
 * باللون الأحمر النيون الرسمي (#ff2b4d) مع نبض ضوئي حي.
 */
export function KaliLogo2099({ size = 36, className = "", glow = true }: KaliLogo2099Props) {
  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${className}`}
      style={{
        width: size,
        height: size,
        filter: glow ? "drop-shadow(0 0 10px rgba(255,43,77,0.65))" : undefined,
      }}
    >
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="nk2099-shield" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ff2b4d" />
            <stop offset="55%" stopColor="#c80e35" />
            <stop offset="100%" stopColor="#3a0312" />
          </linearGradient>
          <linearGradient id="nk2099-core" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#44ff88" />
            <stop offset="50%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#ff2b4d" />
          </linearGradient>
          <radialGradient id="nk2099-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2a0310" />
            <stop offset="100%" stopColor="#07010a" />
          </radialGradient>
        </defs>

        {/* Outer Hexagonal Quantum Shield */}
        <polygon
          points="60,4 110,30 110,86 60,116 10,86 10,30"
          fill="url(#nk2099-bg)"
          stroke="url(#nk2099-shield)"
          strokeWidth="3.5"
        />

        {/* Inner Circuit Ring */}
        <polygon
          points="60,13 101,35 101,81 60,107 19,81 19,35"
          fill="none"
          stroke="rgba(255,43,77,0.38)"
          strokeWidth="1.4"
          strokeDasharray="6 3"
        />

        {/* Dragon / Cyber Wings Left & Right */}
        <path
          d="M60 22 L30 38 L24 62 L40 54 L34 76 L60 96 L86 76 L80 54 L96 62 L90 38 Z"
          fill="rgba(255,43,77,0.16)"
          stroke="#ff2b4d"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />

        {/* Stylized Kali Dragon Crest & Spear Center */}
        <path
          d="M60 16 L74 42 L65 46 L78 68 L60 92 L42 68 L55 46 L46 42 Z"
          fill="url(#nk2099-shield)"
          stroke="#ff8fa3"
          strokeWidth="1.5"
        />

        {/* Quantum Core Diamond */}
        <polygon
          points="60,42 72,56 60,70 48,56"
          fill="#07010a"
          stroke="url(#nk2099-core)"
          strokeWidth="2.2"
        />

        {/* Glowing Center Node */}
        <circle cx="60" cy="56" r="4.5" fill="#44ff88" />

        {/* Corner Telemetry Nodes */}
        <circle cx="60" cy="7" r="2.5" fill="#ff2b4d" />
        <circle cx="107" cy="31" r="2.2" fill="#38bdf8" />
        <circle cx="107" cy="85" r="2.2" fill="#ff2b4d" />
        <circle cx="60" cy="113" r="2.5" fill="#44ff88" />
        <circle cx="13" cy="85" r="2.2" fill="#ff2b4d" />
        <circle cx="13" cy="31" r="2.2" fill="#38bdf8" />
      </svg>
    </div>
  );
}

/**
 * 🕌 راية التوحيد والرسالة الأخلاقية لعام 2099 (في أعلى النظام)
 */
export function TawhidBanner2099({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-xl select-none"
      style={{
        background:
          "linear-gradient(90deg, rgba(45,3,16,0.95) 0%, rgba(18,2,10,0.98) 50%, rgba(45,3,16,0.95) 100%)",
        border: "1px solid rgba(255,43,77,0.45)",
        boxShadow: "0 0 22px rgba(255,43,77,0.16), inset 0 0 14px rgba(255,43,77,0.08)",
      }}
      dir="rtl"
    >
      <div className="flex items-center gap-2.5">
        <KaliLogo2099 size={compact ? 24 : 30} />
        <div className="flex flex-col">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-xs sm:text-sm font-black tracking-wide"
              style={{
                color: "#ffffff",
                textShadow: "0 0 12px rgba(255,43,77,0.85)",
              }}
            >
              بسم الله الرحمن الرحيم · لا إله إلا الله وحده لا شريك له · الله أكبر ولله الحمد · سبحان الله وبحمده سبحان الله العظيم
            </span>
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-mono font-black"
              style={{
                background: "rgba(255,43,77,0.2)",
                border: "1px solid rgba(255,43,77,0.55)",
                color: "#ff8fa3",
              }}
            >
              NOVA KALI LINUX 2099 CUSTOM OS
            </span>
          </div>
          {!compact && (
            <span className="text-[10px] font-mono" style={{ color: "rgba(255,210,220,0.78)" }}>
              خالصًا لوجه الله الكريم في نشر العلم النافع والدفاع السيبراني الأخلاقي وحماية العالم · 266/266 أداة · 28 بايثون · 10 عقد سحابية · 67.11GB مخزن
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[9px] font-mono font-black">
        <span
          className="px-2 py-0.5 rounded-md"
          style={{
            background: "rgba(68,255,136,0.12)",
            border: "1px solid rgba(68,255,136,0.4)",
            color: "#44ff88",
          }}
        >
          ✓ 266/266 KALI
        </span>
        <span
          className="px-2 py-0.5 rounded-md"
          style={{
            background: "rgba(56,189,248,0.12)",
            border: "1px solid rgba(56,189,248,0.4)",
            color: "#38bdf8",
          }}
        >
          ✓ LIVE X11 :99
        </span>
        <span
          className="hidden md:inline-block px-2 py-0.5 rounded-md"
          style={{
            background: "rgba(192,132,252,0.12)",
            border: "1px solid rgba(192,132,252,0.4)",
            color: "#c084fc",
          }}
        >
          ✓ GITHUB CLOUD 67.11GB
        </span>
      </div>
    </div>
  );
}
