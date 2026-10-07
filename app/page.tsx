"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
  type Conversation,
  listConversations,
  upsertConversation,
  deleteConversation,
  clearAllConversations,
  newConversationId,
} from "@/lib/chat-store";
import { Markdown } from "@/components/markdown";
import { CandlestickChart, type Candle } from "@/components/candlestick-chart";
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
    settings: "设置",
    tabAppearance: "外观",
    tabResponse: "回答",
    tabInteraction: "交互",
    tabData: "数据",
    chart: "K 线图",
    fontSizeLabel: "字号",
    fontSizeSmall: "小",
    fontSizeMedium: "中",
    fontSizeLarge: "大",
    densityLabel: "消息间距",
    densityCompact: "紧凑",
    densityComfortable: "舒适",
    detailLabel: "回答详细程度",
    detailConcise: "简洁",
    detailDetailed: "详细",
    themeLabel: "主题",
    themeDark: "深色",
    themeLight: "浅色",
    sidebarWidthLabel: "侧边栏宽度",
    sidebarNarrow: "窄",
    sidebarWide: "宽",
    responseLangLabel: "回答语言",
    responseFollow: "跟随提问",
    responseZh: "中文",
    responseEn: "English",
    modelLabel: "模型",
    autoScrollLabel: "自动滚动",
    soundLabel: "声音提醒",
    on: "开",
    off: "关",
    clearAll: "清除所有对话",
    exportChat: "导出对话",
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
    settings: "Settings",
    tabAppearance: "Appearance",
    tabResponse: "Response",
    tabInteraction: "Interaction",
    tabData: "Data",
    chart: "Chart",
    fontSizeLabel: "Font size",
    fontSizeSmall: "Small",
    fontSizeMedium: "Medium",
    fontSizeLarge: "Large",
    densityLabel: "Spacing",
    densityCompact: "Compact",
    densityComfortable: "Comfortable",
    detailLabel: "Response detail",
    detailConcise: "Concise",
    detailDetailed: "Detailed",
    themeLabel: "Theme",
    themeDark: "Dark",
    themeLight: "Light",
    sidebarWidthLabel: "Sidebar",
    sidebarNarrow: "Narrow",
    sidebarWide: "Wide",
    responseLangLabel: "Response language",
    responseFollow: "Follow",
    responseZh: "中文",
    responseEn: "English",
    modelLabel: "Model",
    autoScrollLabel: "Auto-scroll",
    soundLabel: "Sound",
    on: "On",
    off: "Off",
    clearAll: "Clear all chats",
    exportChat: "Export chat",
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

// ===== 设置 =====
type Settings = {
  fontSize: "small" | "medium" | "large";
  density: "compact" | "comfortable";
  detail: "concise" | "detailed";
  theme: "dark" | "light";
  sidebarWidth: "narrow" | "wide";
  responseLang: "follow" | "zh" | "en";
  model: string;
  autoScroll: boolean;
  sound: boolean;
};

const SETTINGS_KEY = "crypto-chat-settings";
const DEFAULT_SETTINGS: Settings = {
  fontSize: "medium",
  density: "comfortable",
  detail: "concise",
  theme: "dark",
  sidebarWidth: "narrow",
  responseLang: "follow",
  model: "openai/gpt-4o-mini",
  autoScroll: true,
  sound: false,
};

const MODEL_OPTIONS = [
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { value: "openai/gpt-4o", label: "GPT-4o" },
];

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// 播放一声短提示音(声音提醒用)
function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // 忽略(浏览器可能不支持)
  }
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
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"appearance" | "response" | "interaction" | "data">("appearance");
  const [chartOpen, setChartOpen] = useState(false);
  const [chartSymbol, setChartSymbol] = useState("BTC");
  const [chartInterval, setChartInterval] = useState("1h");
  const [chartCandles, setChartCandles] = useState<Candle[]>([]);

  const chatBody = {
    detail: settings.detail,
    responseLang: settings.responseLang,
    model: settings.model,
  };

  const currentIdRef = useRef<string | null>(null);
  const currentTitleRef = useRef("新对话");
  const skipSaveRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const prevStatusRef = useRef(status);

  useEffect(() => {
    const nav = typeof navigator !== "undefined" ? navigator.language : "";
    if (nav && !nav.toLowerCase().startsWith("zh")) setLang("en");
  }, []);

  useEffect(() => {
    setSuggestions(pickRandom(SUGGESTIONS[lang], 4));
  }, [lang]);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (settings.autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, settings.autoScroll]);

  // 回答完成时声音提醒
  useEffect(() => {
    if (settings.sound && prevStatusRef.current !== "ready" && status === "ready") {
      playBeep();
    }
    prevStatusRef.current = status;
  }, [status, settings.sound]);

  // 主题应用到 body(浅色/深色)
  useEffect(() => {
    document.body.dataset.theme = settings.theme;
  }, [settings.theme]);

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
    sendMessage({ text: s }, { body: chatBody });
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

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // 忽略
      }
      return next;
    });
  }

  function clearAllChats() {
    clearAllConversations().catch(() => {});
    setConversations([]);
    currentIdRef.current = null;
    setCurrentId(null);
    skipSaveRef.current = true;
    setMessages([]);
  }

  function exportChat() {
    const conv = conversations.find((c) => c.id === currentIdRef.current);
    if (!conv) return;
    const text = conv.messages
      .map((m) => `${m.role === "user" ? t.you : t.ai}:\n${textOf(m)}`)
      .join("\n\n");
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${conv.title || t.newChatTitle}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadChart(symbol: string, interval: string) {
    try {
      const res = await fetch(
        `/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=100`
      );
      const data = await res.json();
      setChartCandles(data.candles ?? []);
    } catch {
      setChartCandles([]);
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
    sendMessage({ text, messageId: editingId }, { body: chatBody });
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
    <>
      <div
        className="layout"
        data-font={settings.fontSize}
        data-density={settings.density}
        data-theme={settings.theme}
        data-width={settings.sidebarWidth}
      >
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

        <div className="sidebar-footer">
          <button className="settings-btn" onClick={() => setSettingsOpen(true)}>
            ⚙️ {t.settings}
          </button>
        </div>
      </aside>

      <main className="app">
        <div className="app-inner">
          <header className="header">
            <div className="header-text">
              <h1>{t.title}</h1>
              <p className="disclaimer">{t.disclaimer}</p>
            </div>
            <div className="header-actions">
              <button
                className="lang-toggle"
                title={t.chart}
                onClick={() => {
                  setChartOpen(true);
                  loadChart(chartSymbol, chartInterval);
                }}
              >
                📈
              </button>
              <button
                className="lang-toggle"
                onClick={() => setLang((l) => (l === "zh" ? "en" : "zh"))}
              >
                {t.langToggle}
              </button>
            </div>
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
                              onClick={() => regenerate({ body: chatBody })}
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
            <div ref={messagesEndRef} />
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

      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>⚙️ {t.settings}</span>
              <button className="modal-close" onClick={() => setSettingsOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-tabs">
              <button className={activeTab === "appearance" ? "tab active" : "tab"} onClick={() => setActiveTab("appearance")}>{t.tabAppearance}</button>
              <button className={activeTab === "response" ? "tab active" : "tab"} onClick={() => setActiveTab("response")}>{t.tabResponse}</button>
              <button className={activeTab === "interaction" ? "tab active" : "tab"} onClick={() => setActiveTab("interaction")}>{t.tabInteraction}</button>
              <button className={activeTab === "data" ? "tab active" : "tab"} onClick={() => setActiveTab("data")}>{t.tabData}</button>
            </div>
            <div className="modal-body">
              {activeTab === "appearance" && (
                <>
                  <div className="setting-group">
                    <div className="setting-label">{t.themeLabel}</div>
                    <div className="setting-options">
                      <button className={settings.theme === "dark" ? "opt active" : "opt"} onClick={() => updateSetting("theme", "dark")}>{t.themeDark}</button>
                      <button className={settings.theme === "light" ? "opt active" : "opt"} onClick={() => updateSetting("theme", "light")}>{t.themeLight}</button>
                    </div>
                  </div>
                  <div className="setting-group">
                    <div className="setting-label">{t.fontSizeLabel}</div>
                    <div className="setting-options">
                      <button className={settings.fontSize === "small" ? "opt active" : "opt"} onClick={() => updateSetting("fontSize", "small")}>{t.fontSizeSmall}</button>
                      <button className={settings.fontSize === "medium" ? "opt active" : "opt"} onClick={() => updateSetting("fontSize", "medium")}>{t.fontSizeMedium}</button>
                      <button className={settings.fontSize === "large" ? "opt active" : "opt"} onClick={() => updateSetting("fontSize", "large")}>{t.fontSizeLarge}</button>
                    </div>
                  </div>
                  <div className="setting-group">
                    <div className="setting-label">{t.densityLabel}</div>
                    <div className="setting-options">
                      <button className={settings.density === "compact" ? "opt active" : "opt"} onClick={() => updateSetting("density", "compact")}>{t.densityCompact}</button>
                      <button className={settings.density === "comfortable" ? "opt active" : "opt"} onClick={() => updateSetting("density", "comfortable")}>{t.densityComfortable}</button>
                    </div>
                  </div>
                  <div className="setting-group">
                    <div className="setting-label">{t.sidebarWidthLabel}</div>
                    <div className="setting-options">
                      <button className={settings.sidebarWidth === "narrow" ? "opt active" : "opt"} onClick={() => updateSetting("sidebarWidth", "narrow")}>{t.sidebarNarrow}</button>
                      <button className={settings.sidebarWidth === "wide" ? "opt active" : "opt"} onClick={() => updateSetting("sidebarWidth", "wide")}>{t.sidebarWide}</button>
                    </div>
                  </div>
                </>
              )}
              {activeTab === "response" && (
                <>
                  <div className="setting-group">
                    <div className="setting-label">{t.detailLabel}</div>
                    <div className="setting-options">
                      <button className={settings.detail === "concise" ? "opt active" : "opt"} onClick={() => updateSetting("detail", "concise")}>{t.detailConcise}</button>
                      <button className={settings.detail === "detailed" ? "opt active" : "opt"} onClick={() => updateSetting("detail", "detailed")}>{t.detailDetailed}</button>
                    </div>
                  </div>
                  <div className="setting-group">
                    <div className="setting-label">{t.responseLangLabel}</div>
                    <div className="setting-options">
                      <button className={settings.responseLang === "follow" ? "opt active" : "opt"} onClick={() => updateSetting("responseLang", "follow")}>{t.responseFollow}</button>
                      <button className={settings.responseLang === "zh" ? "opt active" : "opt"} onClick={() => updateSetting("responseLang", "zh")}>{t.responseZh}</button>
                      <button className={settings.responseLang === "en" ? "opt active" : "opt"} onClick={() => updateSetting("responseLang", "en")}>{t.responseEn}</button>
                    </div>
                  </div>
                  <div className="setting-group">
                    <div className="setting-label">{t.modelLabel}</div>
                    <div className="setting-options">
                      {MODEL_OPTIONS.map((m) => (
                        <button key={m.value} className={settings.model === m.value ? "opt active" : "opt"} onClick={() => updateSetting("model", m.value)}>{m.label}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {activeTab === "interaction" && (
                <>
                  <div className="setting-group">
                    <div className="setting-label">{t.autoScrollLabel}</div>
                    <div className="setting-options">
                      <button className={settings.autoScroll ? "opt active" : "opt"} onClick={() => updateSetting("autoScroll", true)}>{t.on}</button>
                      <button className={!settings.autoScroll ? "opt active" : "opt"} onClick={() => updateSetting("autoScroll", false)}>{t.off}</button>
                    </div>
                  </div>
                  <div className="setting-group">
                    <div className="setting-label">{t.soundLabel}</div>
                    <div className="setting-options">
                      <button className={settings.sound ? "opt active" : "opt"} onClick={() => updateSetting("sound", true)}>{t.on}</button>
                      <button className={!settings.sound ? "opt active" : "opt"} onClick={() => updateSetting("sound", false)}>{t.off}</button>
                    </div>
                  </div>
                </>
              )}
              {activeTab === "data" && (
                <div className="setting-actions">
                  <button className="action-btn" onClick={exportChat}>{t.exportChat}</button>
                  <button className="action-btn danger" onClick={clearAllChats}>{t.clearAll}</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {chartOpen && (
        <div className="modal-overlay" onClick={() => setChartOpen(false)}>
          <div className="modal chart-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>📈 {t.chart}</span>
              <button className="modal-close" onClick={() => setChartOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="chart-controls">
                <input
                  value={chartSymbol}
                  onChange={(e) => setChartSymbol(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") loadChart(chartSymbol, chartInterval);
                  }}
                  placeholder="BTC"
                />
                <select
                  value={chartInterval}
                  onChange={(e) => {
                    const v = e.target.value;
                    setChartInterval(v);
                    loadChart(chartSymbol, v);
                  }}
                >
                  <option value="1m">1m</option>
                  <option value="15m">15m</option>
                  <option value="1h">1h</option>
                  <option value="4h">4h</option>
                  <option value="1d">1d</option>
                </select>
              </div>
              <CandlestickChart candles={chartCandles} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
