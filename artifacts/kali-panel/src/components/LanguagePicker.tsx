import { useEffect, useRef, useState } from "react";
import { Globe, Check } from "lucide-react";
import { useI18n } from "@/context/LanguageContext";

/**
 * 25-language switcher.
 *
 * Kept deliberately small: a globe button that opens a scrollable grid. It is
 * the only place a user needs to visit to change the interface language, and it
 * remembers the choice across reloads.
 */
export function LanguagePicker() {
  const { lang, setLang, languages, t } = useI18n();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = languages.find((l) => l.code === lang);

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={`${t("language")} — ${current?.english ?? lang}`}
        aria-label={t("language")}
        aria-expanded={open}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black font-mono transition-all"
        style={{
          background: "rgba(34,211,238,0.10)",
          border: "1px solid rgba(34,211,238,0.30)",
          color: "#22d3ee",
        }}
      >
        <Globe style={{ width: 11, height: 11 }} />
        <span className="uppercase">{lang}</span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-2 p-2 rounded-xl shadow-2xl"
          style={{
            insetInlineEnd: 0,
            width: 280,
            maxHeight: 320,
            overflowY: "auto",
            background: "rgba(6,8,14,0.98)",
            border: "1px solid rgba(34,211,238,0.25)",
            backdropFilter: "blur(12px)",
          }}
          role="listbox"
          aria-label={t("language")}
        >
          {languages.map((l) => {
            const active = l.code === lang;
            return (
              <button
                key={l.code}
                role="option"
                aria-selected={active}
                onClick={() => {
                  setLang(l.code);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[11px] text-start transition-colors"
                style={{
                  background: active ? "rgba(34,211,238,0.12)" : "transparent",
                  color: active ? "#22d3ee" : "rgba(226,232,240,0.85)",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                <span className="flex items-center gap-2">
                  <span dir={l.dir === "rtl" ? "rtl" : "ltr"}>{l.label}</span>
                  <span className="opacity-40 text-[9px] font-mono uppercase">{l.code}</span>
                </span>
                {active && <Check style={{ width: 12, height: 12 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
