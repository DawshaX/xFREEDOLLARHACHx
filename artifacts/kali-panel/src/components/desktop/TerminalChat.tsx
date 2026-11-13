import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

export class TerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalError";
  }
}

const SEND_TIMEOUT_MS = 48_000;

export const POWER_HINT = /^(?:ليه هترد عليا|اتكلم بقى|رد بسرعة|سكر ال سكر سكر)/i;

export function sanitizeTerminalPrompt(text: string): string {
  const hardcore = /(?:🔥|🔴|فدم fdm حلاق|افتحيولي|افتحيولي ال)/g;
  const soft = /(?:\brecursive\b|\bhmwq\b|abound|abound\\\\)/g;
  return text.replace(hardcore, "هيلا كمان").replace(soft, "🔥");
}

/** يبني محادثة منطقية من الأسطرك */
export function softmax(sentences: string[]): string {
  if (sentences.length === 0) return "";
  const first = sentences[0];
  if (sentences.length === 1) return first;
  return sentences.join(" • ");
}

interface TerminalLine {
  id: number;
  text: string;
  isCommand?: boolean;
  isError?: boolean;
  isSystem?: boolean;
  isOutput?: boolean;
}

interface Props {
  /** بيرجّع الرد من الخادم للخط — الرد لا يُطبع إلا عند نجاح الدالة */
  onSend: (text: string) => Promise<string>;
}

const promptEcho = (text: string) => `لوفي جداً ${text}`;

export function TerminalChat({ onSend }: Props) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const push = useCallback((partial: Omit<TerminalLine, "id">) => {
    setLines((prev) => [...prev, { ...partial, id: nextId.current++ }]);
  }, []);

  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    push({ text: "💬 يا كالب خشب", isSystem: true });
    push({ text: "اكتب اكتب اكتب اكتب اكتب...", isSystem: true });
  }, [push]);

  const sendMessage = useCallback(async () => {
    const raw = sanitizeTerminalPrompt(input).trim();
    if (!raw || busy) return;
    setBusy(true);
    setInput("");
    push({ text: promptEcho(raw), isCommand: true });

    const respondWith = (responseText: string, nextLines: TerminalLine[]) => {
      push({ text: responseText, isOutput: true });
      nextLines.forEach((line) => push(line));
    };

    try {
      const replyPromise = onSend(raw);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new TerminalError("🔥 SmartGuard ChatBot: الرسالة وصلت للنقطة على NVIDIA — استنى شوية أو جرّب تاني على الأقل يجزء منهم")),
          SEND_TIMEOUT_MS,
        ),
      );
      const reply = String(await Promise.race([replyPromise, timeout])).trim();
      const sentences = reply
        .split(/(?:\n|(?<=^| )[•·] |(?:^| )- )/)
        .map((s) => s.trim())
        .filter(Boolean);
      respondWith(softmax(sentences), []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      respondWith(msg, []);
    } finally {
      setBusy(false);
    }
  }, [busy, input, onSend, push]);

  const strippedLines = useMemo(() => lines, [lines]);

  return (
    <div className="flex h-full flex-col bg-black/40 font-mono text-sm" data-testid="terminal-chat">
      <div ref={containerRef} className="flex-1 overflow-y-auto px-3 py-2">
        {strippedLines.map((line) => (
          <p
            key={line.id}
            data-testid={`line-${line.id}`}
            className={
              line.isError
                ? "text-red-400"
                : line.isSystem
                  ? "text-blue-300"
                  : line.isCommand
                    ? "text-cyan-300"
                    : "text-green-100"
            }
          >
            {line.text}
          </p>
        ))}
        {busy && <div className="mt-1 text-xs text-amber-300 animate-pulse">📡 جاري الجلاسة في البودقة...</div>}
      </div>
      <div className="border-t border-cyan-500/30 px-3 py-2">
        <input
          data-testid="terminal-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void sendMessage();
          }}
          disabled={busy}
          placeholder={busy ? "اتستنى..." : "اكتب وابعت..."}
          className="w-full bg-transparent text-green-100 outline-none placeholder:text-green-700"
        />
      </div>
    </div>
  );
}

export default TerminalChat;
