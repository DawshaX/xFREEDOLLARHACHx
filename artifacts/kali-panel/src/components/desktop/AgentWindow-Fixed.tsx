import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, Wrench, Plus, Trash2, CheckCircle, AlertTriangle } from "lucide-react";

export interface ClientToolEvent {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface Session {
  id: number;
  title: string;
  status: "active" | "paused" | "completed";
  createdAt: string;
}

interface ChatLine {
  role: "user" | "assistant" | "tool";
  text: string;
  toolName?: string;
  timestamp: string;
}

export function AgentWindow({
  onClientTool,
}: {
  onClientTool: (e: ClientToolEvent) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([
    { id: 1, title: "Desktop Session", status: "active", createdAt: new Date().toISOString() },
    { id: 2, title: "Security Analysis", status: "completed", createdAt: new Date(Date.now() - 3600000).toISOString() },
  ]);
  const [active, setActive] = useState<Session | null>(sessions[0]);
  const [chat, setChat] = useState<ChatLine[]>([
    {
      role: "assistant",
      text: "Hello! I'm your AI security assistant. I can help you with vulnerability analysis, system monitoring, and threat detection. How can I assist you today?",
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat]);

  async function send() {
    if (!input.trim() || !active || busy) return;
    const text = input;
    setInput("");
    setBusy(true);
    
    // Add user message
    const userMessage: ChatLine = {
      role: "user",
      text,
      timestamp: new Date().toISOString(),
    };
    setChat((c) => [...c, userMessage]);

    // Simulate AI thinking
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Add assistant response
    const responses = [
      "I'll help you analyze that security concern. Let me start by scanning the system for potential vulnerabilities.",
      "That's an interesting security question. Let me check the current threat landscape and provide you with relevant information.",
      "I'll run a comprehensive security analysis on that. This may take a few moments as I scan multiple vectors.",
      "Let me access the security databases and check for any related vulnerabilities or exploits.",
      "I'll initiate a security protocol to address your request. This involves checking system integrity and potential attack vectors.",
    ];

    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    
    const assistantMessage: ChatLine = {
      role: "assistant",
      text: randomResponse,
      timestamp: new Date().toISOString(),
    };
    setChat((c) => [...c, assistantMessage]);

    // Simulate tool usage
    if (text.toLowerCase().includes("scan") || text.toLowerCase().includes("فحص")) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const toolMessage: ChatLine = {
        role: "tool",
        text: "🔍 Running security scan...",
        toolName: "Security Scanner",
        timestamp: new Date().toISOString(),
      };
      setChat((c) => [...c, toolMessage]);

      await new Promise(resolve => setTimeout(resolve, 1000));
      const resultMessage: ChatLine = {
        role: "tool",
        text: "✅ Scan complete. No critical vulnerabilities found.",
        toolName: "Security Scanner",
        timestamp: new Date().toISOString(),
      };
      setChat((c) => [...c, resultMessage]);
    }

    setBusy(false);
  }

  async function newSession() {
    const newSession: Session = {
      id: Date.now(),
      title: `Session ${sessions.length + 1}`,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    setSessions([newSession, ...sessions]);
    setActive(newSession);
    setChat([
      {
        role: "assistant",
        text: "New session started. How can I help you with your security tasks today?",
        timestamp: new Date().toISOString(),
      },
    ]);
  }

  async function deleteSession(sessionId: number) {
    setSessions(sessions.filter(s => s.id !== sessionId));
    if (active?.id === sessionId) {
      setActive(sessions[0] || null);
    }
  }

  function getStatusColor(status: Session["status"]) {
    switch (status) {
      case "active": return "text-emerald-400";
      case "completed": return "text-blue-400";
      case "paused": return "text-amber-400";
    }
  }

  function getRoleIcon(role: ChatLine["role"]) {
    switch (role) {
      case "user": return "👤";
      case "assistant": return "🤖";
      case "tool": return "🔧";
    }
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <span className="font-semibold">AI Assistant</span>
        </div>
        <button
          onClick={newSession}
          className="p-1 hover:bg-muted rounded transition"
          title="New session"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sessions Sidebar */}
        <div className="w-48 border-r border-border bg-muted/30">
          <div className="p-2 space-y-1">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`p-2 rounded cursor-pointer transition ${
                  active?.id === session.id
                    ? "bg-primary/20 border border-primary/30"
                    : "hover:bg-muted/50"
                }`}
                onClick={() => setActive(session)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{session.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(session.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className={`w-2 h-2 rounded-full ${getStatusColor(session.status)}`} />
                    {sessions.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSession(session.id);
                        }}
                        className="p-1 hover:bg-muted rounded transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3" ref={scrollRef}>
            {chat.map((line, idx) => (
              <div
                key={idx}
                className={`flex ${
                  line.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-3 ${
                    line.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : line.role === "tool"
                      ? "bg-muted border border-border"
                      : "bg-card"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-lg">{getRoleIcon(line.role)}</span>
                    <div className="flex-1">
                      {line.toolName && (
                        <div className="text-xs font-medium mb-1 text-primary">
                          {line.toolName}
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-wrap">{line.text}</p>
                      <div className="text-xs opacity-60 mt-1">
                        {new Date(line.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex justify-start">
                <div className="bg-card rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 animate-pulse" />
                    <span className="text-sm">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-border">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Ask about security, vulnerabilities, or system analysis..."
                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={busy}
              />
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
