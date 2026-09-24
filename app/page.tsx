"use client";

import { useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";

export default function Home() {
  const { messages, sendMessage, status, error } = useChat();
  const [input, setInput] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  }

  const busy = status === "submitted" || status === "streaming";

  return (
    <main className="app">
      <header className="header">
        <h1>Crypto 问答助手</h1>
        <p className="disclaimer">仅供学习交流,不构成投资建议。</p>
      </header>

      <section className="messages">
        {messages.length === 0 && (
          <div className="empty">
            问我任何加密货币问题,比如「什么是 DeFi」或「BTC 现在多少钱」
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.role}`}>
            <div className="role">{m.role === "user" ? "你" : "助手"}</div>
            <div className="content">
              {m.parts.map((part, i) =>
                part.type === "text" ? <span key={i}>{part.text}</span> : null
              )}
            </div>
          </div>
        ))}
      </section>

      {error && <div className="error">出错了:{error.message}</div>}

      <form className="input-bar" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入问题,回车发送…"
          disabled={busy}
        />
        <button type="submit" disabled={busy}>
          发送
        </button>
      </form>
    </main>
  );
}
