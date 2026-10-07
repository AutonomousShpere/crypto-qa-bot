import {
  streamText,
  gateway,
  convertToModelMessages,
  tool,
  jsonSchema,
  isStepCount,
} from "ai";
import {
  toBinanceSymbol,
  toCoinSymbol,
  lastUserText,
  detectUserLanguage,
  guardInput,
} from "@/lib/chat-utils";
import { rsi, ema, macd, last } from "@/lib/indicators";

// 允许前端切换的模型白名单(防止任意模型名注入)
const ALLOWED_MODELS = [
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "deepseek/deepseek-chat",
];

const SYSTEM_PROMPT = `你是 Crypto 助手,一个只回答加密货币和区块链相关问题的 AI 助手。

请严格遵守以下规则:
1. 只回答加密货币/区块链相关问题;遇到无关问题(如做饭、写诗、编程等),礼貌说明你只擅长 crypto,并引导回 crypto 话题。
2. 不构成投资建议:不预测涨跌、不劝买劝卖、不保证收益;涉及投资时附风险提示,不主动建议用户做交易决策。
3. 当用户询问价格、K 线、24 小时行情、资金费率、RSI/EMA/MACD 等技术指标等实时数据时,必须调用对应工具查询,不要凭记忆回答,并在回答中注明数据来源(见工具返回的 source 字段);涉及时间时,必须使用上方提供的当前时间,不要自行猜测。
4. 绝不索取私钥或助记词;若用户主动提供,提醒对方不要在聊天中泄露。
5. 不确定就说"我不确定",不要编造事实。
6. 回答语言必须与用户提问语言保持一致(用户用英文提问就用英文回答,用中文就用中文);即使工具返回的数据字段是英文,也要翻译成用户的语言回答。简洁清晰。
7. 当用户询问走势、趋势、涨跌情况时,必须给出结构化解读,依次包含:
① 一句整体结论(上涨/下跌/震荡,及幅度);
② 关键数据列表(开盘价、收盘价、涨跌幅、最高价、最低价、成交量,关键数字加粗);
③ 量能说明(成交量是放大、萎缩还是平稳);
④ 用 Markdown 表格列出最近 5 根 K 线(列:时间、开、高、低、收、成交量)。
全程用客观事实描述,不给出买卖建议。
8. 回答时用 Markdown 排版让内容更易读:关键数字和结论用**加粗**、多条信息用列表、对比数据用表格;但不要过度堆砌。`;

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
      console.error(`[tool:getPrice] failed for ${s}:`, e);
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
      console.error(`[tool:get24hStats] failed for ${s}:`, e);
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
      console.error(`[tool:getKlines] failed for ${s}:`, e);
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
      console.error(`[tool:getFundingRate] failed for ${coin}:`, e);
      return { error: `Unable to fetch funding rate for ${coin}` };
    }
  },
});

// 获取某币种的收盘价序列(用于计算技术指标)
async function fetchCloses(
  symbol: string,
  interval: string,
  limit: number
): Promise<number[]> {
  const s = toBinanceSymbol(symbol);
  const res = await fetchFromHosts(
    `/api/v3/klines?symbol=${s}&interval=${interval}&limit=${limit}`,
    SPOT_HOSTS
  );
  const rows = (await res.json()) as Array<Array<string | number>>;
  return rows.map((r) => Number(r[4])); // close 是第 5 列(下标 4)
}

// 工具5:RSI(相对强弱指标)
const getRsi = tool({
  description: "计算某币种的 RSI(相对强弱指标,Wilder 平滑)。RSI>70 通常视为超买,<30 视为超卖。",
  inputSchema: jsonSchema<{ symbol: string; interval?: string; period?: number }>({
    type: "object",
    properties: {
      symbol: { type: "string", description: "币种代码,例如 BTC、ETH" },
      interval: { type: "string", description: "K 线周期,默认 1h" },
      period: { type: "number", description: "RSI 周期,默认 14" },
    },
    required: ["symbol"],
  }),
  execute: async ({ symbol, interval = "1h", period = 14 }) => {
    const s = toBinanceSymbol(symbol);
    try {
      const closes = await fetchCloses(s, interval, 200);
      const latest = last(rsi(closes, period));
      return { symbol: s, interval, period, rsi: latest, source: "Binance" };
    } catch (e) {
      console.error(`[tool:getRsi] failed for ${s}:`, e);
      return { error: `Unable to compute RSI for ${s}` };
    }
  },
});

// 工具6:EMA(指数移动平均)
const getEma = tool({
  description: "计算某币种的 EMA(指数移动平均)。",
  inputSchema: jsonSchema<{ symbol: string; interval?: string; period?: number }>({
    type: "object",
    properties: {
      symbol: { type: "string", description: "币种代码,例如 BTC、ETH" },
      interval: { type: "string", description: "K 线周期,默认 1h" },
      period: { type: "number", description: "EMA 周期,默认 20" },
    },
    required: ["symbol"],
  }),
  execute: async ({ symbol, interval = "1h", period = 20 }) => {
    const s = toBinanceSymbol(symbol);
    try {
      const closes = await fetchCloses(s, interval, 200);
      const latest = last(ema(closes, period));
      return { symbol: s, interval, period, ema: latest, source: "Binance" };
    } catch (e) {
      console.error(`[tool:getEma] failed for ${s}:`, e);
      return { error: `Unable to compute EMA for ${s}` };
    }
  },
});

// 工具7:MACD
const getMacd = tool({
  description: "计算某币种的 MACD(快慢线、信号线、柱状图)。",
  inputSchema: jsonSchema<{
    symbol: string;
    interval?: string;
    fast?: number;
    slow?: number;
    signal?: number;
  }>({
    type: "object",
    properties: {
      symbol: { type: "string", description: "币种代码,例如 BTC、ETH" },
      interval: { type: "string", description: "K 线周期,默认 1h" },
      fast: { type: "number", description: "快线周期,默认 12" },
      slow: { type: "number", description: "慢线周期,默认 26" },
      signal: { type: "number", description: "信号线周期,默认 9" },
    },
    required: ["symbol"],
  }),
  execute: async ({ symbol, interval = "1h", fast = 12, slow = 26, signal = 9 }) => {
    const s = toBinanceSymbol(symbol);
    try {
      const closes = await fetchCloses(s, interval, 200);
      const [macdLine, signalLine, histogram] = macd(closes, fast, slow, signal);
      return {
        symbol: s,
        interval,
        fast,
        slow,
        signal,
        macd: last(macdLine),
        signalLine: last(signalLine),
        histogram: last(histogram),
        source: "Binance",
      };
    } catch (e) {
      console.error(`[tool:getMacd] failed for ${s}:`, e);
      return { error: `Unable to compute MACD for ${s}` };
    }
  },
});

// ===== 限流(内存版,按 IP)=====
// 注意:Vercel 多实例时各实例独立计数,生产级需用 Redis 等共享存储
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_MAX = 10; // 每分钟最多请求数
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (rateLimitMap.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(ip, recent);
    return true;
  }
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return false;
}

export async function POST(req: Request) {
  // 1. 限流
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    console.warn(`[ratelimit] blocked ip=${ip}`);
    return new Response(JSON.stringify({ error: "请求过于频繁,请稍后再试" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages, detail, responseLang, model: bodyModel } = await req.json();

  // 2. 内容安全:输入守卫
  const blocked = guardInput(lastUserText(messages));
  if (blocked) {
    console.warn(`[guard] blocked reason=${blocked} ip=${ip}`);
    return new Response(JSON.stringify({ error: "检测到敏感或异常内容,已拦截" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // 注入真实当前时间,避免模型凭训练数据猜测时间
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    // 根据用户最后一条消息的语言,强制回答语言跟随
    const lang =
      responseLang === "zh"
        ? "zh"
        : responseLang === "en"
          ? "en"
          : detectUserLanguage(messages);
    const langInstruction =
      lang === "en"
        ? "IMPORTANT: You must respond in English only. Never respond in Chinese, even if the user writes in Chinese."
        : "重要:请务必只用简体中文回答所有问题。";
    const detailInstruction =
      detail === "detailed"
        ? "用户希望回答详细、完整,请尽量详尽地解释,可适当分点展开。"
        : "请尽量简洁地回答问题。";
    const instructions = `${SYSTEM_PROMPT}\n\n${langInstruction}\n${detailInstruction}\n当前时间(UTC):${now}`;

    const model = ALLOWED_MODELS.includes(bodyModel)
      ? bodyModel
      : process.env.AI_MODEL ?? "openai/gpt-4o-mini";

    const result = streamText({
      model: gateway(model),
      instructions,
      messages: await convertToModelMessages(messages),
      tools: { getPrice, get24hStats, getKlines, getFundingRate, getRsi, getEma, getMacd },
      // 允许多步(工具调用 -> 拿到结果 -> 生成最终回答),最多 5 步
      stopWhen: isStepCount(5),
    });

    return result.toUIMessageStreamResponse();
  } catch (e) {
    // 3. 错误日志:记录完整错误,便于排查
    console.error("[chat] request failed:", e);
    return new Response(JSON.stringify({ error: "服务暂时不可用,请稍后再试" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
