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
3. 当用户询问价格、K 线等实时行情数据时,必须调用对应工具查询,不要凭记忆回答,并在回答中注明数据来源(币安);涉及时间时,必须使用上方提供的当前时间,不要自行猜测。若用户询问你没有工具可查的数据(如资金费率),明确说明无法获取,不要编造。
4. 绝不索取私钥或助记词;若用户主动提供,提醒对方不要在聊天中泄露。
5. 不确定就说"我不确定",不要编造事实。
6. 用简体中文回答,简洁清晰。`;

// 把用户说的币种代码统一成币安格式:BTC -> BTCUSDT
function toBinanceSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/USDT$/, "") + "USDT";
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
      return { 交易对: data.symbol, 最新价: data.price, 单位: "USDT" };
    } catch (e) {
      return { error: `暂时无法获取 ${s} 的最新价(行情源不可用),请稍后再试` };
    }
  },
});

// 工具2:K 线(现货)
const getKlines = tool({
  description: "查询某个币种最近的 K 线(开高低收、成交量),用于了解近期走势。",
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
        时间: new Date(r[0] as number).toISOString(),
        开: r[1],
        高: r[2],
        低: r[3],
        收: r[4],
        成交量: r[5],
      }));
      return { 交易对: s, 周期: interval, 最近K线: candles };
    } catch (e) {
      return { error: `暂时无法获取 ${s} 的 K 线(行情源不可用),请稍后再试` };
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
    tools: { getPrice, getKlines },
    // 允许多步(工具调用 -> 拿到结果 -> 生成最终回答),最多 5 步
    stopWhen: isStepCount(5),
  });

  return result.toUIMessageStreamResponse();
}
