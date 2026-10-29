import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, Send, User, Cpu } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export default function AIPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isPending, setIsPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    void fetch("/api/ai/history")
      .then(r => r.ok ? r.json() : null)
      .then((d: ChatMessage[] | null) => { if (d?.length) setMessages(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isPending) return;

    const userMsg: ChatMessage = { role: "user", content: input, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    const currentInput = input;
    setInput("");
    setIsPending(true);

    void fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: currentInput, history: messages.slice(-10) }),
    })
      .then(r => r.json())
      .then((res: { message?: string }) => {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: res.message ?? "...",
          timestamp: new Date().toISOString(),
        }]);
      })
      .catch(() => {
        toast({ variant: "destructive", title: "AI Error", description: "Could not reach AI endpoint." });
      })
      .finally(() => setIsPending(false));
  }, [input, isPending, messages, toast]);

  return (
    <div className="h-full flex flex-col space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-2xl font-bold uppercase text-primary tracking-widest">
        <Bot className="w-6 h-6" /> Dolphin AI Interface
      </div>

      <Card className="flex-1 flex flex-col border-primary/20 bg-card/80 overflow-hidden">
        <CardHeader className="border-b border-border bg-card/50 py-3">
          <CardTitle className="text-sm font-mono text-muted-foreground flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" /> dolphin-mixtral:latest
            <span className="ml-auto flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-y-auto bg-black/40">
          <div className="p-4 space-y-6">
            {messages.length === 0 && (
              <div className="text-center py-20 text-muted-foreground opacity-50 flex flex-col items-center">
                <Bot className="w-16 h-16 mb-4" />
                <p>System ready. Dolphin AI online.</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role !== "user" && (
                  <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center border border-primary/50 flex-shrink-0">
                    <Bot className="w-5 h-5 text-primary" />
                  </div>
                )}

                <div className={`max-w-[80%] rounded-lg p-4 font-mono text-sm whitespace-pre-wrap shadow-md
                  ${msg.role === "user"
                    ? "bg-primary text-black rounded-tr-none"
                    : "bg-card border border-border text-foreground rounded-tl-none"
                  }`}
                >
                  {msg.content}
                </div>

                {msg.role === "user" && (
                  <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center border border-border flex-shrink-0">
                    <User className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}
            {isPending && (
              <div className="flex gap-4 justify-start">
                <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center border border-primary/50 flex-shrink-0 animate-pulse">
                  <Bot className="w-5 h-5 text-primary" />
                </div>
                <div className="max-w-[80%] rounded-lg p-4 font-mono text-sm bg-card border border-border text-muted-foreground rounded-tl-none flex items-center gap-2">
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0.4s" }}></div>
                </div>
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </CardContent>
        <CardFooter className="p-4 border-t border-border bg-card/50">
          <form onSubmit={handleSubmit} className="w-full flex gap-2">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Query Dolphin AI..."
              className="flex-1 bg-black/60 border-primary/30 font-mono"
            />
            <Button type="submit" disabled={isPending || !input.trim()} className="bg-primary text-black hover:bg-primary/90">
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  );
}
