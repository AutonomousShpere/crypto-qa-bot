"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
  type Conversation,
  listConversations,
  upsertConversation,
  deleteConversation,
  newConversationId,
} from "@/lib/chat-store";
import { Markdown } from "@/components/markdown";
import { truncate } from "@/lib/chat-utils";

type Lang = "zh" | "en";

const STRINGS = {
  zh: {
    brand: "Crypto 助手",
    newChat: "＋ 新建对话",
    history: "历史对话",
    noHistory: "暂无历史对话",
    searchPlaceholder: "搜索对话…",
    noResults: "无匹配结果",
    newChatTitle: "新对话",
    title: "Crypto 问答助手",
    disclaimer: "仅供学习交流,不构成投资建议。",
    welcomeTitle: "问我任何加密货币问题",
    welcomeSub: "支持实时价格、K 线走势,以及各种区块链概念",
    placeholder: "输入问题,回车发送…",
    send: "发送",
    stop: "停止",
    regenerate: "重新生成",
    edit: "编辑",
    save: "保存",
    cancel: "取消",
    errorPrefix: "出错了:",
    you: "你",
    ai: "AI",
    langToggle: "EN",
  },
  en: {
    brand: "Crypto Assistant",
    newChat: "＋ New Chat",
    history: "History",
    noHistory: "No conversations yet",
    searchPlaceholder: "Search chats…",
    noResults: "No matches",
    newChatTitle: "New chat",
    title: "Crypto Q&A Assistant",
    disclaimer: "For learning only. Not financial advice.",
    welcomeTitle: "Ask me anything about crypto",
    welcomeSub: "Live prices, K-line trends, and blockchain concepts",
    placeholder: "Type a question and press Enter…",
    send: "Send",
    stop: "Stop",
    regenerate: "Regenerate",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    errorPrefix: "Error: ",
    you: "You",
    ai: "AI",
    langToggle: "中文",
  },
} as const;

const SUGGESTIONS: Record<Lang, string[]> = {
  zh: [
    "BTC 现在多少钱?",
    "ETH 最新价格是多少?",
    "SOL 现在什么价?",
    "BTC 今天涨了多少?",
    "ETH 24小时成交量多大?",
    "BTC 最近 4 小时走势如何?",
    "ETH 最近一天的走势怎么样?",
    "BTC 资金费率是多少?",
    "什么是 DeFi?",
    "什么是智能合约?",
    "什么是 Gas?",
    "什么是 NFT?",
    "比特币和以太坊有什么区别?",
    "什么是 Layer 2?",
    "什么是稳定币?",
    "什么是去中心化交易所(DEX)?",
    "什么是质押(Staking)?",
    "区块链的工作原理是什么?",
    "什么是空投(Airdrop)?",
    "什么是 DAO?",
    "什么是跨链桥?",
    "什么是流动性挖矿?",
  ],
  en: [
    "What's the BTC price?",
    "What's the latest ETH price?",
    "What's SOL trading at?",
    "How much has BTC changed in 24 hours?",
    "What's ETH's 24h trading volume?",
    "How has BTC trended in the last 4 hours?",
    "How has ETH trended in the last day?",
    "What's the BTC funding rate?",
    "What is DeFi?",
    "What are smart contracts?",
    "What is gas?",
    "What is an NFT?",
    "What's the difference between Bitcoin and Ethereum?",
    "What is Layer 2?",
    "What are stablecoins?",
    "What is a DEX?",
    "What is staking?",
    "How does blockchain work?",
    "What is an airdrop?",
    "What is a DAO?",
    "What is a cross-chain bridge?",
    "What is liquidity mining?",
  ],
};

// 随机抽 n 个(洗牌后取前 n)
function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// 生成会话的可搜索文本(标题 + 所有消息内容)
function conversationSearchText(c: Conversation): string {
  const msgs = c.messages
    .map((m) =>
      m.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join(" ")
    )
    .join(" ");
  return `${c.title} ${msgs}`.toLowerCase();
}

function textOf(m: UIMessage): string {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function feedbackOf(m: UIMessage): "up" | "down" | undefined {
  return (m.metadata as Record<string, unknown> | undefined)?.feedback as
    | "up"
    | "down"
    | undefined;
}

export default function Home() {
  const {
    messages,
    sendMessage,
    status,
    setMessages,
    error,
    stop,
    regenerate,
  } = useChat();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<Lang>("zh");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const currentIdRef = useRef<string | null>(null);
  const currentTitleRef = useRef("新对话");
  const skipSaveRef = useRef(false);

  useEffect(() => {
    const nav = typeof navigator !== "undefined" ? navigator.language : "";
    if (nav && !nav.toLowerCase().startsWith("zh")) setLang("en");
  }, []);

  useEffect(() => {
    setSuggestions(pickRandom(SUGGESTIONS[lang], 4));
  }, [lang]);

  useEffect(() => {
    listConversations().then(setConversations);
  }, []);

  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    const id = currentIdRef.current;
    if (!id || messages.length === 0) return;

    const conv: Conversation = {
      id,
      title: currentTitleRef.current,
      updatedAt: Date.now(),
      messages,
    };

    setConversations((prev) => {
      const exists = prev.some((c) => c.id === id);
      return exists ? prev.map((c) => (c.id === id ? conv : c)) : [...prev, conv];
    });
    upsertConversation(conv).catch(() => {});
  }, [messages]);

  function startChat(id: string | null) {
    currentIdRef.current = id;
    setCurrentId(id);
    setInput("");
    setEditingId(null);
    skipSaveRef.current = true;
    if (id) {
      const conv = conversations.find((c) => c.id === id);
      currentTitleRef.current = conv?.title || t.newChatTitle;
      setMessages(conv?.messages ?? []);
    } else {
      currentTitleRef.current = t.newChatTitle;
      setMessages([]);
    }
  }

  function newChat() {
    startChat(null);
  }

  function ask(text: string) {
    const s = text.trim();
    if (!s) return;
    if (!currentIdRef.current) {
      currentIdRef.current = newConversationId();
      setCurrentId(currentIdRef.current);
      currentTitleRef.current = truncate(s) || t.newChatTitle;
    }
    sendMessage({ text: s });
    setInput("");
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    ask(input);
  }

  function deleteChat(id: string) {
    const next = conversations.filter((c) => c.id !== id);
    setConversations(next);
    deleteConversation(id).catch(() => {});
    if (currentIdRef.current === id) {
      currentIdRef.current = null;
      setCurrentId(null);
      currentTitleRef.current = t.newChatTitle;
      skipSaveRef.current = true;
      setMessages([]);
    }
  }

  function toggleFeedback(m: UIMessage, value: "up" | "down") {
    const next = feedbackOf(m) === value ? undefined : value;
    setMessages((prev) =>
      prev.map((x) =>
        x.id === m.id
          ? {
              ...x,
              metadata: { ...(x.metadata as Record<string, unknown>), feedback: next },
            }
          : x
      )
    );
  }

  function startEdit(m: UIMessage) {
    setEditingId(m.id);
    setEditingText(textOf(m));
  }

  function submitEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = editingText.trim();
    if (!text || !editingId) return;
    sendMessage({ text, messageId: editingId });
    setEditingId(null);
    setEditingText("");
  }

  const t = STRINGS[lang];
  const busy = status === "submitted" || status === "streaming";
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? sorted.filter((c) => conversationSearchText(c).includes(q))
    : sorted;
  const lastIndex = messages.length - 1;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="logo">₿</span>
          <span>{t.brand}</span>
        </div>

        <button className="new-chat" onClick={newChat}>
          {t.newChat}
        </button>

        <input
          className="search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t.searchPlaceholder}
        />

        <div className="chat-list-title">{t.history}</div>
        <ul className="chat-list">
          {filtered.length === 0 && (
            <li className="chat-empty">{q ? t.noResults : t.noHistory}</li>
          )}
          {filtered.map((c) => (
            <li
              key={c.id}
              className={c.id === currentId ? "chat-item active" : "chat-item"}
            >
              <button className="chat-item-btn" onClick={() => startChat(c.id)}>
                {c.title || t.newChatTitle}
              </button>
              <button
                className="chat-del"
                title="删除"
                onClick={() => deleteChat(c.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="app">
        <div className="app-inner">
          <header className="header">
            <div className="header-text">
              <h1>{t.title}</h1>
              <p className="disclaimer">{t.disclaimer}</p>
            </div>
            <button
              className="lang-toggle"
              onClick={() => setLang((l) => (l === "zh" ? "en" : "zh"))}
            >
              {t.langToggle}
            </button>
          </header>

          <section className="messages">
            {messages.length === 0 && (
              <div className="welcome">
                <div className="welcome-icon">₿</div>
                <h2>{t.welcomeTitle}</h2>
                <p>{t.welcomeSub}</p>
                <div className="suggestions">
                  {suggestions.map((s) => (
                    <button key={s} className="chip" onClick={() => ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, idx) => {
              const isEditing = m.id === editingId;
              const isLastAssistant = m.role === "assistant" && idx === lastIndex;
              return (
                <div key={m.id} className={`message ${m.role}`}>
                  <div className="avatar">
                    {m.role === "user" ? t.you : t.ai}
                  </div>
                  <div className="msg-body">
                    <div className="bubble">
                      {isEditing ? (
                        <form className="edit-form" onSubmit={submitEdit}>
                          <input
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            autoFocus
                          />
                          <button type="submit">{t.save}</button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                          >
                            {t.cancel}
                          </button>
                        </form>
                      ) : m.role === "assistant" ? (
                        <Markdown text={textOf(m)} />
                      ) : (
                        <span className="plain">{textOf(m)}</span>
                      )}
                    </div>

                    <div className="msg-actions">
                      {m.role === "assistant" && (
                        <>
                          <button
                            className={feedbackOf(m) === "up" ? "fb active" : "fb"}
                            onClick={() => toggleFeedback(m, "up")}
                            title="有帮助"
                          >
                            👍
                          </button>
                          <button
                            className={feedbackOf(m) === "down" ? "fb active" : "fb"}
                            onClick={() => toggleFeedback(m, "down")}
                            title="没帮助"
                          >
                            👎
                          </button>
                          {isLastAssistant && !busy && (
                            <button
                              className="fb"
                              onClick={() => regenerate()}
                              title={t.regenerate}
                            >
                              🔄
                            </button>
                          )}
                        </>
                      )}
                      {m.role === "user" && !busy && !isEditing && (
                        <button
                          className="fb"
                          onClick={() => startEdit(m)}
                          title={t.edit}
                        >
                          ✏️
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>

          {error && (
            <div className="error">
              {t.errorPrefix}
              {error.message}
            </div>
          )}

          <form className="input-bar" onSubmit={handleSubmit}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.placeholder}
              disabled={busy}
            />
            {busy ? (
              <button
                type="button"
                className="stop-btn"
                onClick={() => stop()}
              >
                {t.stop}
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()}>
                {t.send}
              </button>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
