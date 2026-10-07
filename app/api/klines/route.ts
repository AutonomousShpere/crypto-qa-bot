import { toBinanceSymbol } from "@/lib/chat-utils";

// GET /api/klines?symbol=BTC&interval=1h&limit=100
// 返回蜡烛图数据(给前端图表用),注意 lightweight-charts 需要秒级时间戳
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = toBinanceSymbol(searchParams.get("symbol") ?? "BTC");
  const interval = searchParams.get("interval") ?? "1h";
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500);

  const hosts = ["https://data-api.binance.vision", "https://api.binance.com"];
  let lastError = "";

  for (const host of hosts) {
    try {
      const res = await fetch(
        `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const rows = (await res.json()) as Array<Array<string | number>>;
      const candles = rows.map((r) => ({
        time: Math.floor(Number(r[0]) / 1000), // 秒级时间戳
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
      }));
      return new Response(JSON.stringify({ symbol, interval, candles }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return new Response(JSON.stringify({ error: lastError || "fetch failed" }), {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });
}
