#!/usr/bin/env node
/* Standalone backtest runner — tests all strategies across symbols/params */

const SYMBOLS = ["BTCUSDT"];
const NICE = { BTCUSDT: "BTC", ETHUSDT: "ETH", SOLUSDT: "SOL", BNBUSDT: "BNB", XRPUSDT: "XRP" };
const FUT_FEE = 0.0004;

/* ─── indicator functions (copied from TradingApp.tsx) ─── */
const fmt = (n, d = 2) => Number(n).toFixed(d);

const calcRSI = (arr, period = 14) => {
  if (arr.length < period + 1) return null;
  const slice = arr.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i] - slice[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const ag = gains / period, al = losses / period;
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
};

const calcSMA = (arr, period) => {
  if (arr.length < period) return null;
  const s = arr.slice(-period);
  return s.reduce((a, b) => a + b, 0) / period;
};

const calcEMA = (arr, period) => {
  if (arr.length < period) return null;
  const k = 2 / (period + 1);
  let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
};

const calcMACD = (arr) => {
  if (arr.length < 26) return null;
  const ema12 = calcEMA(arr, 12);
  const ema26 = calcEMA(arr, 26);
  if (ema12 === null || ema26 === null) return null;
  const macdLine = ema12 - ema26;
  const macdArr = [];
  for (let i = 26; i <= arr.length; i++) {
    const e12 = calcEMA(arr.slice(0, i), 12);
    const e26 = calcEMA(arr.slice(0, i), 26);
    macdArr.push(e12 - e26);
  }
  const signalLine = calcEMA(macdArr, 9);
  if (signalLine === null) return null;
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
};

const calcBBands = (arr, period = 20, mult = 2) => {
  if (arr.length < period) return null;
  const slice = arr.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - sma) ** 2, 0) / period;
  const stddev = Math.sqrt(variance);
  return { upper: sma + mult * stddev, middle: sma, lower: sma - mult * stddev };
};

const calcStochRSI = (arr, rsiPeriod = 14, stochPeriod = 14) => {
  if (arr.length < rsiPeriod + stochPeriod + 1) return null;
  const rsiArr = [];
  for (let i = rsiPeriod + 1; i <= arr.length; i++) {
    const r = calcRSI(arr.slice(0, i), rsiPeriod);
    if (r !== null) rsiArr.push(r);
  }
  if (rsiArr.length < stochPeriod + 1) return null;
  const recentRSI = rsiArr.slice(-stochPeriod);
  const prevRSI = rsiArr.slice(-(stochPeriod + 1), -1);
  const minR = Math.min(...recentRSI), maxR = Math.max(...recentRSI);
  const minP = Math.min(...prevRSI), maxP = Math.max(...prevRSI);
  const range = maxR - minR || 1;
  const rangeP = maxP - minP || 1;
  const k = ((recentRSI[recentRSI.length - 1] - minR) / range) * 100;
  const prevK = ((prevRSI[prevRSI.length - 1] - minP) / rangeP) * 100;
  return { k, prevK };
};

/* ─── SMC helpers ─── */
const findSwings = (candles, lookback = 2) => {
  const pts = [];
  if (candles.length < lookback * 2 + 1) return pts;
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isHigh = false;
      if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isLow = false;
    }
    if (isHigh) pts.push({ idx: i, price: candles[i].h, type: "H" });
    if (isLow) pts.push({ idx: i, price: candles[i].l, type: "L" });
  }
  let lastH = null, lastL = null;
  pts.forEach((p) => {
    if (p.type === "H") { p.type = lastH && p.price > lastH.price ? "HH" : "LH"; lastH = p; }
    else { p.type = lastL && p.price > lastL.price ? "HL" : "LL"; lastL = p; }
  });
  return pts;
};

const detectBOS = (candles, swings) => {
  if (candles.length < 6 || swings.length < 2) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const highs = swings.filter((s) => s.type === "HH" || s.type === "LH");
  const lows = swings.filter((s) => s.type === "HL" || s.type === "LL");
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  if (lastHigh && last.c > lastHigh.price && prev.c <= lastHigh.price) return "bullish";
  if (lastLow && last.c < lastLow.price && prev.c >= lastLow.price) return "bearish";
  return null;
};

const findFVGs = (candles) => {
  const gaps = [];
  if (candles.length < 3) return gaps;
  for (let i = candles.length - 10; i < candles.length - 2; i++) {
    if (i < 0) continue;
    const c0 = candles[i], c2 = candles[i + 2];
    if (c0.h < c2.l) gaps.push({ type: "bull", top: c2.l, bottom: c0.h, idx: i + 1 });
    if (c0.l > c2.h) gaps.push({ type: "bear", top: c0.l, bottom: c2.h, idx: i + 1 });
  }
  return gaps;
};

const detectFVG = (candles) => {
  const gaps = findFVGs(candles);
  if (gaps.length === 0) return null;
  const last = candles[candles.length - 1];
  for (let i = gaps.length - 1; i >= 0; i--) {
    const g = gaps[i];
    if (g.type === "bull" && last.l <= g.top && last.c >= g.bottom) return "bullish";
    if (g.type === "bear" && last.h >= g.bottom && last.c <= g.top) return "bearish";
  }
  return null;
};

const findOrderBlocks = (candles) => {
  const obs = [];
  if (candles.length < 5) return obs;
  for (let i = candles.length - 15; i < candles.length - 2; i++) {
    if (i < 0) continue;
    const c = candles[i], next = candles[i + 1];
    if (c.c < c.o && next.c > next.o && (next.c - next.o) > (c.o - c.c) * 1.5)
      obs.push({ type: "bull", top: c.o, bottom: c.c, idx: i });
    if (c.c > c.o && next.c < next.o && (next.o - next.c) > (c.c - c.o) * 1.5)
      obs.push({ type: "bear", top: c.c, bottom: c.o, idx: i });
  }
  return obs;
};

const detectOB = (candles) => {
  const obs = findOrderBlocks(candles);
  if (obs.length === 0) return null;
  const last = candles[candles.length - 1];
  for (let i = obs.length - 1; i >= 0; i--) {
    const ob = obs[i];
    if (ob.type === "bull" && last.l <= ob.top && last.c >= ob.bottom) return "bullish";
    if (ob.type === "bear" && last.h >= ob.bottom && last.c <= ob.top) return "bearish";
  }
  return null;
};

/* ─── Scalp strategies ─── */
const detectPriceActionPattern = (candles) => {
  if (candles.length < 30) return null;
  const recent = candles.slice(-30);
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];
  const lookback = candles.slice(Math.max(0, candles.length - 80));
  const sortH = lookback.map((c) => c.h).sort((a, b) => b - a);
  const sortL = lookback.map((c) => c.l).sort((a, b) => a - b);
  const resistanceZone = sortH[Math.floor(sortH.length * 0.15)];
  const supportZone = sortL[Math.floor(sortL.length * 0.15)];
  const range = resistanceZone - supportZone || 1;
  const proxPct = 0.25;
  const nearSupport = last.c <= supportZone + range * proxPct;
  const nearResistance = last.c >= resistanceZone - range * proxPct;
  if (!nearSupport && !nearResistance) return null;

  const swingLows = [], swingHighs = [];
  for (let i = 1; i < recent.length - 1; i++) {
    if (recent[i].l <= recent[i - 1].l && recent[i].l <= recent[i + 1].l) swingLows.push({ idx: i, price: recent[i].l });
    if (recent[i].h >= recent[i - 1].h && recent[i].h >= recent[i + 1].h) swingHighs.push({ idx: i, price: recent[i].h });
  }

  if (nearSupport && swingLows.length >= 2) {
    for (let j = swingLows.length - 1; j >= 1; j--) {
      const l2 = swingLows[j], l1 = swingLows[j - 1];
      if (l2.idx - l1.idx < 3) continue;
      const similarity = Math.abs(l1.price - l2.price) / ((l1.price + l2.price) / 2);
      if (similarity < 0.03) {
        const between = recent.slice(l1.idx, l2.idx + 1);
        const neckline = Math.max(...between.map((c) => c.h));
        if (last.c > neckline && prev.c <= neckline) return "bullish";
      }
    }
    const last10 = recent.slice(-10);
    const sLows = last10.filter((_, i) => i > 0 && i < last10.length - 1 && last10[i].l <= last10[i - 1].l && last10[i].l <= last10[i + 1].l);
    if (sLows.length >= 2) {
      const lowsUp = sLows[sLows.length - 1].l > sLows[0].l;
      const flatHigh = Math.max(...last10.map((c) => c.h));
      const flatLowH = Math.min(...last10.slice(-5).map((c) => c.h));
      if (lowsUp && (flatHigh - flatLowH) / flatHigh < 0.015 && last.c > flatHigh) return "bullish";
    }
    const tail5 = recent.slice(-5);
    if (tail5[1].l < tail5[2].l && tail5[2].l < tail5[3].l && tail5[3].l < tail5[4].l) {
      const recentHigh = Math.max(tail5[0].h, tail5[1].h, tail5[2].h);
      if (last.c > recentHigh) return "bullish";
    }
  }

  if (nearResistance && swingHighs.length >= 2) {
    for (let j = swingHighs.length - 1; j >= 1; j--) {
      const h2 = swingHighs[j], h1 = swingHighs[j - 1];
      if (h2.idx - h1.idx < 3) continue;
      const similarity = Math.abs(h1.price - h2.price) / ((h1.price + h2.price) / 2);
      if (similarity < 0.03) {
        const between = recent.slice(h1.idx, h2.idx + 1);
        const neckline = Math.min(...between.map((c) => c.l));
        if (last.c < neckline && prev.c >= neckline) return "bearish";
      }
    }
    const last10 = recent.slice(-10);
    const sHighs = last10.filter((_, i) => i > 0 && i < last10.length - 1 && last10[i].h >= last10[i - 1].h && last10[i].h >= last10[i + 1].h);
    if (sHighs.length >= 2) {
      const highsDown = sHighs[sHighs.length - 1].h < sHighs[0].h;
      const flatLow = Math.min(...last10.map((c) => c.l));
      const flatHighL = Math.max(...last10.slice(-5).map((c) => c.l));
      if (highsDown && (flatHighL - flatLow) / flatLow < 0.015 && last.c < flatLow) return "bearish";
    }
    const tail5 = recent.slice(-5);
    if (tail5[1].h > tail5[2].h && tail5[2].h > tail5[3].h && tail5[3].h > tail5[4].h) {
      const recentLow = Math.min(tail5[0].l, tail5[1].l, tail5[2].l);
      if (last.c < recentLow) return "bearish";
    }
  }
  return null;
};

const detectSMCInducement = (candles) => {
  if (candles.length < 20) return null;
  const lookback = candles.slice(-80);
  const sortH = lookback.map((c) => c.h).sort((a, b) => b - a);
  const sortL = lookback.map((c) => c.l).sort((a, b) => a - b);
  const resistanceLevels = [sortH[Math.floor(sortH.length * 0.05)], sortH[Math.floor(sortH.length * 0.10)], sortH[Math.floor(sortH.length * 0.15)]];
  const supportLevels = [sortL[Math.floor(sortL.length * 0.05)], sortL[Math.floor(sortL.length * 0.10)], sortL[Math.floor(sortL.length * 0.15)]];
  for (let i = 2; i < lookback.length - 2; i++) {
    if (lookback[i].h > lookback[i - 1].h && lookback[i].h > lookback[i - 2].h && lookback[i].h > lookback[i + 1].h && lookback[i].h > lookback[i + 2].h)
      resistanceLevels.push(lookback[i].h);
    if (lookback[i].l < lookback[i - 1].l && lookback[i].l < lookback[i - 2].l && lookback[i].l < lookback[i + 1].l && lookback[i].l < lookback[i + 2].l)
      supportLevels.push(lookback[i].l);
  }
  const bodies = lookback.slice(-20).map((c) => Math.abs(c.c - c.o));
  const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length || 1;
  const recent = candles.slice(-6);
  for (let k = recent.length - 1; k >= recent.length - 1; k--) {
    const cur = recent[k], p1 = recent[k - 1], p2 = recent[k - 2], p3 = recent[k - 3];
    for (const sup of supportLevels) {
      const falseBreak = [p3, p2, p1].some((c) => c.l < sup && c.c > sup * 0.998);
      if (!falseBreak) continue;
      const curBullish = cur.c > cur.o;
      const curBody = cur.c - cur.o;
      const p1Body = Math.abs(p1.c - p1.o) || avgBody * 0.1;
      if (curBullish && curBody > p1Body * 0.8 && curBody > avgBody * 0.8 && cur.c > Math.max(p1.o, p1.c)) return "bullish";
    }
    for (const res of resistanceLevels) {
      const falseBreak = [p3, p2, p1].some((c) => c.h > res && c.c < res * 1.002);
      if (!falseBreak) continue;
      const curBearish = cur.c < cur.o;
      const curBody = cur.o - cur.c;
      const p1Body = Math.abs(p1.c - p1.o) || avgBody * 0.1;
      if (curBearish && curBody > p1Body * 0.8 && curBody > avgBody * 0.8 && cur.c < Math.min(p1.o, p1.c)) return "bearish";
    }
  }
  return null;
};

const detectSMA5xEMA9 = (candles) => {
  if (candles.length < 30) return null;
  const h = candles.map((c) => c.c);
  const sma5now = calcSMA(h, 5), ema9now = calcEMA(h, 9);
  const sma5prev = calcSMA(h.slice(0, -1), 5), ema9prev = calcEMA(h.slice(0, -1), 9);
  if (sma5now === null || ema9now === null || sma5prev === null || ema9prev === null) return null;
  const bullishCross = sma5prev <= ema9prev && sma5now > ema9now;
  const bearishCross = sma5prev >= ema9prev && sma5now < ema9now;
  if (!bullishCross && !bearishCross) return null;
  const lookback = candles.slice(Math.max(0, candles.length - 80));
  const sortH = lookback.map((c) => c.h).sort((a, b) => b - a);
  const sortL = lookback.map((c) => c.l).sort((a, b) => a - b);
  const resistanceZone = sortH[Math.floor(sortH.length * 0.15)];
  const supportZone = sortL[Math.floor(sortL.length * 0.15)];
  const range = resistanceZone - supportZone || 1;
  const last = candles[candles.length - 1];
  const proxPct = 0.20;
  const nearSupport = last.c <= supportZone + range * proxPct;
  const nearResistance = last.c >= resistanceZone - range * proxPct;
  if (bullishCross && !nearSupport) return null;
  if (bearishCross && !nearResistance) return null;
  const body = last.c - last.o;
  if (bullishCross && body < 0) return null;
  if (bearishCross && body > 0) return null;
  const gapPct = Math.abs(sma5now - ema9now) / last.c;
  if (gapPct < 0.0005) return null;
  if (bullishCross) return { action: "BUY", reason: "SMA5×EMA9 ▲" };
  if (bearishCross) return { action: "SELL", reason: "SMA5×EMA9 ▼" };
  return null;
};

/* ─── Grid Bot ─── */
const GRID_LEVELS = 10;
const GRID_LOOKBACK = 60;
const detectGridSignal = (candles) => {
  if (candles.length < GRID_LOOKBACK + 2) return null;
  const lookback = candles.slice(-GRID_LOOKBACK - 2, -2);
  const low = Math.min(...lookback.map(c => c.l));
  const high = Math.max(...lookback.map(c => c.h));
  const range = high - low;
  if (range <= 0) return null;
  const gridSize = range / GRID_LEVELS;
  const cur = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  for (let g = 1; g < GRID_LEVELS; g++) {
    const level = low + g * gridSize;
    if (prev.c >= level && cur.c < level) return { action: "BUY", reason: `Grid ${g}/${GRID_LEVELS} ▼` };
    if (prev.c <= level && cur.c > level) return { action: "SELL", reason: `Grid ${g}/${GRID_LEVELS} ▲` };
  }
  return null;
};

/* ─── evalSignal ─── */
const evalSignal = (strat, slice) => {
  const h = slice.map((c) => c.c);
  if (strat === "rsi") {
    const rsi = calcRSI(h);
    if (rsi !== null && rsi < 30) return { action: "BUY", reason: `RSI<30` };
    if (rsi !== null && rsi > 70) return { action: "SELL", reason: `RSI>70` };
  } else if (strat === "macd") {
    const macdNow = calcMACD(h);
    const macdPrev = h.length > 26 ? calcMACD(h.slice(0, -1)) : null;
    if (macdNow && macdPrev) {
      if (macdPrev.histogram <= 0 && macdNow.histogram > 0) return { action: "BUY", reason: "MACD ▲" };
      if (macdPrev.histogram >= 0 && macdNow.histogram < 0) return { action: "SELL", reason: "MACD ▼" };
    }
  } else if (strat === "donchian") {
    if (slice.length >= 21) {
      const lb = slice.slice(-21, -1);
      const dcHigh = Math.max(...lb.map((c) => c.h));
      const dcLow = Math.min(...lb.map((c) => c.l));
      const last = slice[slice.length - 1];
      if (last.c > dcHigh) return { action: "BUY", reason: "Breakout ▲" };
      if (last.c < dcLow) return { action: "SELL", reason: "Breakdown ▼" };
    }
  } else if (strat === "smc_fvg") {
    const sig = detectFVG(slice);
    if (sig === "bullish") return { action: "BUY", reason: "Bull FVG" };
    if (sig === "bearish") return { action: "SELL", reason: "Bear FVG" };
  } else if (strat === "smc_bos") {
    const swings = findSwings(slice);
    const sig = detectBOS(slice, swings);
    if (sig === "bullish") return { action: "BUY", reason: "Bullish BOS" };
    if (sig === "bearish") return { action: "SELL", reason: "Bearish BOS" };
  } else if (strat === "smc_ob") {
    const sig = detectOB(slice);
    if (sig === "bullish") return { action: "BUY", reason: "Bull OB" };
    if (sig === "bearish") return { action: "SELL", reason: "Bear OB" };
  } else if (strat === "ema_cross") {
    if (h.length >= 22) {
      const e9 = calcEMA(h, 9), e21 = calcEMA(h, 21);
      const e9p = calcEMA(h.slice(0, -1), 9), e21p = calcEMA(h.slice(0, -1), 21);
      if (e9 !== null && e21 !== null && e9p !== null && e21p !== null) {
        if (e9p <= e21p && e9 > e21) return { action: "BUY", reason: "EMA9▲EMA21" };
        if (e9p >= e21p && e9 < e21) return { action: "SELL", reason: "EMA9▼EMA21" };
      }
    }
  } else if (strat === "bbands") {
    const bb = calcBBands(h, 20, 2);
    if (bb) {
      const price = h[h.length - 1], prevPrice = h.length > 1 ? h[h.length - 2] : price;
      if (prevPrice >= bb.lower && price < bb.lower) return { action: "BUY", reason: "BB Lower" };
      if (prevPrice <= bb.upper && price > bb.upper) return { action: "SELL", reason: "BB Upper" };
    }
  } else if (strat === "stoch_rsi") {
    const sr = calcStochRSI(h);
    if (sr) {
      if (sr.prevK <= 20 && sr.k > 20) return { action: "BUY", reason: "StochRSI▲20" };
      if (sr.prevK >= 80 && sr.k < 80) return { action: "SELL", reason: "StochRSI▼80" };
    }
  } else if (strat === "scalp_pa") {
    const sig = detectPriceActionPattern(slice);
    if (sig === "bullish") return { action: "BUY", reason: "PA▲" };
    if (sig === "bearish") return { action: "SELL", reason: "PA▼" };
  } else if (strat === "scalp_smc_ind") {
    const sig = detectSMCInducement(slice);
    if (sig === "bullish") return { action: "BUY", reason: "SMC Ind▲" };
    if (sig === "bearish") return { action: "SELL", reason: "SMC Ind▼" };
  } else if (strat === "scalp_sma_ema") {
    return detectSMA5xEMA9(slice);
  } else if (strat === "grid") {
    return detectGridSignal(slice);
  }
  return null;
};

/* ─── Fetch candles from Binance ─── */
async function fetchCandles(symbol, interval, startMs, endMs) {
  const allCandles = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    for (const k of data) {
      allCandles.push({ o: +k[1], h: +k[2], l: +k[3], c: +k[4], t: k[0] });
    }
    cursor = data[data.length - 1][0] + 1;
    if (data.length < 1000) break;
  }
  return allCandles;
}

/* ─── Volatility filter: ATR(14) vs ATR(50) — skip ranging markets ─── */
function isLowVolatility(candles, idx) {
  if (idx < 51) return false;
  const slice = candles.slice(0, idx + 1);
  const atrArr = [];
  for (let a = 1; a < slice.length; a++) {
    const tr = Math.max(slice[a].h - slice[a].l, Math.abs(slice[a].h - slice[a - 1].c), Math.abs(slice[a].l - slice[a - 1].c));
    atrArr.push(tr);
  }
  if (atrArr.length < 50) return false;
  const atr14 = atrArr.slice(-14).reduce((s, v) => s + v, 0) / 14;
  const atr50 = atrArr.slice(-50).reduce((s, v) => s + v, 0) / 50;
  return atr14 < atr50 * 0.8; /* low vol when recent ATR is 20%+ below average */
}

/* ─── Backtest engine (futures mode with no-flip when SL+TP set) ─── */
function runBacktest(candles, strategy, { leverage, slPct, tpPct, amtPerTrade, startBal, trendFilter = false, cooldown = false }) {
  let balance = startBal;
  const trades = [];
  const lastAction = {};
  let maxBal = startBal, maxDD = 0, liquidations = 0;
  const openPositions = [];
  const hasSlTp = slPct > 0 && tpPct > 0;
  let consecutiveLosses = 0;
  let cooldownUntil = 0; // candle index until which trading is paused
  const COOLDOWN_LOSSES = 3; // pause after N consecutive losses
  const COOLDOWN_CANDLES = 5; // pause for N candles
  let filteredByTrend = 0, filteredByCooldown = 0;

  for (let i = 0; i < candles.length; i++) {
    /* check SL/TP/liquidation */
    for (let p = openPositions.length - 1; p >= 0; p--) {
      const pos = openPositions[p];
      const candle = candles[i];
      const highPrice = candle.h, lowPrice = candle.l;

      const worstPrice = pos.side === "LONG" ? lowPrice : highPrice;
      const worstPnl = pos.side === "LONG"
        ? ((worstPrice - pos.entry) / pos.entry) * pos.margin * pos.leverage
        : ((pos.entry - worstPrice) / pos.entry) * pos.margin * pos.leverage;
      if (worstPnl <= -pos.margin * 0.9) {
        liquidations++;
        openPositions.splice(p, 1);
        trades.push({ pnl: -pos.margin, type: "LIQ" });
        continue;
      }

      if (pos.sl) {
        const slHit = pos.side === "LONG" ? lowPrice <= pos.sl : highPrice >= pos.sl;
        if (slHit) {
          const pnl = pos.side === "LONG"
            ? ((pos.sl - pos.entry) / pos.entry) * pos.margin * pos.leverage
            : ((pos.entry - pos.sl) / pos.entry) * pos.margin * pos.leverage;
          const closeFee = pos.notional * FUT_FEE;
          balance += pos.margin + pnl - closeFee;
          openPositions.splice(p, 1);
          trades.push({ pnl, type: "SL" });
          continue;
        }
      }

      if (pos.tp) {
        const tpHit = pos.side === "LONG" ? highPrice >= pos.tp : lowPrice <= pos.tp;
        if (tpHit) {
          const pnl = pos.side === "LONG"
            ? ((pos.tp - pos.entry) / pos.entry) * pos.margin * pos.leverage
            : ((pos.entry - pos.tp) / pos.entry) * pos.margin * pos.leverage;
          const closeFee = pos.notional * FUT_FEE;
          balance += pos.margin + pnl - closeFee;
          openPositions.splice(p, 1);
          trades.push({ pnl, type: "TP" });
          continue;
        }
      }
    }

    /* track consecutive losses for cooldown */
    if (trades.length > 0) {
      const lastTrade = trades[trades.length - 1];
      if (lastTrade.type === "SL" || lastTrade.type === "LIQ") {
        consecutiveLosses++;
        if (cooldown && consecutiveLosses >= COOLDOWN_LOSSES) {
          cooldownUntil = i + COOLDOWN_CANDLES;
          consecutiveLosses = 0;
        }
      } else if (lastTrade.type === "TP") {
        consecutiveLosses = 0;
      }
    }

    /* strategy signals */
    const sym = "BTCUSDT";
    const slice = candles.slice(Math.max(0, i - 99), i + 1);
    if (slice.length < 5) continue;
    const price = slice[slice.length - 1].c;
    const sig = evalSignal(strategy, slice);
    if (!sig) continue;
    const { action } = sig;
    if (lastAction[sym] === action) continue;

    /* cooldown check */
    if (cooldown && i < cooldownUntil) { filteredByCooldown++; lastAction[sym] = action; continue; }

    /* volatility filter check */
    if (trendFilter) {
      if (isLowVolatility(candles, i)) { filteredByTrend++; lastAction[sym] = action; continue; }
    }

    const existingPos = openPositions.find((p) => p.sym === sym);
    const isGrid = strategy === "grid";

    /* Grid bot: BUY → open LONG, SELL → close LONG only (no SHORT) */
    if (isGrid) {
      if (action === "SELL" && existingPos && existingPos.side === "LONG") {
        const pnl = ((price - existingPos.entry) / existingPos.entry) * existingPos.margin * existingPos.leverage;
        const closeFee = existingPos.notional * FUT_FEE;
        balance += existingPos.margin + pnl - closeFee;
        openPositions.splice(openPositions.indexOf(existingPos), 1);
        trades.push({ pnl, type: pnl > 0 ? "TP" : "SL" });
        lastAction[sym] = action;
        continue;
      }
      if (action === "SELL") { lastAction[sym] = action; continue; }
    }

    let fSide = action === "BUY" ? "LONG" : "SHORT";

    /* no-flip when SL+TP set */
    if (hasSlTp && existingPos) { lastAction[sym] = action; continue; }

    /* close opposite (only when no SL/TP) */
    if (existingPos && !hasSlTp && ((existingPos.side === "LONG" && fSide === "SHORT") || (existingPos.side === "SHORT" && fSide === "LONG"))) {
      const pnl = existingPos.side === "LONG"
        ? ((price - existingPos.entry) / existingPos.entry) * existingPos.margin * existingPos.leverage
        : ((existingPos.entry - price) / existingPos.entry) * existingPos.margin * existingPos.leverage;
      const closeFee = existingPos.notional * FUT_FEE;
      balance += existingPos.margin + pnl - closeFee;
      openPositions.splice(openPositions.indexOf(existingPos), 1);
      trades.push({ pnl, type: "FLIP" });
    }

    /* open new */
    const samePos = openPositions.find((p) => p.sym === sym && p.side === fSide);
    if (!samePos) {
      const notional = amtPerTrade;
      const margin = notional / leverage;
      const openFee = notional * FUT_FEE;
      if (margin + openFee > balance) { lastAction[sym] = action; continue; }
      balance -= margin + openFee;
      const sl = slPct > 0 ? (fSide === "LONG" ? price * (1 - slPct / 100) : price * (1 + slPct / 100)) : undefined;
      const tp = tpPct > 0 ? (fSide === "LONG" ? price * (1 + tpPct / 100) : price * (1 - tpPct / 100)) : undefined;
      openPositions.push({ sym, side: fSide, entry: price, margin, notional, leverage, sl, tp });
      trades.push({ pnl: 0, type: "OPEN" });
    }
    lastAction[sym] = action;

    /* track DD */
    let eq = balance;
    openPositions.forEach((pos) => {
      const cp = candles[i].c;
      const pnl = pos.side === "LONG"
        ? ((cp - pos.entry) / pos.entry) * pos.margin * pos.leverage
        : ((pos.entry - cp) / pos.entry) * pos.margin * pos.leverage;
      eq += pos.margin + pnl;
    });
    if (eq > maxBal) maxBal = eq;
    const dd = (eq - maxBal) / maxBal * 100;
    if (dd < maxDD) maxDD = dd;
  }

  /* close remaining */
  openPositions.forEach((pos) => {
    const cp = candles[candles.length - 1].c;
    const pnl = pos.side === "LONG"
      ? ((cp - pos.entry) / pos.entry) * pos.margin * pos.leverage
      : ((pos.entry - cp) / pos.entry) * pos.margin * pos.leverage;
    balance += pos.margin + pnl - pos.notional * FUT_FEE;
  });

  const totalTrades = trades.filter(t => t.type !== "OPEN").length;
  const wins = trades.filter(t => t.type !== "OPEN" && t.pnl > 0).length;
  const pnl = balance - startBal;
  return {
    pnl,
    pnlPct: (pnl / startBal * 100),
    trades: totalTrades,
    winRate: totalTrades > 0 ? (wins / totalTrades * 100) : 0,
    maxDD,
    liquidations,
    finalBal: balance,
    filteredByTrend,
    filteredByCooldown,
  };
}

/* ─── Main ─── */
const STRATEGIES = ["rsi", "macd", "donchian", "smc_fvg", "smc_bos", "smc_ob", "ema_cross", "bbands", "stoch_rsi", "scalp_pa", "scalp_smc_ind", "scalp_sma_ema", "grid"];
const STRAT_NAMES = {
  rsi: "RSI", macd: "MACD", donchian: "Donchian", smc_fvg: "SMC FVG", smc_bos: "SMC BOS",
  smc_ob: "SMC OB", ema_cross: "EMA Cross", bbands: "BBands", stoch_rsi: "StochRSI",
  scalp_pa: "Scalp PA", scalp_smc_ind: "Scalp SMC", scalp_sma_ema: "Scalp SMA×EMA",
  grid: "Grid Bot"
};

const CONFIGS = [
  /* baseline (no filters) */
  { tf: "1h", period: 90, lev: 5, sl: 2, tp: 5, amt: 300, trend: false, cool: false },
  { tf: "1h", period: 180, lev: 5, sl: 2, tp: 5, amt: 300, trend: false, cool: false },
  { tf: "1h", period: 365, lev: 5, sl: 2, tp: 5, amt: 300, trend: false, cool: false },
  { tf: "4h", period: 90, lev: 5, sl: 2, tp: 6, amt: 300, trend: false, cool: false },
  { tf: "4h", period: 180, lev: 5, sl: 2, tp: 6, amt: 300, trend: false, cool: false },
  { tf: "4h", period: 365, lev: 5, sl: 2, tp: 6, amt: 300, trend: false, cool: false },
  /* with trend filter */
  { tf: "1h", period: 90, lev: 5, sl: 2, tp: 5, amt: 300, trend: true, cool: false },
  { tf: "1h", period: 180, lev: 5, sl: 2, tp: 5, amt: 300, trend: true, cool: false },
  { tf: "1h", period: 365, lev: 5, sl: 2, tp: 5, amt: 300, trend: true, cool: false },
  { tf: "4h", period: 90, lev: 5, sl: 2, tp: 6, amt: 300, trend: true, cool: false },
  { tf: "4h", period: 180, lev: 5, sl: 2, tp: 6, amt: 300, trend: true, cool: false },
  { tf: "4h", period: 365, lev: 5, sl: 2, tp: 6, amt: 300, trend: true, cool: false },
  /* with trend filter + cooldown */
  { tf: "1h", period: 90, lev: 5, sl: 2, tp: 5, amt: 300, trend: true, cool: true },
  { tf: "1h", period: 180, lev: 5, sl: 2, tp: 5, amt: 300, trend: true, cool: true },
  { tf: "1h", period: 365, lev: 5, sl: 2, tp: 5, amt: 300, trend: true, cool: true },
  { tf: "4h", period: 90, lev: 5, sl: 2, tp: 6, amt: 300, trend: true, cool: true },
  { tf: "4h", period: 180, lev: 5, sl: 2, tp: 6, amt: 300, trend: true, cool: true },
  { tf: "4h", period: 365, lev: 5, sl: 2, tp: 6, amt: 300, trend: true, cool: true },
];

async function main() {
  console.log("=== BACKTEST ALL STRATEGIES ===\n");

  /* pre-fetch candles for all needed timeframes/periods */
  const candleCache = {};
  const endMs = Date.now();

  for (const cfg of CONFIGS) {
    const key = `${cfg.tf}_${cfg.period}`;
    if (candleCache[key]) continue;
    const startMs = endMs - cfg.period * 86400_000;
    console.log(`Fetching BTC ${cfg.tf} candles for ${cfg.period}d...`);
    candleCache[key] = await fetchCandles("BTCUSDT", cfg.tf, startMs, endMs);
    console.log(`  → ${candleCache[key].length} candles\n`);
  }

  const results = [];

  for (const strat of STRATEGIES) {
    for (const cfg of CONFIGS) {
      const key = `${cfg.tf}_${cfg.period}`;
      const candles = candleCache[key];
      if (!candles || candles.length < 30) continue;

      const res = runBacktest(candles, strat, {
        leverage: cfg.lev,
        slPct: cfg.sl,
        tpPct: cfg.tp,
        amtPerTrade: cfg.amt,
        startBal: 1000,
        trendFilter: cfg.trend || false,
        cooldown: cfg.cool || false,
      });

      const filters = (cfg.trend ? "T" : "") + (cfg.cool ? "C" : "") || "-";
      const periodStr = cfg.period >= 365 ? "1y" : cfg.period >= 180 ? "6m" : "3m";
      results.push({
        strategy: STRAT_NAMES[strat],
        config: `${cfg.tf} ${periodStr} x${cfg.lev} SL${cfg.sl}/TP${cfg.tp} [${filters}]`,
        filters,
        period: cfg.period,
        ...res,
      });
    }
  }

  /* sort by PnL descending */
  results.sort((a, b) => b.pnlPct - a.pnlPct);

  /* print table */
  console.log("┌─────────────────┬─────────────────────────────────┬──────────┬────────┬────────┬─────────┬─────┐");
  console.log("│ Strategy        │ Config                          │  P&L %   │ Trades │ WR %   │ Max DD  │ Liq │");
  console.log("├─────────────────┼─────────────────────────────────┼──────────┼────────┼────────┼─────────┼─────┤");

  for (const r of results) {
    const strat = r.strategy.padEnd(15);
    const config = r.config.padEnd(31);
    const pnl = (r.pnlPct >= 0 ? "+" : "") + r.pnlPct.toFixed(1) + "%";
    const pnlPad = pnl.padStart(8);
    const trades = String(r.trades).padStart(6);
    const wr = r.winRate.toFixed(1).padStart(5) + "%";
    const dd = r.maxDD.toFixed(1) + "%";
    const ddPad = dd.padStart(7);
    const liq = String(r.liquidations).padStart(3);
    console.log(`│ ${strat} │ ${config} │ ${pnlPad} │ ${trades} │ ${wr} │ ${ddPad} │ ${liq} │`);
  }
  console.log("└─────────────────┴─────────────────────────────────┴──────────┴────────┴────────┴─────────┴─────┘");

  /* top 10 */
  console.log("\n🏆 TOP 10:");
  results.slice(0, 10).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.strategy} | ${r.config} | P&L: ${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(1)}% | WR: ${r.winRate.toFixed(1)}% | ${r.trades} trades | DD: ${r.maxDD.toFixed(1)}%`);
  });

  console.log("\n💀 WORST 5:");
  results.slice(-5).forEach((r) => {
    console.log(`  ${r.strategy} | ${r.config} | P&L: ${r.pnlPct.toFixed(1)}% | WR: ${r.winRate.toFixed(1)}% | ${r.trades} trades`);
  });
}

main().catch(console.error);
