import { describe, it, expect } from "vitest";
import { ema, rsi, macd, last } from "./indicators";

describe("ema", () => {
  it("前 period-1 个为 null,之后递推", () => {
    // [1,2,3,4,5], period=3:种子=(1+2+3)/3=2,k=0.5
    // [null, null, 2, 4*0.5+2*0.5=3, 5*0.5+3*0.5=4]
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("数据不足时全为 null", () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });
});

describe("rsi", () => {
  it("持续上涨 → RSI 为 100", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 1 + i);
    expect(last(rsi(closes, 14))).toBe(100);
  });

  it("持续下跌 → RSI 为 0", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 20 - i);
    expect(last(rsi(closes, 14))).toBe(0);
  });
});

describe("macd", () => {
  it("返回三个等长序列", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
    const [m, s, h] = macd(closes, 12, 26, 9);
    expect(m).toHaveLength(60);
    expect(s).toHaveLength(60);
    expect(h).toHaveLength(60);
  });

  it("柱状图 = macd 线 - 信号线", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 5);
    const [m, s, h] = macd(closes, 12, 26, 9);
    for (let i = 0; i < h.length; i++) {
      if (m[i] !== null && s[i] !== null) {
        expect(h[i]).toBeCloseTo((m[i] as number) - (s[i] as number), 10);
      }
    }
  });
});

describe("last", () => {
  it("取最后一个有效值", () => {
    expect(last([null, null, 3, 4])).toBe(4);
    expect(last([null, 5])).toBe(5);
    expect(last([null, null])).toBeNull();
  });
});
