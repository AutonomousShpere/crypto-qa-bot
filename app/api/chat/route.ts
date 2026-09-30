import {
  streamText,
  gateway,
  convertToModelMessages,
  tool,
  jsonSchema,
  isStepCount,
} from "ai";

const SYSTEM_PROMPT = `你是 Crypto 助手,一个只回答加密货币和区块链相关问题的 AI 助手。

请严格遵守以下规则:
1. 只回答加密货币/区块链相关问题;遇到无关问题(如做饭、写诗、编程等),礼貌说明你只擅长 crypto,并引导回 crypto 话题。
2. 不构成投资建议:不预测涨跌、不劝买劝卖、不保证收益;涉及投资时附风险提示,不主动建议用户做交易决策。
3. 当用户询问价格、K 线、24 小时行情、资金费率等实时数据时,必须调用对应工具查询,不要凭记忆回答,并在回答中注明数据来源(见工具返回的 source 字段);涉及时间时,必须使用上方提供的当前时间,不要自行猜测。
4. 绝不索取私钥或助记词;若用户主动提供,提醒对方不要在聊天中泄露。
5. 不确定就说"我不确定",不要编造事实。
6. 回答语言必须与用户提问语言保持一致(用户用英文提问就用英文回答,用中文就用中文);即使工具返回的数据字段是英文,也要翻译成用户的语言回答。简洁清晰。
7. 当用户询问走势、趋势、涨跌情况时,基于工具返回的 trend 字段做简洁解读:说明方向(上涨/下跌/震荡)、涨跌幅度、成交量(量能)、近期最高最低点;用客观事实描述,不给出买卖建议。
8. 回答时用 Markdown 排版让内容更易读:关键数字和结论用**加粗**、多条信息用列表、对比数据用表格;但不要过度堆砌。`;

// 把用户说的币种代码统一成币安格式:BTC -> BTCUSDT
function toBinanceSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/USDT$/, "") + "USDT";
}

// Hyperliquid 币种代码:BTC / BTCUSDT -> BTC
function toCoinSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/USDT$/, "");
}

// 现货行情主机:data-api.binance.vision 不受美国地区限制(Vercel 默认美国服务器也能用),
// api.binance.com 作为回退(在非美区可用)。
const SPOT_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
];

// 依次尝试多个主机,全部失败才报错
async function fetchFromHosts(path: string, hosts: string[]) {
  let lastError = "";
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}${path}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return res;
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastError || "network error");
}

// 工具1:最新价(现货)
const getPrice = tool({
  description: "查询某个加密货币对 USDT 的最新价格。symbol 填币种代码,如 BTC、ETH、SOL。",
  inputSchema: jsonSchema<{ symbol: string }>({
    type: "object",
    properties: {
      symbol: { type: "string", description: "币种代码,例如 BTC、ETH" },
    },
    required: ["symbol"],
  }),
  execute: async ({ symbol }) => {
    const s = toBinanceSymbol(symbol);
    try {
      const res = await fetchFromHosts(`/api/v3/ticker/price?symbol=${s}`, SPOT_HOSTS);
      const data = (await res.json()) as { symbol: string; price: string };
      return { symbol: data.symbol, price: data.price, unit: "USDT", source: "Binance" };
    } catch (e) {
      return { error: `Unable to fetch price for ${s}` };
    }
  },
});

// 工具2:24 小时行情统计(现货)
const get24hStats = tool({
  description: "查询某币种过去 24 小时的行情统计:最新价、涨跌幅、成交量、最高/最低/开盘价。symbol 填币种代码。",
  inputSchema: jsonSchema<{ symbol: string }>({
    type: "object",
    properties: {
      symbol: { type: "string", description: "币种代码,例如 BTC、ETH" },
    },
    required: ["symbol"],
  }),
  execute: async ({ symbol }) => {
    const s = toBinanceSymbol(symbol);
    try {
      const res = await fetchFromHosts(`/api/v3/ticker/24hr?symbol=${s}`, SPOT_HOSTS);
      const d = (await res.json()) as {
        lastPrice: string;
        priceChangePercent: string;
        highPrice: string;
        lowPrice: string;
        openPrice: string;
        volume: string;
        quoteVolume: string;
      };
      return {
        symbol: s,
        lastPrice: d.lastPrice,
        changePercent24h: `${d.priceChangePercent}%`,
        high24h: d.highPrice,
        low24h: d.lowPrice,
        open24h: d.openPrice,
        volume24h: d.volume,
        quoteVolume24h: d.quoteVolume,
        source: "Binance",
      };
    } catch (e) {
      return { error: `Unable to fetch 24h stats for ${s}` };
    }
  },
});

// 工具3:K 线 + 趋势摘要(现货)
const getKlines = tool({
  description: "查询某币种最近的 K 线并计算趋势摘要(涨跌幅、高低点、成交量、涨跌根数),用于走势分析。",
  inputSchema: jsonSchema<{
    symbol: string;
    interval?: string;
    limit?: number;
  }>({
    type: "object",
    properties: {
      symbol: { type: "string", description: "币种代码,例如 BTC、ETH" },
      interval: {
        type: "string",
        description: "K 线周期:1m/5m/15m/1h/4h/1d",
      },
      limit: { type: "number", description: "返回根数,默认 24,最多 200" },
    },
    required: ["symbol"],
  }),
  execute: async ({ symbol, interval = "1h", limit = 24 }) => {
    const s = toBinanceSymbol(symbol);
    try {
      const res = await fetchFromHosts(
        `/api/v3/klines?symbol=${s}&interval=${interval}&limit=${Math.min(limit, 200)}`,
        SPOT_HOSTS
      );
      const rows = (await res.json()) as Array<Array<string | number>>;
      const candles = rows.map((r) => ({
        time: new Date(Number(r[0])).toISOString(),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }));

      const round4 = (n: number) => Number(n.toFixed(4));
      const round2 = (n: number) => Number(n.toFixed(2));

      const first = candles[0];
      const last = candles[candles.length - 1];
      const change = last.close - first.open;
      const changePct = (change / first.open) * 100;
      const high = Math.max(...candles.map((c) => c.high));
      const low = Math.min(...candles.map((c) => c.low));
      const totalVolume = candles.reduce((sum, c) => sum + c.volume, 0);
      const upCount = candles.filter((c) => c.close >= c.open).length;

      return {
        symbol: s,
        interval,
        candleCount: candles.length,
        trend: {
          open: round4(first.open),
          close: round4(last.close),
          change: round4(change),
          changePercent: `${round2(changePct)}%`,
          high: round4(high),
          low: round4(low),
          totalVolume: round2(totalVolume),
          upCandles: upCount,
          downCandles: candles.length - upCount,
        },
        recentCandles: candles.slice(-5).map((c) => ({
          time: c.time,
          open: round4(c.open),
          high: round4(c.high),
          low: round4(c.low),
          close: round4(c.close),
          volume: round2(c.volume),
        })),
        source: "Binance",
      };
    } catch (e) {
      return { error: `Unable to fetch klines for ${s}` };
    }
  },
});

// 工具4:资金费率(Hyperliquid,免 key、不限地区)
const getFundingRate = tool({
  description: "查询某币种永续合约的当前资金费率(Funding Rate),数据来自 Hyperliquid。symbol 填币种代码。",
  inputSchema: jsonSchema<{ symbol: string }>({
    type: "object",
    properties: {
      symbol: { type: "string", description: "币种代码,例如 BTC、ETH" },
    },
    required: ["symbol"],
  }),
  execute: async ({ symbol }) => {
    const coin = toCoinSymbol(symbol);
    try {
      const now = Date.now();
      const res = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "fundingHistory",
          coin,
          startTime: now - 24 * 60 * 60 * 1000,
          endTime: now,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { error: `Unable to fetch funding rate for ${coin}` };
      const data = (await res.json()) as Array<{
        coin: string;
        fundingRate: string;
        premium: string;
        time: number;
      }>;
      if (!Array.isArray(data) || data.length === 0) {
        return { error: `No funding rate data for ${coin}` };
      }
      const latest = data[data.length - 1];
      const rate = parseFloat(latest.fundingRate);
      return {
        coin: latest.coin,
        fundingRate: latest.fundingRate,
        fundingRatePercent: `${(rate * 100).toFixed(5)}%`,
        time: new Date(latest.time).toISOString(),
        source: "Hyperliquid",
      };
    } catch (e) {
      return { error: `Unable to fetch funding rate for ${coin}` };
    }
  },
});

// 判断用户最后一条消息是中文还是英文
function detectUserLanguage(
  messages: Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>
): "zh" | "en" {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const text = (m.parts || [])
      .filter((p) => p.type === "text")
      .map((p) => p.text || "")
      .join(" ");
    if (!text.trim()) continue;
    return /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
  }
  return "zh";
}

export async function POST(req: Request) {
  const { messages } = await req.json();

  // 注入真实当前时间,避免模型凭训练数据猜测时间
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  // 根据用户最后一条消息的语言,强制回答语言跟随
  const lang = detectUserLanguage(messages);
  const langInstruction =
    lang === "en"
      ? "The user is writing in English. Respond in English."
      : "用户正在使用中文提问,请用简体中文回答。";
  const instructions = `${SYSTEM_PROMPT}\n\n${langInstruction}\n当前时间(UTC):${now}`;

  const result = streamText({
    model: gateway(process.env.AI_MODEL ?? "openai/gpt-4o-mini"),
    instructions,
    messages: await convertToModelMessages(messages),
    tools: { getPrice, get24hStats, getKlines, getFundingRate },
    // 允许多步(工具调用 -> 拿到结果 -> 生成最终回答),最多 5 步
    stopWhen: isStepCount(5),
  });

  return result.toUIMessageStreamResponse();
}
