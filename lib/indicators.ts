// 技术指标计算(纯函数,便于单元测试)。
// 实现对齐 crypto-mcp/indicators.py:前段数据不足的位置用 null 占位。

export type IndicatorSeries = (number | null)[];

// EMA:指数移动平均。前 period-1 个为 null,第 period 个用前 period 个的 SMA 做种子。
export function ema(values: number[], period: number): IndicatorSeries {
  if (period <= 0) throw new Error("period 必须大于 0");
  if (values.length < period) return values.map(() => null);

  const k = 2 / (period + 1);
  const result: IndicatorSeries = new Array(period - 1).fill(null);

  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(seed);

  let prev = seed;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

// RSI:相对强弱指标(Wilder 平滑)。前 period 个为 null。
export function rsi(closes: number[], period = 14): IndicatorSeries {
  if (period <= 0) throw new Error("period 必须大于 0");
  if (closes.length < period + 1) return closes.map(() => null);

  const changes: (number | null)[] = [null];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  const gains = changes.map((c) => (c !== null && c > 0 ? c : 0));
  const losses = changes.map((c) => (c !== null && c < 0 ? Math.abs(c) : 0));

  const result: IndicatorSeries = new Array(period).fill(null);

  let avgGain = gains.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;

  const toRsi = (g: number, l: number) =>
    l === 0 ? 100 : 100 - 100 / (1 + g / l);

  result.push(toRsi(avgGain, avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    result.push(toRsi(avgGain, avgLoss));
  }
  return result;
}

// MACD:返回 [macd 线, 信号线, 柱状图] 三个等长序列。
export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): [IndicatorSeries, IndicatorSeries, IndicatorSeries] {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);

  const macdLine: IndicatorSeries = emaFast.map((f, i) =>
    f === null || emaSlow[i] === null ? null : f - (emaSlow[i] as number)
  );

  const valid: number[] = macdLine.filter((v): v is number => v !== null);
  const validIndices: number[] = [];
  macdLine.forEach((v, i) => {
    if (v !== null) validIndices.push(i);
  });

  const signalValid = ema(valid, signal);
  const signalLine: IndicatorSeries = new Array(macdLine.length).fill(null);
  validIndices.forEach((idx, j) => {
    signalLine[idx] = signalValid[j];
  });

  const histogram: IndicatorSeries = macdLine.map((m, i) =>
    m === null || signalLine[i] === null ? null : m - (signalLine[i] as number)
  );

  return [macdLine, signalLine, histogram];
}

// 取指标序列里最后一个有效值(用于返回「最新」指标)
export function last(values: IndicatorSeries): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return values[i];
  }
  return null;
}
