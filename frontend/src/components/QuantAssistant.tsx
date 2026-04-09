import { useEffect, useRef, useState } from "react";
import * as api from "../api";

interface Props {
  convID: string;
  model: string;
  onMinimize: () => void;
}

const font = "'JetBrains Mono', monospace";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  typing?: boolean; // true while the typewriter animation is running
  visibleChars?: number; // how many chars to show during animation
}

// Minimal markdown renderer
function renderText(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    const rendered = parts.map((part, j) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={j}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code key={j} style={{ backgroundColor: "var(--q-bg-surface)", padding: "1px 4px", borderRadius: 3, fontSize: 10 }}>
            {part.slice(1, -1)}
          </code>
        );
      }
      return <span key={j}>{part}</span>;
    });
    return (
      <span key={i}>
        {rendered}
        {i < lines.length - 1 && <br />}
      </span>
    );
  });
}

const WELCOME_TEXT = "Quanti online. Tell me what needs doing and I'll get it done. Probably faster than you'd expect.";

export function QuantAssistant({ convID: initialConvID, model, onMinimize }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  const [welcomeText, setWelcomeText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgCounterRef = useRef(0);
  const convIDRef = useRef(initialConvID);
  // Accumulate tokens in a ref (not state) to avoid flash-of-full-content
  const tokenBufferRef = useRef("");
  // Guard against duplicate done events
  const processingDoneRef = useRef(false);

  // Listen for streaming tokens from the backend
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (!w?.runtime?.EventsOn) return;

    const cancelSession = w.runtime.EventsOn("quanti:session", (sessionID: string) => {
      convIDRef.current = sessionID;
    });

    const cancelToken = w.runtime.EventsOn("quanti:token", (token: string) => {
      tokenBufferRef.current += token;
    });

    const cancelDone = w.runtime.EventsOn("quanti:done", () => {
      // Guard against duplicate done events
      if (processingDoneRef.current) return;
      processingDoneRef.current = true;

      const text = tokenBufferRef.current.trim();
      tokenBufferRef.current = "";

      if (text.length === 0) {
        setWaiting(false);
        processingDoneRef.current = false;
        return;
      }

      const paragraphs = text
        .split(/\n{2,}|^---$/m)
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && p !== "---");

      // Stagger paragraph bubbles with typewriter animation
      let delay = 0;
      for (const p of paragraphs) {
        const msgId = `a-${++msgCounterRef.current}`;
        const charCount = p.length;
        // Speed: ~7ms per char, capped at 1s per bubble
        const typeDuration = Math.min(charCount * 7, 1000);

        setTimeout(() => {
          setMessages((msgs) => [...msgs, {
            id: msgId, role: "assistant", text: p, typing: true, visibleChars: 0,
          }]);

          const charsPerTick = Math.max(1, Math.ceil(charCount / (typeDuration / 16)));
          let shown = 0;
          const interval = setInterval(() => {
            shown = Math.min(shown + charsPerTick, charCount);
            setMessages((msgs) => msgs.map((m) =>
              m.id === msgId ? { ...m, visibleChars: shown } : m
            ));
            if (shown >= charCount) {
              clearInterval(interval);
              setMessages((msgs) => msgs.map((m) =>
                m.id === msgId ? { ...m, typing: false, visibleChars: undefined } : m
              ));
            }
          }, 16);
        }, delay);

        delay += typeDuration + 120;
      }

      setTimeout(() => {
        setWaiting(false);
        processingDoneRef.current = false;
        inputRef.current?.focus();
      }, delay);
    });

    return () => {
      if (cancelSession) cancelSession();
      if (cancelToken) cancelToken();
      if (cancelDone) cancelDone();
    };
  }, []);

  // Animated welcome message
  useEffect(() => {
    const timer = setTimeout(() => {
      setWelcomeVisible(true);
      let i = 0;
      const typeTimer = setInterval(() => {
        i++;
        setWelcomeText(WELCOME_TEXT.slice(0, i));
        if (i >= WELCOME_TEXT.length) clearInterval(typeTimer);
      }, 18);
      return () => clearInterval(typeTimer);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, waiting, welcomeText]);

  async function handleSend() {
    if (!input.trim() || waiting) return;
    const text = input.trim();
    setInput("");
    msgCounterRef.current++;
    setMessages((prev) => [...prev, { id: `u-${msgCounterRef.current}`, role: "user", text }]);
    setWaiting(true);
    tokenBufferRef.current = "";
    processingDoneRef.current = false;

    // Fire and don't await — streaming events handle the response display.
    // The `quanti:done` event will call setWaiting(false) when complete.
    api.quantiChat(convIDRef.current, text, model).catch((err) => {
      msgCounterRef.current++;
      setMessages((prev) => [...prev, {
        id: `a-${msgCounterRef.current}`,
        role: "assistant",
        text: `Something went wrong: ${String(err)}`,
      }]);
      tokenBufferRef.current = "";
      setWaiting(false);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      width: 440,
      height: 560,
      backgroundColor: "var(--q-bg-input)",
      border: "1px solid var(--q-border)",
      borderRadius: 10,
      fontFamily: font,
      overflow: "hidden",
      boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderBottom: "1px solid var(--q-bg-surface)",
        flexShrink: 0,
      }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: "var(--q-accent)" }} />
        <span style={{ fontSize: 11, color: "var(--q-fg)", fontWeight: 600, letterSpacing: 0.3 }}>quanti</span>
        <button
          onClick={onMinimize}
          style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--q-fg-muted)", display: "flex", alignItems: "center", padding: 4 }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--q-fg)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--q-fg-muted)"; }}
          title="Minimize"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
            <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {welcomeVisible && (
          <div style={{
            alignSelf: "flex-start", maxWidth: "88%",
            backgroundColor: "var(--q-bg-surface)", padding: "8px 12px",
            borderRadius: "4px 12px 12px 12px", fontSize: 11, color: "var(--q-fg-dimmed)", lineHeight: 1.6,
            opacity: 1, transition: "opacity 0.4s ease",
          }}>
            {welcomeText}
            {welcomeText.length < WELCOME_TEXT.length && (
              <span style={{ opacity: 0.5, animation: "blink 0.8s step-end infinite" }}>▋</span>
            )}
          </div>
        )}

        {messages.map((msg) => (
          msg.role === "user" ? (
            <div key={msg.id} style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{
                maxWidth: "80%", backgroundColor: "var(--q-accent)", padding: "7px 11px",
                borderRadius: "12px 4px 12px 12px", fontSize: 11, color: "var(--q-bg)",
                lineHeight: 1.5, wordBreak: "break-word",
              }}>
                {msg.text}
              </div>
            </div>
          ) : (
            <div key={msg.id} style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{
                maxWidth: "88%", backgroundColor: "var(--q-bg-surface)", padding: "7px 11px",
                borderRadius: "4px 12px 12px 12px", fontSize: 11, color: "var(--q-fg-dimmed)",
                lineHeight: 1.6, wordBreak: "break-word",
              }}>
                {msg.typing
                  ? <>{msg.text.slice(0, msg.visibleChars ?? 0)}<span style={{ opacity: 0.4, animation: "blink 0.8s step-end infinite" }}>▋</span></>
                  : renderText(msg.text)
                }
              </div>
            </div>
          )
        ))}

        {/* Thinking dots while waiting for response */}
        {waiting && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ backgroundColor: "var(--q-bg-surface)", padding: "9px 13px", borderRadius: "4px 12px 12px 12px", display: "flex", gap: 5 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: "var(--q-fg-muted)", animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--q-bg-surface)", flexShrink: 0, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={waiting ? "quanti is thinking…" : "Ask quanti…"}
          rows={1}
          style={{
            flex: 1, backgroundColor: "var(--q-bg-surface)", border: "1px solid var(--q-border)", borderRadius: 8,
            padding: "7px 10px", color: "var(--q-fg)", fontFamily: font, fontSize: 11,
            resize: "none", outline: "none", lineHeight: 1.5, maxHeight: 80, overflowY: "auto",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--q-accent)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--q-border)"; }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 80) + "px";
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || waiting}
          style={{
            width: 32, height: 32, borderRadius: 8,
            backgroundColor: input.trim() && !waiting ? "var(--q-accent)" : "var(--q-bg-surface)",
            border: "1px solid var(--q-border)", cursor: input.trim() && !waiting ? "pointer" : "default",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "background-color 0.15s",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke={input.trim() && !waiting ? "var(--q-bg)" : "var(--q-fg-muted)"}
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      <style>{`
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}
