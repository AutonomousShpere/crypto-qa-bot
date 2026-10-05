// 纯函数工具,独立出来便于单元测试

// 把用户说的币种代码统一成币安格式:BTC -> BTCUSDT
export function toBinanceSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/USDT$/, "") + "USDT";
}

// Hyperliquid 币种代码:BTC / BTCUSDT -> BTC
export function toCoinSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/USDT$/, "");
}

// 提取用户最后一条消息的纯文本
export function lastUserText(
  messages: Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const text = (m.parts || [])
      .filter((p) => p.type === "text")
      .map((p) => p.text || "")
      .join(" ");
    if (text.trim()) return text.trim();
  }
  return "";
}

// 判断用户最后一条消息是中文还是英文
export function detectUserLanguage(
  messages: Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>
): "zh" | "en" {
  return /[\u4e00-\u9fff]/.test(lastUserText(messages)) ? "zh" : "en";
}

// 内容安全:输入守卫,返回拦截原因(非空即拦截)
export function guardInput(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  // 1. 越狱 / 提示词注入
  if (
    /忽略.{0,12}(指令|提示词|规则)|ignore.{0,24}(instruction|prompt|rule)|jailbreak|dan\s*mode|系统提示词|system\s*prompt/i.test(t)
  ) {
    return "injection";
  }
  // 2. 助记词 / 私钥
  const words = t.toLowerCase().split(/\s+/).filter(Boolean);
  const seedCtx = /(助记词|种子短语|seed|mnemonic|recovery phrase|私钥|private key)/i.test(t);
  if (seedCtx && (words.length >= 12 || /0x[0-9a-fA-F]{40,}/.test(t))) {
    return "sensitive";
  }
  return null;
}

// 标题截断
export function truncate(s: string, max = 18): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}
