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
3. 当用户询问价格、K 线、24 小时行情、资金费率等实时数据时,必须调用对应工具查询,不要凭记忆回答,并在回答中注明数据来源(价格/K线/24h行情来自币安,资金费率来自 Hyperliquid);涉及时间时,必须使用上方提供的当前时间,不要自行猜测。
4. 绝不索取私钥或助记词;若用户主动提供,提醒对方不要在聊天中泄露。
5. 不确定就说"我不确定",不要编造事实。
6. 回答语言与用户提问语言保持一致(用户用英文提问就用英文回答,用中文就用中文),简洁清晰。
7. 当用户询问走势、趋势、涨跌情况时,基于工具返回的「趋势摘要」做简洁解读:说明方向(上涨/下跌/震荡)、涨跌幅度、成交量(量能)、近期最高最低点;用客观事实描述,不给出买卖建议。`;

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
  throw new Error(lastError || "网络请求失败");
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
      return { 交易对: data.symbol, 最新价: data.price, 单位: "USDT", 数据来源: "币安" };
    } catch (e) {
      return { error: `暂时无法获取 ${s} 的最新价(行情源不可用),请稍后再试` };
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
        交易对: s,
        最新价: d.lastPrice,
        "24h涨跌幅": `${d.priceChangePercent}%`,
        "24h最高": d.highPrice,
        "24h最低": d.lowPrice,
        "24h开盘价": d.openPrice,
        "24h成交量": d.volume,
        "24h成交额": d.quoteVolume,
        数据来源: "币安",
      };
    } catch (e) {
      return { error: `暂时无法获取 ${s} 的 24h 行情(行情源不可用)` };
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
        时间: new Date(Number(r[0])).toISOString(),
        开: Number(r[1]),
        高: Number(r[2]),
        低: Number(r[3]),
        收: Number(r[4]),
        成交量: Number(r[5]),
      }));

      const round4 = (n: number) => Number(n.toFixed(4));
      const round2 = (n: number) => Number(n.toFixed(2));

      const first = candles[0];
      const last = candles[candles.length - 1];
      const change = last.收 - first.开;
      const changePct = (change / first.开) * 100;
      const high = Math.max(...candles.map((c) => c.高));
      const low = Math.min(...candles.map((c) => c.低));
      const totalVolume = candles.reduce((sum, c) => sum + c.成交量, 0);
      const upCount = candles.filter((c) => c.收 >= c.开).length;

      return {
        交易对: s,
        周期: interval,
        K线数量: candles.length,
        趋势摘要: {
          起始价: round4(first.开),
          结束价: round4(last.收),
          涨跌额: round4(change),
          涨跌幅: `${round2(changePct)}%`,
          期间最高: round4(high),
          期间最低: round4(low),
          总成交量: round2(totalVolume),
          上涨根数: upCount,
          下跌根数: candles.length - upCount,
        },
        最近5根K线: candles.slice(-5).map((c) => ({
          时间: c.时间,
          开: round4(c.开),
          高: round4(c.高),
          低: round4(c.低),
          收: round4(c.收),
          成交量: round2(c.成交量),
        })),
        数据来源: "币安",
      };
    } catch (e) {
      return { error: `暂时无法获取 ${s} 的 K 线(行情源不可用),请稍后再试` };
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
      if (!res.ok) return { error: `查不到 ${coin} 的资金费率` };
      const data = (await res.json()) as Array<{
        coin: string;
        fundingRate: string;
        premium: string;
        time: number;
      }>;
      if (!Array.isArray(data) || data.length === 0) {
        return { error: `Hyperliquid 暂无 ${coin} 的资金费率数据` };
      }
      const latest = data[data.length - 1];
      const rate = parseFloat(latest.fundingRate);
      return {
        币种: latest.coin,
        资金费率: latest.fundingRate,
        资金费率百分比: `${(rate * 100).toFixed(5)}%`,
        结算时间: new Date(latest.time).toISOString(),
        数据来源: "Hyperliquid",
      };
    } catch (e) {
      return { error: `暂时无法获取 ${coin} 的资金费率(数据源不可用)` };
    }
  },
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  // 注入真实当前时间,避免模型凭训练数据猜测时间
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const instructions = `${SYSTEM_PROMPT}\n\n当前时间(UTC):${now}`;

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
