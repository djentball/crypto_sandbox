"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";

/* ─────────────────── helpers ─────────────────── */
const fmt = (n: number, d = 2) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtP = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n)}%`;
const uid = () => Math.random().toString(36).slice(2, 10);
const ts = () => new Date().toLocaleString("uk-UA", { hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const NICE: Record<string, string> = { BTCUSDT: "BTC", ETHUSDT: "ETH", SOLUSDT: "SOL", BNBUSDT: "BNB", XRPUSDT: "XRP" };
const SPOT_FEE = 0.001;
const FUT_FEE = 0.0004;
const LEVERAGES = [1, 2, 5, 10, 20];
const PRICE_INTERVAL = 900_000; /* 15 хвилин */
const MOCK_BASE: Record<string, number> = { BTCUSDT: 67500, ETHUSDT: 3420, SOLUSDT: 172, BNBUSDT: 605, XRPUSDT: 0.62 };
const maxHist = 100;

const STRATEGIES: Record<string, { name: string; desc: string }> = {
  none:      { name: "Без стратегії", desc: "Ручна торгівля" },
  rsi:       { name: "RSI Mean Reversion", desc: "BUY при RSI<30, SELL при RSI>70" },
  macd:      { name: "MACD Crossover", desc: "BUY коли MACD перетинає сигнал знизу, SELL — зверху" },
  donchian:  { name: "Donchian Breakout", desc: "BUY при пробої верхнього каналу (20), SELL при пробої нижнього" },
  smc_fvg:   { name: "SMC: Fair Value Gap", desc: "BUY коли ціна входить в бичачий FVG, SELL — у ведмежий" },
  smc_bos:   { name: "SMC: Break of Structure", desc: "BUY при бичачому BOS, SELL при ведмежому BOS" },
  smc_ob:    { name: "SMC: Order Block", desc: "BUY при поверненні в бичачий OB, SELL — у ведмежий OB" },
};

const TIMEFRAMES: Record<string, { label: string; ms: number; binance: string }> = {
  "15m": { label: "15 хв", ms: 900_000, binance: "15m" },
  "1h":  { label: "1 год", ms: 3_600_000, binance: "1h" },
  "4h":  { label: "4 год", ms: 14_400_000, binance: "4h" },
};

/* ── candle type ── */
interface Candle { o: number; h: number; l: number; c: number; t: number; }

/* ── types ── */
interface Trade {
  id: string; time: string; sym: string; inst: string; side: string;
  price: number; amount: number; fee: number; qty: number;
  sl?: number; tp?: number;
}
interface Future {
  id: string; sym: string; side: string; leverage: number;
  entry: number; margin: number; notional: number; fee: number;
  openTime: string; liquidated: boolean; liqTime?: string;
  sl?: number; tp?: number; closedBySl?: boolean; closedByTp?: boolean;
}
interface Strategy {
  type: string; symbols: string[]; amountPerTrade: number; timeframe: string;
  active: boolean; log: { time: string; sym: string; action: string; price: number; amount: number; reason: string }[];
}
interface User {
  id: string; name: string; startBal: number; balance: number;
  spot: Record<string, number>; futures: Future[]; trades: Trade[];
  strategy: Strategy;
}

/* ── API helpers ── */
const api = {
  async getUsers(): Promise<User[]> {
    const res = await fetch("/api/users");
    const rows = await res.json();
    return rows.map((r: any) => ({
      id: r.id, name: r.name, startBal: r.start_bal, balance: r.balance,
      spot: r.spot || {}, futures: r.futures || [],
      trades: [],
      strategy: {
        type: r.strategy_type || "none",
        symbols: r.strategy_symbols || ["BTCUSDT"],
        amountPerTrade: r.strategy_amount || 100,
        timeframe: r.strategy_timeframe || "15m",
        active: r.strategy_active || false,
        log: [],
      },
    }));
  },
  async createUser(name: string, startBal: number) {
    const res = await fetch("/api/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, startBal }),
    });
    return res.json();
  },
  async deleteUser(id: string) {
    await fetch(`/api/users?id=${id}`, { method: "DELETE" });
  },
  async updateUser(id: string, data: { name?: string; balance?: number; spot?: Record<string, number>; futures?: Future[] }) {
    await fetch(`/api/users/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async getTrades(userId: string): Promise<Trade[]> {
    const res = await fetch(`/api/trades?userId=${userId}`);
    const rows = await res.json();
    return rows.map((r: any) => ({
      id: r.id, time: r.time, sym: r.symbol, inst: r.instrument,
      side: r.side, price: r.price, amount: r.amount, fee: r.fee, qty: r.qty,
    }));
  },
  async recordTrade(userId: string, t: Trade) {
    await fetch("/api/trades", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId, time: t.time, symbol: t.sym, instrument: t.inst,
        side: t.side, price: t.price, amount: t.amount, fee: t.fee, qty: t.qty,
      }),
    });
  },
  async updateStrategy(userId: string, s: Partial<Strategy>) {
    await fetch("/api/strategies", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, type: s.type, symbols: s.symbols, amountPerTrade: s.amountPerTrade, timeframe: s.timeframe, active: s.active }),
    });
  },
  async getStrategyLog(userId: string) {
    const res = await fetch(`/api/strategies?userId=${userId}`);
    const rows = await res.json();
    return rows.map((r: any) => ({
      time: r.time, sym: r.symbol, action: r.action, price: r.price, amount: r.amount, reason: r.reason,
    }));
  },
  async recordStrategyLog(userId: string, entry: { time: string; sym: string; action: string; price: number; amount: number; reason: string }) {
    await fetch("/api/strategies", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ...entry, symbol: entry.sym }),
    });
  },
};

/* ─────────────── main component ─────────────── */
export default function TradingApp() {
  /* ---- prices ---- */
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [startPrices, setStartPrices] = useState<Record<string, number>>({});
  const [candleHistory, setCandleHistory] = useState<Record<string, Candle[]>>(() =>
    Object.fromEntries(SYMBOLS.map((s) => [s, []]))
  );
  /* multi-timeframe candle cache for strategies: { "1h": { "BTCUSDT": Candle[], ... }, ... } */
  const [tfCandles, setTfCandles] = useState<Record<string, Record<string, Candle[]>>>({});
  const tfLoadedRef = useRef<Set<string>>(new Set());

  /* load candles for a specific timeframe (on demand) */
  const loadTimeframeCandles = useCallback(async (tf: string) => {
    if (tf === "15m" || tfLoadedRef.current.has(tf)) return; /* 15m is default candleHistory */
    tfLoadedRef.current.add(tf);
    const tfConf = TIMEFRAMES[tf];
    if (!tfConf) return;
    try {
      const results = await Promise.allSettled(
        SYMBOLS.map(async (sym) => {
          const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${tfConf.binance}&limit=${maxHist}`);
          if (!r.ok) throw new Error("api");
          const data = await r.json();
          return { sym, candles: data.map((k: any) => ({ o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), t: k[0] } as Candle)) };
        })
      );
      setTfCandles((prev) => {
        const n = { ...prev, [tf]: { ...(prev[tf] || {}) } };
        results.forEach((r) => {
          if (r.status === "fulfilled") n[tf][r.value.sym] = r.value.candles;
        });
        return n;
      });
      tickRef.current += 1; /* trigger strategy re-evaluation */
    } catch { /* ignore */ }
  }, []);

  /* backwards-compat: closing-price array for RSI/SMA/MACD */
  const priceHistory = useMemo(() => {
    const m: Record<string, number[]> = {};
    SYMBOLS.forEach((s) => { m[s] = (candleHistory[s] || []).map((c) => c.c); });
    return m;
  }, [candleHistory]);

  const startPricesSet = useRef(false);
  const tickRef = useRef(0);

  /* Fetch last N 15-min klines per symbol */
  const fetchCandles = useCallback(async (): Promise<{ prices: Record<string, number>; candles: Record<string, Candle> }> => {
    const pricesMap: Record<string, number> = {};
    const candlesMap: Record<string, Candle> = {};
    const results = await Promise.allSettled(
      SYMBOLS.map(async (sym) => {
        const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&limit=1`);
        if (!r.ok) throw new Error("api");
        const data = await r.json();
        const k = data[0]; /* [openTime, o, h, l, c, vol, closeTime, ...] */
        const candle: Candle = { o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), t: k[0] };
        pricesMap[sym] = candle.c;
        candlesMap[sym] = candle;
      })
    );
    /* fallback for failed symbols */
    const base = Object.keys(prices).length ? prices : MOCK_BASE;
    SYMBOLS.forEach((s) => {
      if (!pricesMap[s]) {
        const p = base[s] * (1 + (Math.random() - 0.5) * 0.006);
        pricesMap[s] = p;
        candlesMap[s] = { o: p * 0.999, h: p * 1.001, l: p * 0.998, c: p, t: Date.now() };
      }
    });
    return { prices: pricesMap, candles: candlesMap };
  }, [prices]);

  /* initial load: fetch recent history (100 candles) */
  const histLoaded = useRef(false);
  useEffect(() => {
    if (histLoaded.current) return;
    histLoaded.current = true;
    (async () => {
      try {
        const results = await Promise.allSettled(
          SYMBOLS.map(async (sym) => {
            const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&limit=${maxHist}`);
            if (!r.ok) throw new Error("api");
            const data = await r.json();
            return { sym, candles: data.map((k: any) => ({ o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), t: k[0] } as Candle)) };
          })
        );
        setCandleHistory((prev) => {
          const n = { ...prev };
          results.forEach((r) => {
            if (r.status === "fulfilled") n[r.value.sym] = r.value.candles;
          });
          return n;
        });
        /* set initial prices from last candle */
        const p: Record<string, number> = {};
        results.forEach((r) => {
          if (r.status === "fulfilled" && r.value.candles.length > 0) {
            p[r.value.sym] = r.value.candles[r.value.candles.length - 1].c;
          }
        });
        if (Object.keys(p).length > 0) {
          setPrices(p);
          if (!startPricesSet.current) { setStartPrices(p); startPricesSet.current = true; }
          tickRef.current += 1;
        }
      } catch { /* fallback handled by interval */ }
    })();
  }, []);

  /* periodic tick: append new candle */
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const { prices: p, candles: c } = await fetchCandles();
      if (!live) return;
      setPrices(p);
      tickRef.current += 1;
      if (!startPricesSet.current) { setStartPrices(p); startPricesSet.current = true; }
      setCandleHistory((h) => {
        const n = { ...h };
        SYMBOLS.forEach((s) => {
          const prev = h[s] || [];
          const last = prev[prev.length - 1];
          /* replace if same candle time, append if new */
          if (last && c[s] && last.t === c[s].t) {
            n[s] = [...prev.slice(0, -1), c[s]].slice(-maxHist);
          } else {
            n[s] = [...prev, c[s]].slice(-maxHist);
          }
        });
        return n;
      });
    };
    const id = setInterval(tick, PRICE_INTERVAL);
    return () => { live = false; clearInterval(id); };
  }, []);

  /* ---- users (loaded from DB) ---- */
  const [users, setUsers] = useState<User[]>([]);
  const [activeUserId, setActiveUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getUsers().then((u) => {
      setUsers(u);
      if (u.length > 0) setActiveUserId(u[0].id);
      setLoading(false);
    });
  }, []);

  const activeUser = users.find((u) => u.id === activeUserId) || users[0];

  /* load trades when switching user */
  useEffect(() => {
    if (!activeUserId) return;
    api.getTrades(activeUserId).then((trades) => {
      setUsers((prev) => prev.map((u) => u.id === activeUserId ? { ...u, trades } : u));
    });
    api.getStrategyLog(activeUserId).then((log) => {
      setUsers((prev) => prev.map((u) => u.id === activeUserId ? { ...u, strategy: { ...u.strategy, log } } : u));
    });
  }, [activeUserId]);

  const updateUser = (id: string, fn: (u: User) => User) =>
    setUsers((prev) => prev.map((u) => (u.id === id ? fn({ ...u }) : u)));

  /* persist user state to DB (debounced) */
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  const persistUser = useCallback((u: User) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      api.updateUser(u.id, { balance: u.balance, spot: u.spot, futures: u.futures });
    }, 500);
  }, []);

  /* new user dialog */
  const [showNewUser, setShowNewUser] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBal, setNewBal] = useState("1000");
  const addUser = async () => {
    if (!newName.trim()) return;
    const b = Math.max(0, parseFloat(newBal) || 1000);
    const res = await api.createUser(newName.trim(), b);
    const u: User = {
      id: res.id, name: res.name, startBal: res.startBal, balance: res.balance,
      spot: {}, futures: [], trades: [],
      strategy: { type: "none", symbols: ["BTCUSDT"], amountPerTrade: 100, timeframe: "15m", active: false, log: [] },
    };
    setUsers((p) => [...p, u]);
    setActiveUserId(u.id);
    setShowNewUser(false);
    setNewName("");
    setNewBal("1000");
  };

  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const delUser = async (id: string) => {
    await api.deleteUser(id);
    setUsers((p) => p.filter((u) => u.id !== id));
    if (activeUserId === id) {
      const remaining = users.filter((u) => u.id !== id);
      if (remaining.length > 0) setActiveUserId(remaining[0].id);
    }
    setConfirmDel(null);
  };

  /* ---- rename user ---- */
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const startRename = (u: User) => { setEditingUserId(u.id); setEditName(u.name); };
  const saveRename = async () => {
    if (!editingUserId || !editName.trim()) return;
    const name = editName.trim();
    updateUser(editingUserId, (u) => ({ ...u, name }));
    await api.updateUser(editingUserId, { name });
    setEditingUserId(null);
  };

  const [instrument, setInstrument] = useState("SPOT");
  const [view, setView] = useState("market");

  /* ═══ BACKTEST STATE ═══ */
  interface BtTrade { time: number; sym: string; action: string; price: number; amount: number; fee: number; reason: string; balance: number; pnl?: number; }
  interface BtResult { trades: BtTrade[]; finalBalance: number; startBalance: number; maxDrawdown: number; winRate: number; totalTrades: number; equity: { t: number; v: number }[]; liquidations: number; instrument: string; }
  const [btStrategy, setBtStrategy] = useState("rsi");
  const [btSymbols, setBtSymbols] = useState<string[]>(["BTCUSDT"]);
  const [btTimeframe, setBtTimeframe] = useState("1h");
  const [btPeriod, setBtPeriod] = useState("3m");
  const [btBalance, setBtBalance] = useState("1000");
  const [btAmount, setBtAmount] = useState("100");
  const [btInstrument, setBtInstrument] = useState("SPOT");
  const [btLeverage, setBtLeverage] = useState(5);
  const [btSide, setBtSide] = useState<"AUTO" | "LONG" | "SHORT">("AUTO");
  const [btSl, setBtSl] = useState("");
  const [btTp, setBtTp] = useState("");
  const [btRunning, setBtRunning] = useState(false);
  const [btResult, setBtResult] = useState<BtResult | null>(null);
  const [btProgress, setBtProgress] = useState("");

  const BT_PERIODS: Record<string, { label: string; days: number }> = {
    "1m": { label: "1 місяць", days: 30 },
    "3m": { label: "3 місяці", days: 90 },
    "6m": { label: "6 місяців", days: 180 },
    "1y": { label: "1 рік", days: 365 },
  };

  const fetchHistCandles = async (sym: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> => {
    const all: Candle[] = [];
    let cursor = startMs;
    while (cursor < endMs) {
      const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=1000`;
      const r = await fetch(url);
      if (!r.ok) break;
      const data = await r.json();
      if (!data.length) break;
      data.forEach((k: any) => all.push({ o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), t: k[0] }));
      cursor = data[data.length - 1][0] + 1;
      if (data.length < 1000) break;
    }
    return all;
  };

  /* helper: evaluate strategy signal on a candle slice */
  const evalSignal = (strat: string, slice: Candle[]): { action: string; reason: string } | null => {
    const h = slice.map((c) => c.c);
    if (strat === "rsi") {
      const rsi = calcRSI(h);
      if (rsi !== null && rsi < 30) return { action: "BUY", reason: `RSI=${fmt(rsi,1)}<30` };
      if (rsi !== null && rsi > 70) return { action: "SELL", reason: `RSI=${fmt(rsi,1)}>70` };
    } else if (strat === "macd") {
      const macdNow = calcMACD(h);
      const macdPrev = h.length > 26 ? calcMACD(h.slice(0, -1)) : null;
      if (macdNow && macdPrev) {
        if (macdPrev.histogram <= 0 && macdNow.histogram > 0) return { action: "BUY", reason: "MACD cross ▲" };
        if (macdPrev.histogram >= 0 && macdNow.histogram < 0) return { action: "SELL", reason: "MACD cross ▼" };
      }
    } else if (strat === "donchian") {
      if (slice.length >= 21) {
        const lookback = slice.slice(-21, -1);
        const dcHigh = Math.max(...lookback.map((c) => c.h));
        const dcLow = Math.min(...lookback.map((c) => c.l));
        const last = slice[slice.length - 1];
        if (last.c > dcHigh) return { action: "BUY", reason: `Breakout ▲ ${fmt(dcHigh,2)}` };
        if (last.c < dcLow) return { action: "SELL", reason: `Breakdown ▼ ${fmt(dcLow,2)}` };
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
    }
    return null;
  };

  const runBacktest = async () => {
    setBtRunning(true);
    setBtResult(null);
    setBtProgress("Завантаження свічок...");
    const periodDays = BT_PERIODS[btPeriod]?.days || 90;
    const endMs = Date.now();
    const startMs = endMs - periodDays * 86400_000;
    const tfBinance = TIMEFRAMES[btTimeframe]?.binance || "1h";
    const isFutures = btInstrument === "FUTURES";

    /* fetch candles for all selected symbols */
    const candleMap: Record<string, Candle[]> = {};
    for (let i = 0; i < btSymbols.length; i++) {
      const sym = btSymbols[i];
      setBtProgress(`Завантаження ${NICE[sym] || sym} (${i + 1}/${btSymbols.length})...`);
      candleMap[sym] = await fetchHistCandles(sym, tfBinance, startMs, endMs);
    }

    setBtProgress("Запуск стратегії...");
    const startBal = parseFloat(btBalance) || 1000;
    const amtPerTrade = parseFloat(btAmount) || 100;
    let balance = startBal;
    const trades: BtTrade[] = [];
    const equity: { t: number; v: number }[] = [];
    const lastAction: Record<string, string> = {};
    let liquidations = 0;

    /* find max candle count to iterate */
    const maxLen = Math.max(...btSymbols.map((s) => candleMap[s]?.length || 0));

    if (!isFutures) {
      /* ── SPOT MODE ── */
      const holdings: Record<string, number> = {};
      for (let i = 0; i < maxLen; i++) {
        btSymbols.forEach((sym) => {
          const candles = candleMap[sym];
          if (!candles || i >= candles.length) return;
          const slice = candles.slice(0, i + 1);
          if (slice.length < 5) return;
          const price = slice[slice.length - 1].c;
          const sig = evalSignal(btStrategy, slice);
          if (!sig) return;
          const { action, reason } = sig;
          if (lastAction[sym] === action) return;
          const time = candles[i].t;
          if (action === "BUY" && balance >= amtPerTrade) {
            const got = (amtPerTrade / price) * (1 - SPOT_FEE);
            const fee = amtPerTrade * SPOT_FEE;
            balance -= amtPerTrade;
            holdings[sym] = (holdings[sym] || 0) + got;
            trades.push({ time, sym, action: "BUY", price, amount: amtPerTrade, fee, reason, balance });
            lastAction[sym] = "BUY";
          } else if (action === "BUY") {
            lastAction[sym] = "BUY";
          } else if (action === "SELL") {
            const held = holdings[sym] || 0;
            const sellQty = Math.min(amtPerTrade / price, held);
            if (sellQty > 0) {
              const got = sellQty * price * (1 - SPOT_FEE);
              const fee = sellQty * price * SPOT_FEE;
              holdings[sym] = held - sellQty;
              if (holdings[sym] < 1e-10) delete holdings[sym];
              balance += got;
              trades.push({ time, sym, action: "SELL", price, amount: sellQty * price, fee, reason, balance });
            }
            lastAction[sym] = "SELL";
          }
        });
        if (i % 10 === 0 || i === maxLen - 1) {
          let eq = balance;
          Object.entries(holdings).forEach(([s, qty]) => {
            const c = candleMap[s]; if (c && c[Math.min(i, c.length - 1)]) eq += qty * c[Math.min(i, c.length - 1)].c;
          });
          const t = candleMap[btSymbols[0]]?.[Math.min(i, (candleMap[btSymbols[0]]?.length || 1) - 1)]?.t || 0;
          equity.push({ t, v: eq });
        }
      }
      /* close remaining */
      btSymbols.forEach((sym) => {
        const held = holdings[sym] || 0;
        if (held > 0) { const lp = candleMap[sym]?.[candleMap[sym].length - 1]?.c || 0; balance += held * lp * (1 - SPOT_FEE); }
      });
    } else {
      /* ── FUTURES MODE ── */
      interface BtFuture { sym: string; side: "LONG" | "SHORT"; entry: number; margin: number; notional: number; leverage: number; sl?: number; tp?: number; }
      const openPositions: BtFuture[] = [];
      const leverage = btLeverage;
      const slPct = btSl ? parseFloat(btSl) : 0; /* % from entry */
      const tpPct = btTp ? parseFloat(btTp) : 0;

      for (let i = 0; i < maxLen; i++) {
        /* check SL/TP/liquidation on open positions using candle OHLC */
        for (let p = openPositions.length - 1; p >= 0; p--) {
          const pos = openPositions[p];
          const candles = candleMap[pos.sym];
          if (!candles || i >= candles.length) continue;
          const candle = candles[i];
          const highPrice = candle.h;
          const lowPrice = candle.l;

          /* liquidation check: PnL <= -margin * 0.9 */
          const worstPrice = pos.side === "LONG" ? lowPrice : highPrice;
          const worstPnl = pos.side === "LONG"
            ? ((worstPrice - pos.entry) / pos.entry) * pos.margin * pos.leverage
            : ((pos.entry - worstPrice) / pos.entry) * pos.margin * pos.leverage;
          if (worstPnl <= -pos.margin * 0.9) {
            trades.push({ time: candle.t, sym: pos.sym, action: `LIQ ${pos.side}`, price: worstPrice, amount: pos.notional, fee: 0, reason: "Ліквідація", balance, pnl: -pos.margin });
            liquidations++;
            openPositions.splice(p, 1);
            continue;
          }

          /* SL check */
          if (pos.sl) {
            const slHit = pos.side === "LONG" ? lowPrice <= pos.sl : highPrice >= pos.sl;
            if (slHit) {
              const closePrice = pos.sl;
              const pnl = pos.side === "LONG"
                ? ((closePrice - pos.entry) / pos.entry) * pos.margin * pos.leverage
                : ((pos.entry - closePrice) / pos.entry) * pos.margin * pos.leverage;
              const closeFee = pos.notional * FUT_FEE;
              balance += pos.margin + pnl - closeFee;
              trades.push({ time: candle.t, sym: pos.sym, action: `SL ${pos.side}`, price: closePrice, amount: pos.notional, fee: closeFee, reason: `SL ${fmt(pos.sl, pos.sl < 1 ? 4 : 2)}`, balance, pnl });
              openPositions.splice(p, 1);
              continue;
            }
          }

          /* TP check */
          if (pos.tp) {
            const tpHit = pos.side === "LONG" ? highPrice >= pos.tp : lowPrice <= pos.tp;
            if (tpHit) {
              const closePrice = pos.tp;
              const pnl = pos.side === "LONG"
                ? ((closePrice - pos.entry) / pos.entry) * pos.margin * pos.leverage
                : ((pos.entry - closePrice) / pos.entry) * pos.margin * pos.leverage;
              const closeFee = pos.notional * FUT_FEE;
              balance += pos.margin + pnl - closeFee;
              trades.push({ time: candle.t, sym: pos.sym, action: `TP ${pos.side}`, price: closePrice, amount: pos.notional, fee: closeFee, reason: `TP ${fmt(pos.tp, pos.tp < 1 ? 4 : 2)}`, balance, pnl });
              openPositions.splice(p, 1);
              continue;
            }
          }
        }

        /* strategy signals → open/close positions */
        btSymbols.forEach((sym) => {
          const candles = candleMap[sym];
          if (!candles || i >= candles.length) return;
          const slice = candles.slice(0, i + 1);
          if (slice.length < 5) return;
          const price = slice[slice.length - 1].c;
          const sig = evalSignal(btStrategy, slice);
          if (!sig) return;
          const { action, reason } = sig;
          if (lastAction[sym] === action) return;

          const time = candles[i].t;
          const existingPos = openPositions.find((p) => p.sym === sym);

          /* determine futures side */
          let fSide: "LONG" | "SHORT" | null = null;
          if (btSide === "AUTO") {
            if (action === "BUY") fSide = "LONG";
            if (action === "SELL") fSide = "SHORT";
          } else if (btSide === "LONG" && action === "BUY") {
            fSide = "LONG";
          } else if (btSide === "SHORT" && action === "SELL") {
            fSide = "SHORT";
          }

          /* close opposite position first */
          if (existingPos && fSide && ((existingPos.side === "LONG" && fSide === "SHORT") || (existingPos.side === "SHORT" && fSide === "LONG"))) {
            const pnl = existingPos.side === "LONG"
              ? ((price - existingPos.entry) / existingPos.entry) * existingPos.margin * existingPos.leverage
              : ((existingPos.entry - price) / existingPos.entry) * existingPos.margin * existingPos.leverage;
            const closeFee = existingPos.notional * FUT_FEE;
            balance += existingPos.margin + pnl - closeFee;
            trades.push({ time, sym, action: `CLOSE ${existingPos.side}`, price, amount: existingPos.notional, fee: closeFee, reason: `Flip → ${fSide}`, balance, pnl });
            openPositions.splice(openPositions.indexOf(existingPos), 1);
          }

          /* open new position if no same-direction position exists */
          const samePos = openPositions.find((p) => p.sym === sym && p.side === fSide);
          if (fSide && !samePos) {
            const notional = amtPerTrade;
            const margin = notional / leverage;
            const openFee = notional * FUT_FEE;
            if (margin + openFee > balance) { lastAction[sym] = action; return; }
            balance -= margin + openFee;
            const sl = slPct > 0 ? (fSide === "LONG" ? price * (1 - slPct / 100) : price * (1 + slPct / 100)) : undefined;
            const tp = tpPct > 0 ? (fSide === "LONG" ? price * (1 + tpPct / 100) : price * (1 - tpPct / 100)) : undefined;
            openPositions.push({ sym, side: fSide, entry: price, margin, notional, leverage, sl, tp });
            trades.push({ time, sym, action: `OPEN ${fSide}`, price, amount: notional, fee: openFee, reason, balance });
          }
          lastAction[sym] = action;
        });

        /* record equity */
        if (i % 10 === 0 || i === maxLen - 1) {
          let eq = balance;
          openPositions.forEach((pos) => {
            const c = candleMap[pos.sym];
            if (!c) return;
            const cp = c[Math.min(i, c.length - 1)]?.c || pos.entry;
            const pnl = pos.side === "LONG"
              ? ((cp - pos.entry) / pos.entry) * pos.margin * pos.leverage
              : ((pos.entry - cp) / pos.entry) * pos.margin * pos.leverage;
            eq += pos.margin + pnl;
          });
          const t = candleMap[btSymbols[0]]?.[Math.min(i, (candleMap[btSymbols[0]]?.length || 1) - 1)]?.t || 0;
          equity.push({ t, v: eq });
        }
      }

      /* close remaining futures at last price */
      openPositions.forEach((pos) => {
        const c = candleMap[pos.sym];
        const lp = c?.[c.length - 1]?.c || pos.entry;
        const pnl = pos.side === "LONG"
          ? ((lp - pos.entry) / pos.entry) * pos.margin * pos.leverage
          : ((pos.entry - lp) / pos.entry) * pos.margin * pos.leverage;
        const closeFee = pos.notional * FUT_FEE;
        balance += pos.margin + pnl - closeFee;
      });
    }

    /* calc stats */
    let peak = startBal, maxDd = 0;
    equity.forEach((e) => { if (e.v > peak) peak = e.v; const dd = (peak - e.v) / peak * 100; if (dd > maxDd) maxDd = dd; });
    const closeTrades = trades.filter((t) => t.action.startsWith("SELL") || t.action.startsWith("CLOSE") || t.action.startsWith("SL") || t.action.startsWith("TP"));
    const wins = closeTrades.filter((t) => (t.pnl !== undefined ? t.pnl > 0 : false) || (t.action === "SELL" && (() => { const pb = [...trades].slice(0, trades.indexOf(t)).reverse().find((b) => b.action === "BUY" && b.sym === t.sym); return pb ? t.price > pb.price : false; })()));
    const winRate = closeTrades.length > 0 ? (wins.length / closeTrades.length) * 100 : 0;

    setBtResult({ trades, finalBalance: balance, startBalance: startBal, maxDrawdown: maxDd, winRate, totalTrades: trades.length, equity, liquidations, instrument: btInstrument });
    setBtProgress("");
    setBtRunning(false);
  };

  /* ---- spot form ---- */
  const [sSym, setSSym] = useState("BTCUSDT");
  const [sSide, setSSide] = useState("BUY");
  const [sAmt, setSAmt] = useState("");

  const execSpot = () => {
    const amount = parseFloat(sAmt);
    if (!amount || amount <= 0 || !prices[sSym]) return;
    const price = prices[sSym];
    updateUser(activeUserId, (u) => {
      if (sSide === "BUY") {
        if (amount > u.balance) return u;
        const got = (amount / price) * (1 - SPOT_FEE);
        const fee = (amount / price) * SPOT_FEE;
        u.balance -= amount;
        u.spot = { ...u.spot };
        u.spot[sSym] = (u.spot[sSym] || 0) + got;
        const trade: Trade = { id: uid(), time: ts(), sym: sSym, inst: "SPOT", side: "BUY", price, amount, fee: fee * price, qty: got };
        u.trades = [trade, ...u.trades];
        api.recordTrade(u.id, trade);
      } else {
        const held = u.spot[sSym] || 0;
        const qty = Math.min(amount / price, held);
        if (qty <= 0) return u;
        const got = qty * price * (1 - SPOT_FEE);
        const fee = qty * price * SPOT_FEE;
        u.spot = { ...u.spot };
        u.spot[sSym] = held - qty;
        if (u.spot[sSym] < 1e-10) delete u.spot[sSym];
        u.balance += got;
        const trade: Trade = { id: uid(), time: ts(), sym: sSym, inst: "SPOT", side: "SELL", price, amount: qty * price, fee, qty };
        u.trades = [trade, ...u.trades];
        api.recordTrade(u.id, trade);
      }
      persistUser(u);
      return u;
    });
    setSAmt("");
  };

  /* ---- futures form ---- */
  const [fSym, setFSym] = useState("BTCUSDT");
  const [fSide, setFSide] = useState("LONG");
  const [fLev, setFLev] = useState(1);
  const [fAmt, setFAmt] = useState("");
  const [fSl, setFSl] = useState("");
  const [fTp, setFTp] = useState("");

  const execFutures = () => {
    const amount = parseFloat(fAmt);
    if (!amount || amount <= 0 || !prices[fSym]) return;
    const price = prices[fSym];
    const notional = amount;
    const margin = notional / fLev;
    const fee = notional * FUT_FEE;
    const sl = fSl ? parseFloat(fSl) : undefined;
    const tp = fTp ? parseFloat(fTp) : undefined;
    updateUser(activeUserId, (u) => {
      if (margin + fee > u.balance) return u;
      u.balance -= margin + fee;
      u.futures = [...u.futures, {
        id: uid(), sym: fSym, side: fSide, leverage: fLev,
        entry: price, margin, notional, fee, openTime: ts(), liquidated: false,
        ...(sl ? { sl } : {}), ...(tp ? { tp } : {}),
      }];
      const trade: Trade = { id: uid(), time: ts(), sym: fSym, inst: "FUTURES", side: `OPEN ${fSide}`, price, amount: notional, fee, qty: notional / price, ...(sl ? { sl } : {}), ...(tp ? { tp } : {}) };
      u.trades = [trade, ...u.trades];
      api.recordTrade(u.id, trade);
      persistUser(u);
      return u;
    });
    setFAmt(""); setFSl(""); setFTp("");
  };

  /* ---- futures liquidation + SL/TP ---- */
  useEffect(() => {
    if (!Object.keys(prices).length) return;
    setUsers((prev) =>
      prev.map((u) => {
        let changed = false;
        let balDelta = 0;
        const newTrades: Trade[] = [];
        const futs = u.futures.map((f) => {
          if (f.liquidated || f.closedBySl || f.closedByTp) return f;
          const cp = prices[f.sym];
          if (!cp) return f;
          const pnl = f.side === "LONG"
            ? ((cp - f.entry) / f.entry) * f.margin * f.leverage
            : ((f.entry - cp) / f.entry) * f.margin * f.leverage;

          /* Liquidation */
          if (pnl <= -f.margin * 0.9) {
            changed = true;
            return { ...f, liquidated: true, liqTime: ts() };
          }

          /* Stop Loss */
          const slHit = f.sl && (
            (f.side === "LONG" && cp <= f.sl) ||
            (f.side === "SHORT" && cp >= f.sl)
          );
          if (slHit) {
            changed = true;
            const closeFee = f.notional * FUT_FEE;
            balDelta += f.margin + pnl - closeFee;
            const trade: Trade = { id: uid(), time: ts(), sym: f.sym, inst: "FUTURES", side: `SL ${f.side}`, price: cp, amount: f.notional, fee: closeFee, qty: pnl, sl: f.sl, tp: f.tp };
            newTrades.push(trade);
            api.recordTrade(u.id, trade);
            return { ...f, closedBySl: true, liqTime: ts() };
          }

          /* Take Profit */
          const tpHit = f.tp && (
            (f.side === "LONG" && cp >= f.tp) ||
            (f.side === "SHORT" && cp <= f.tp)
          );
          if (tpHit) {
            changed = true;
            const closeFee = f.notional * FUT_FEE;
            balDelta += f.margin + pnl - closeFee;
            const trade: Trade = { id: uid(), time: ts(), sym: f.sym, inst: "FUTURES", side: `TP ${f.side}`, price: cp, amount: f.notional, fee: closeFee, qty: pnl, sl: f.sl, tp: f.tp };
            newTrades.push(trade);
            api.recordTrade(u.id, trade);
            return { ...f, closedByTp: true, liqTime: ts() };
          }

          return f;
        });
        if (changed) {
          const nu = { ...u, futures: futs, balance: u.balance + balDelta, trades: [...newTrades, ...u.trades] };
          api.updateUser(nu.id, { balance: nu.balance, futures: futs });
          return nu;
        }
        return u;
      })
    );
  }, [prices]);

  const closeFuture = (fId: string) => {
    updateUser(activeUserId, (u) => {
      const f = u.futures.find((x) => x.id === fId);
      if (!f || f.liquidated || f.closedBySl || f.closedByTp) return u;
      const cp = prices[f.sym];
      if (!cp) return u;
      const pnl = f.side === "LONG"
        ? ((cp - f.entry) / f.entry) * f.margin * f.leverage
        : ((f.entry - cp) / f.entry) * f.margin * f.leverage;
      const closeFee = f.notional * FUT_FEE;
      u.balance += f.margin + pnl - closeFee;
      u.futures = u.futures.filter((x) => x.id !== fId);
      const trade: Trade = { id: uid(), time: ts(), sym: f.sym, inst: "FUTURES", side: `CLOSE ${f.side}`, price: cp, amount: f.notional, fee: closeFee, qty: pnl, sl: f.sl, tp: f.tp };
      u.trades = [trade, ...u.trades];
      api.recordTrade(u.id, trade);
      persistUser(u);
      return u;
    });
  };

  /* ---- signals ---- */
  const calcRSI = (arr: number[], period = 14): number | null => {
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
  const calcSMA = (arr: number[], period: number): number | null => {
    if (arr.length < period) return null;
    const s = arr.slice(-period);
    return s.reduce((a, b) => a + b, 0) / period;
  };
  const calcEMA = (arr: number[], period: number): number | null => {
    if (arr.length < period) return null;
    const k = 2 / (period + 1);
    let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
    return ema;
  };
  const calcMACD = (arr: number[]): { macd: number; signal: number; histogram: number } | null => {
    if (arr.length < 26) return null;
    const ema12 = calcEMA(arr, 12);
    const ema26 = calcEMA(arr, 26);
    if (ema12 === null || ema26 === null) return null;
    const macdLine = ema12 - ema26;
    /* signal = EMA(9) of MACD line — approximate via recent MACD values */
    const macdArr: number[] = [];
    for (let i = 26; i <= arr.length; i++) {
      const e12 = calcEMA(arr.slice(0, i), 12)!;
      const e26 = calcEMA(arr.slice(0, i), 26)!;
      macdArr.push(e12 - e26);
    }
    const signalLine = calcEMA(macdArr, 9);
    if (signalLine === null) return null;
    return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
  };

  /* ── SMC (Smart Money Concepts) helpers ── */
  interface SwingPoint { idx: number; price: number; type: "HH" | "HL" | "LH" | "LL" | "H" | "L"; }
  interface FVG { type: "bull" | "bear"; top: number; bottom: number; idx: number; }
  interface OrderBlock { type: "bull" | "bear"; top: number; bottom: number; idx: number; }

  /* Знайти swing highs і swing lows (lookback = 2 свічки в кожну сторону) */
  const findSwings = (candles: Candle[], lookback = 2): SwingPoint[] => {
    const pts: SwingPoint[] = [];
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
    /* classify: HH/HL/LH/LL */
    let lastH: SwingPoint | null = null, lastL: SwingPoint | null = null;
    pts.forEach((p) => {
      if (p.type === "H") {
        p.type = lastH && p.price > lastH.price ? "HH" : "LH";
        lastH = p;
      } else {
        p.type = lastL && p.price > lastL.price ? "HL" : "LL";
        lastL = p;
      }
    });
    return pts;
  };

  /* BOS (Break of Structure): ціна пробиває останній swing high/low (тільки свіжий пробій) */
  const detectBOS = (candles: Candle[], swings: SwingPoint[]): "bullish" | "bearish" | null => {
    if (candles.length < 6 || swings.length < 2) return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const highs = swings.filter((s) => s.type === "HH" || s.type === "LH");
    const lows = swings.filter((s) => s.type === "HL" || s.type === "LL");
    const lastHigh = highs[highs.length - 1];
    const lastLow = lows[lows.length - 1];
    /* bullish BOS: current candle breaks above, previous didn't */
    if (lastHigh && last.c > lastHigh.price && prev.c <= lastHigh.price) return "bullish";
    /* bearish BOS: current candle breaks below, previous didn't */
    if (lastLow && last.c < lastLow.price && prev.c >= lastLow.price) return "bearish";
    return null;
  };

  /* FVG (Fair Value Gap): 3 свічки, де high[0] < low[2] (bull) або low[0] > high[2] (bear) */
  const findFVGs = (candles: Candle[]): FVG[] => {
    const gaps: FVG[] = [];
    if (candles.length < 3) return gaps;
    for (let i = candles.length - 10; i < candles.length - 2; i++) {
      if (i < 0) continue;
      const c0 = candles[i], c2 = candles[i + 2];
      if (c0.h < c2.l) gaps.push({ type: "bull", top: c2.l, bottom: c0.h, idx: i + 1 });
      if (c0.l > c2.h) gaps.push({ type: "bear", top: c0.l, bottom: c2.h, idx: i + 1 });
    }
    return gaps;
  };

  /* FVG сигнал: ціна зараз входить в незаповнений FVG */
  const detectFVG = (candles: Candle[]): "bullish" | "bearish" | null => {
    const gaps = findFVGs(candles);
    if (gaps.length === 0) return null;
    const last = candles[candles.length - 1];
    /* шукаємо останній незаповнений gap куди ціна щойно увійшла */
    for (let i = gaps.length - 1; i >= 0; i--) {
      const g = gaps[i];
      if (g.type === "bull" && last.l <= g.top && last.c >= g.bottom) return "bullish";
      if (g.type === "bear" && last.h >= g.bottom && last.c <= g.top) return "bearish";
    }
    return null;
  };

  /* Order Block: остання ведмежа свічка перед бичачим рухом (bull OB) і навпаки */
  const findOrderBlocks = (candles: Candle[]): OrderBlock[] => {
    const obs: OrderBlock[] = [];
    if (candles.length < 5) return obs;
    for (let i = candles.length - 15; i < candles.length - 2; i++) {
      if (i < 0) continue;
      const c = candles[i], next = candles[i + 1];
      /* bull OB: bearish candle followed by strong bullish move */
      if (c.c < c.o && next.c > next.o && (next.c - next.o) > (c.o - c.c) * 1.5) {
        obs.push({ type: "bull", top: c.o, bottom: c.c, idx: i });
      }
      /* bear OB: bullish candle followed by strong bearish move */
      if (c.c > c.o && next.c < next.o && (next.o - next.c) > (c.c - c.o) * 1.5) {
        obs.push({ type: "bear", top: c.c, bottom: c.o, idx: i });
      }
    }
    return obs;
  };

  /* OB сигнал: ціна повертається в зону order block */
  const detectOB = (candles: Candle[]): "bullish" | "bearish" | null => {
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

  const signals = useMemo(() => {
    return SYMBOLS.map((s) => {
      const h = priceHistory[s] || [];
      const rsi = calcRSI(h);
      const sma7 = calcSMA(h, 7);
      const sma14 = calcSMA(h, 14);
      let rsiSignal = "NEUTRAL ⚪", rsiColor = "text-yellow-400";
      if (rsi !== null) {
        if (rsi > 70) { rsiSignal = "OVERBOUGHT 🔴"; rsiColor = "text-red-400"; }
        else if (rsi < 30) { rsiSignal = "OVERSOLD 🟢"; rsiColor = "text-green-400"; }
      }
      let trend = "—", trendColor = "text-yellow-400";
      if (sma7 !== null && sma14 !== null) {
        if (sma7 > sma14) { trend = "BULLISH ▲"; trendColor = "text-green-400"; }
        else { trend = "BEARISH ▼"; trendColor = "text-red-400"; }
      }
      const macdData = calcMACD(h);
      let macdSignal = "—", macdColor = "text-yellow-400";
      if (macdData) {
        if (macdData.histogram > 0) { macdSignal = "BULLISH ▲"; macdColor = "text-green-400"; }
        else { macdSignal = "BEARISH ▼"; macdColor = "text-red-400"; }
      }
      /* SMC signals */
      const candles = candleHistory[s] || [];
      const swings = findSwings(candles);
      const bos = detectBOS(candles, swings);
      const fvg = detectFVG(candles);
      const ob = detectOB(candles);

      let smcSignal = "—", smcColor = "text-gray-500";
      const smcParts: string[] = [];
      if (bos === "bullish") smcParts.push("BOS▲");
      if (bos === "bearish") smcParts.push("BOS▼");
      if (fvg === "bullish") smcParts.push("FVG▲");
      if (fvg === "bearish") smcParts.push("FVG▼");
      if (ob === "bullish") smcParts.push("OB▲");
      if (ob === "bearish") smcParts.push("OB▼");
      if (smcParts.length > 0) {
        smcSignal = smcParts.join(" ");
        const hasBull = smcParts.some((p) => p.includes("▲"));
        const hasBear = smcParts.some((p) => p.includes("▼"));
        smcColor = hasBull && hasBear ? "text-yellow-400" : hasBull ? "text-green-400" : "text-red-400";
      }

      return { sym: s, rsi, rsiSignal, rsiColor, sma7, sma14, trend, trendColor, macdData, macdSignal, macdColor, bos, fvg, ob, smcSignal, smcColor };
    });
  }, [priceHistory, candleHistory]);

  /* auto-load candles when user changes strategy timeframe */
  useEffect(() => {
    users.forEach((u) => {
      const tf = u.strategy?.timeframe;
      if (tf && tf !== "15m") loadTimeframeCandles(tf);
    });
  }, [users.map((u) => u.strategy?.timeframe).join(",")]);

  /* ═══ AUTO-STRATEGY ENGINE ═══ */
  const lastStrategyTick = useRef(0);
  useEffect(() => {
    if (!Object.keys(prices).length) return;
    if (tickRef.current <= lastStrategyTick.current) return;
    lastStrategyTick.current = tickRef.current;

    setUsers((prev) => prev.map((u) => {
      const st = u.strategy;
      if (!st || st.type === "none" || !st.active) return u;
      const uc = { ...u, strategy: { ...st, log: [...st.log] }, spot: { ...u.spot }, trades: [...u.trades] };

      /* resolve candle data for the user's chosen timeframe */
      const tf = st.timeframe || "15m";
      const tfCandleMap = tf === "15m" ? candleHistory : (tfCandles[tf] || {});

      st.symbols.forEach((sym) => {
        /* skip if correct timeframe data isn't loaded yet */
        if (tf !== "15m" && (!tfCandles[tf] || !tfCandles[tf][sym])) return;
        const tfCandlesForSym = tfCandleMap[sym] || [];
        if (tfCandlesForSym.length < 5) return;
        const h = tfCandlesForSym.map((c: Candle) => c.c);
        const price = prices[sym];
        if (!price) return;

        /* anti-repeat: skip if last log entry for this symbol is the same direction */
        const lastLog = uc.strategy.log.find((l: any) => l.sym === sym);

        const rsi = calcRSI(h);
        let action: string | null = null;
        let reason = "";

        if (st.type === "rsi") {
          if (rsi !== null && rsi < 30) { action = "BUY"; reason = `RSI=${fmt(rsi,1)}<30`; }
          if (rsi !== null && rsi > 70) { action = "SELL"; reason = `RSI=${fmt(rsi,1)}>70`; }
        } else if (st.type === "macd") {
          const macdNow = calcMACD(h);
          const macdPrev = h.length > 26 ? calcMACD(h.slice(0, -1)) : null;
          if (macdNow && macdPrev) {
            if (macdPrev.histogram <= 0 && macdNow.histogram > 0) { action = "BUY"; reason = "MACD cross ▲"; }
            if (macdPrev.histogram >= 0 && macdNow.histogram < 0) { action = "SELL"; reason = "MACD cross ▼"; }
          }
        } else if (st.type === "donchian") {
          const period = 20;
          if (tfCandlesForSym.length >= period + 1) {
            const lookback = tfCandlesForSym.slice(-(period + 1), -1);
            const dcHigh = Math.max(...lookback.map((c: Candle) => c.h));
            const dcLow = Math.min(...lookback.map((c: Candle) => c.l));
            const last = tfCandlesForSym[tfCandlesForSym.length - 1];
            if (last.c > dcHigh) { action = "BUY"; reason = `Breakout ▲ ${fmt(dcHigh,2)}`; }
            if (last.c < dcLow) { action = "SELL"; reason = `Breakdown ▼ ${fmt(dcLow,2)}`; }
          }
        } else if (st.type === "smc_fvg") {
          const fvgSignal = detectFVG(tfCandlesForSym);
          if (fvgSignal === "bullish") { action = "BUY"; reason = "Bull FVG"; }
          if (fvgSignal === "bearish") { action = "SELL"; reason = "Bear FVG"; }
        } else if (st.type === "smc_bos") {
          const swings = findSwings(tfCandlesForSym);
          const bosSignal = detectBOS(tfCandlesForSym, swings);
          if (bosSignal === "bullish") { action = "BUY"; reason = "Bullish BOS"; }
          if (bosSignal === "bearish") { action = "SELL"; reason = "Bearish BOS"; }
        } else if (st.type === "smc_ob") {
          const obSignal = detectOB(tfCandlesForSym);
          if (obSignal === "bullish") { action = "BUY"; reason = "Bull Order Block"; }
          if (obSignal === "bearish") { action = "SELL"; reason = "Bear Order Block"; }
        }
        if (!action) return;

        /* anti-repeat: don't repeat the same action twice in a row for same symbol */
        if (lastLog && lastLog.action === action) return;

        const amt = st.amountPerTrade;
        const time = ts();
        if (action === "BUY" && uc.balance >= amt) {
          const got = (amt / price) * (1 - SPOT_FEE);
          const fee = (amt / price) * SPOT_FEE;
          uc.balance -= amt;
          uc.spot[sym] = (uc.spot[sym] || 0) + got;
          const trade: Trade = { id: uid(), time, sym, inst: "SPOT", side: "BUY [AUTO]", price, amount: amt, fee: fee * price, qty: got };
          uc.trades = [trade, ...uc.trades];
          const logEntry = { time, sym, action: "BUY", price, amount: amt, reason };
          uc.strategy.log = [logEntry, ...uc.strategy.log].slice(0, 50);
          api.recordTrade(uc.id, trade);
          api.recordStrategyLog(uc.id, logEntry);
        } else if (action === "BUY") {
          /* BUY signal but insufficient balance — log signal to reset anti-repeat */
          const logEntry = { time, sym, action: "BUY", price, amount: 0, reason: reason + " (недостатньо коштів)" };
          uc.strategy.log = [logEntry, ...uc.strategy.log].slice(0, 50);
          api.recordStrategyLog(uc.id, logEntry);
        } else if (action === "SELL") {
          const held = uc.spot[sym] || 0;
          const sellQty = Math.min(amt / price, held);
          if (sellQty > 0) {
            const got = sellQty * price * (1 - SPOT_FEE);
            const fee = sellQty * price * SPOT_FEE;
            uc.spot[sym] = held - sellQty;
            if (uc.spot[sym] < 1e-10) delete uc.spot[sym];
            uc.balance += got;
            const trade: Trade = { id: uid(), time, sym, inst: "SPOT", side: "SELL [AUTO]", price, amount: sellQty * price, fee, qty: sellQty };
            uc.trades = [trade, ...uc.trades];
            const logEntry = { time, sym, action: "SELL", price, amount: sellQty * price, reason };
            uc.strategy.log = [logEntry, ...uc.strategy.log].slice(0, 50);
            api.recordTrade(uc.id, trade);
            api.recordStrategyLog(uc.id, logEntry);
          } else {
            /* SELL signal but no holdings — log signal to reset anti-repeat */
            const logEntry = { time, sym, action: "SELL", price, amount: 0, reason: reason + " (немає позиції)" };
            uc.strategy.log = [logEntry, ...uc.strategy.log].slice(0, 50);
            api.recordStrategyLog(uc.id, logEntry);
          }
        }
      });
      api.updateUser(uc.id, { balance: uc.balance, spot: uc.spot, futures: uc.futures });
      return uc;
    }));
  }, [prices, priceHistory, tfCandles]);

  /* ---- equity ---- */
  const calcEquity = (u: User) => {
    let eq = u.balance;
    Object.entries(u.spot || {}).forEach(([s, qty]) => { eq += qty * (prices[s] || 0); });
    (u.futures || []).forEach((f) => {
      if (f.liquidated || f.closedBySl || f.closedByTp) return;
      const cp = prices[f.sym] || f.entry;
      const pnl = f.side === "LONG"
        ? ((cp - f.entry) / f.entry) * f.margin * f.leverage
        : ((f.entry - cp) / f.entry) * f.margin * f.leverage;
      eq += f.margin + pnl;
    });
    return eq;
  };

  /* ---- sparkline ---- */
  const Spark = ({ data, w = 80, h = 24 }: { data: number[]; w?: number; h?: number }) => {
    if (!data || data.length < 2) return <span className="text-gray-600 text-xs">…</span>;
    const min = Math.min(...data), max = Math.max(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
    const clr = data[data.length - 1] >= data[0] ? "#22c55e" : "#ef4444";
    return <svg width={w} height={h} className="inline-block"><polyline fill="none" stroke={clr} strokeWidth="1.5" points={pts} /></svg>;
  };

  /* ── styles ── */
  const card = "bg-[#111] border border-[#222] rounded-lg p-4";
  const btnG = "bg-green-600 hover:bg-green-500 text-white font-bold px-4 py-2 rounded text-sm transition cursor-pointer";
  const btnR = "bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-2 rounded text-sm transition cursor-pointer";
  const btnN = "bg-[#222] hover:bg-[#333] text-gray-200 px-3 py-1.5 rounded text-sm transition cursor-pointer";
  const inp = "bg-[#1a1a1a] border border-[#333] text-gray-100 rounded px-3 py-2 text-sm focus:border-green-500 focus:outline-none w-full";
  const sel = "bg-[#1a1a1a] border border-[#333] text-gray-100 rounded px-3 py-2 text-sm focus:border-green-500 focus:outline-none";

  if (loading) {
    return (
      <div className="bg-[#0a0a0a] min-h-screen text-gray-100 flex items-center justify-center" style={{ fontFamily: "var(--font-mono)" }}>
        <p className="text-green-400 animate-pulse">Завантаження...</p>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="bg-[#0a0a0a] min-h-screen text-gray-100 flex items-center justify-center" style={{ fontFamily: "var(--font-mono)" }}>
        <div className={`${card} max-w-sm w-full`}>
          <h3 className="text-green-400 font-bold mb-3 text-sm">СТВОРИТИ ПЕРШОГО ЮЗЕРА</h3>
          <input className={`${inp} mb-2`} placeholder="Ім'я" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addUser()} autoFocus />
          <input className={`${inp} mb-3`} placeholder="Стартовий баланс ($)" type="number" value={newBal} onChange={(e) => setNewBal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addUser()} />
          <button onClick={addUser} className={btnG} style={{ width: "100%" }}>Створити</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#0a0a0a] min-h-screen text-gray-100 p-3" style={{ fontFamily: "var(--font-mono)" }}>

      {/* ═══ TOP BAR ═══ */}
      <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
        <span className="text-xs text-gray-500 mr-1 whitespace-nowrap">USERS:</span>
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-1">
            <button onClick={() => setActiveUserId(u.id)} className={`px-3 py-1 rounded text-xs font-semibold transition cursor-pointer whitespace-nowrap ${u.id === activeUserId ? "bg-green-600 text-white" : "bg-[#1a1a1a] text-gray-400 hover:text-white hover:bg-[#222]"}`}>
              {u.name}
              {u.strategy?.active && u.strategy.type !== "none" && <span className="ml-1 text-yellow-400">⚡</span>}
            </button>
            <button onClick={() => startRename(u)} className="text-gray-600 hover:text-yellow-400 text-xs px-1 transition cursor-pointer" title="Перейменувати">✎</button>
            {users.length > 1 && <button onClick={() => setConfirmDel(u.id)} className="text-red-800 hover:text-red-400 text-xs px-1 transition cursor-pointer">✕</button>}
          </div>
        ))}
        <button onClick={() => setShowNewUser(true)} className="text-green-500 hover:text-green-300 text-sm font-bold px-2 transition cursor-pointer">+ Додати</button>
      </div>

      {/* modals */}
      {editingUserId && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className={`${card} max-w-sm w-full`}>
            <h3 className="text-yellow-400 font-bold mb-3 text-sm">ПЕРЕЙМЕНУВАТИ ЮЗЕРА</h3>
            <input className={`${inp} mb-3`} placeholder="Нове ім'я" value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveRename()} autoFocus />
            <div className="flex gap-2">
              <button onClick={saveRename} className={btnG}>Зберегти</button>
              <button onClick={() => setEditingUserId(null)} className={btnN}>Скасувати</button>
            </div>
          </div>
        </div>
      )}
      {confirmDel && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className={`${card} max-w-sm w-full text-center`}>
            <p className="mb-4 text-sm">Видалити юзера <span className="text-yellow-400">{users.find((u) => u.id === confirmDel)?.name}</span>?</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => delUser(confirmDel)} className={btnR}>Так, видалити</button>
              <button onClick={() => setConfirmDel(null)} className={btnN}>Скасувати</button>
            </div>
          </div>
        </div>
      )}
      {showNewUser && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className={`${card} max-w-sm w-full`}>
            <h3 className="text-green-400 font-bold mb-3 text-sm">НОВИЙ ЮЗЕР</h3>
            <input className={`${inp} mb-2`} placeholder="Ім'я" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addUser()} autoFocus />
            <input className={`${inp} mb-3`} placeholder="Стартовий баланс ($)" type="number" value={newBal} onChange={(e) => setNewBal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addUser()} />
            <div className="flex gap-2">
              <button onClick={addUser} className={btnG}>Створити</button>
              <button onClick={() => setShowNewUser(false)} className={btnN}>Скасувати</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ BALANCE BAR ═══ */}
      {activeUser && (
        <div className={`${card} mb-3 grid grid-cols-2 sm:grid-cols-3 md:flex md:flex-wrap md:items-center gap-3 md:gap-6`}>
          <div><span className="text-[10px] sm:text-xs text-gray-500">ЮЗЕР</span><p className="text-green-400 font-bold text-sm sm:text-base truncate">{activeUser.name}</p></div>
          <div><span className="text-[10px] sm:text-xs text-gray-500">БАЛАНС</span><p className="text-white font-bold text-sm sm:text-base">${fmt(activeUser.balance)}</p></div>
          <div><span className="text-[10px] sm:text-xs text-gray-500">EQUITY</span><p className="text-white font-bold text-sm sm:text-base">${fmt(calcEquity(activeUser))}</p></div>
          {(() => {
            const eq = calcEquity(activeUser);
            const pnl = eq - activeUser.startBal;
            const pnlP = activeUser.startBal > 0 ? (pnl / activeUser.startBal) * 100 : 0;
            return <div><span className="text-[10px] sm:text-xs text-gray-500">P&L</span><p className={`font-bold text-sm sm:text-base ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>{pnl >= 0 ? "+" : ""}${fmt(pnl)} ({fmtP(pnlP)})</p></div>;
          })()}
          {activeUser.strategy?.active && activeUser.strategy.type !== "none" && (
            <div className="col-span-2 sm:col-span-1"><span className="text-[10px] sm:text-xs text-gray-500">СТРАТЕГІЯ</span><p className="text-yellow-400 font-bold text-xs sm:text-sm">⚡ {STRATEGIES[activeUser.strategy.type]?.name} <span className="text-gray-500">{TIMEFRAMES[activeUser.strategy.timeframe || "15m"]?.label}</span></p></div>
          )}
        </div>
      )}

      {/* ═══ NAV ═══ */}
      <div className="grid grid-cols-4 sm:flex gap-1 mb-3 sm:flex-wrap">
        {["market", "trade", "portfolio", "trades", "signals", "strategy", "backtest", "compare"].map((v) => (
          <button key={v} onClick={() => setView(v)} className={`px-2 sm:px-3 py-1.5 rounded text-[10px] sm:text-xs font-semibold uppercase transition cursor-pointer ${view === v ? (v === "strategy" ? "bg-yellow-500 text-black" : v === "backtest" ? "bg-purple-600 text-white" : "bg-green-600 text-white") : "bg-[#1a1a1a] text-gray-400 hover:text-white"}`}>
            {v === "market" ? "Ринок" : v === "trade" ? "Торгівля" : v === "portfolio" ? "Портфель" : v === "trades" ? "Угоди" : v === "signals" ? "Сигнали" : v === "strategy" ? "⚡ Стратегія" : v === "backtest" ? "📊 Бектест" : "Порівняння"}
          </button>
        ))}
      </div>

      {/* ═══ MARKET ═══ */}
      {view === "market" && (
        <div className={card}>
          <h2 className="text-green-400 font-bold text-sm mb-3">РИНОК</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-gray-500 text-xs"><th className="text-left py-1 pr-4">ПАРА</th><th className="text-right py-1 pr-4">ЦІНА</th><th className="text-right py-1 pr-4">ЗМІНА</th><th className="text-center py-1">ГРАФІК</th></tr></thead>
              <tbody>
                {SYMBOLS.map((s) => {
                  const p = prices[s]; const sp = startPrices[s];
                  const chg = p && sp ? ((p - sp) / sp) * 100 : 0;
                  return (
                    <tr key={s} className="border-t border-[#222]">
                      <td className="py-2 pr-4 text-yellow-400 font-semibold">{NICE[s]}/USDT</td>
                      <td className="py-2 pr-4 text-right text-white">${p ? fmt(p, p < 1 ? 4 : 2) : "—"}</td>
                      <td className={`py-2 pr-4 text-right font-semibold ${chg >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtP(chg)}</td>
                      <td className="py-2 text-center"><Spark data={priceHistory[s]} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-600 mt-2">Оновлення кожні 15 хв · Binance API</p>
        </div>
      )}

      {/* ═══ TRADE ═══ */}
      {view === "trade" && (
        <div>
          <div className="flex gap-1 mb-3">
            {["SPOT", "FUTURES"].map((t) => (
              <button key={t} onClick={() => setInstrument(t)} className={`px-4 py-1.5 rounded text-xs font-bold transition cursor-pointer ${instrument === t ? "bg-yellow-500 text-black" : "bg-[#1a1a1a] text-gray-400 hover:text-white"}`}>{t}</button>
            ))}
          </div>
          {instrument === "SPOT" ? (
            <div className={card}>
              <h2 className="text-green-400 font-bold text-sm mb-3">SPOT ТОРГІВЛЯ</h2>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div><label className="text-[10px] text-gray-500">МОНЕТА</label><select className={sel + " w-full"} value={sSym} onChange={(e) => setSSym(e.target.value)}>{SYMBOLS.map((s) => <option key={s} value={s}>{NICE[s]}/USDT</option>)}</select></div>
                <div><label className="text-[10px] text-gray-500">НАПРЯМОК</label><div className="flex gap-1"><button onClick={() => setSSide("BUY")} className={`flex-1 py-2 rounded text-xs font-bold cursor-pointer ${sSide === "BUY" ? "bg-green-600 text-white" : "bg-[#1a1a1a] text-gray-400"}`}>BUY</button><button onClick={() => setSSide("SELL")} className={`flex-1 py-2 rounded text-xs font-bold cursor-pointer ${sSide === "SELL" ? "bg-red-600 text-white" : "bg-[#1a1a1a] text-gray-400"}`}>SELL</button></div></div>
              </div>
              <div className="mb-2"><label className="text-[10px] text-gray-500">СУМА (USDT)</label><input className={inp} type="number" placeholder="0.00" value={sAmt} onChange={(e) => setSAmt(e.target.value)} /></div>
              {prices[sSym] && <p className="text-[10px] text-gray-500 mb-2">Ціна: ${fmt(prices[sSym], prices[sSym] < 1 ? 4 : 2)} · Комісія: 0.1%{sAmt && parseFloat(sAmt) > 0 && <span> · Отримаєте: {sSide === "BUY" ? `${fmt((parseFloat(sAmt) / prices[sSym]) * (1 - SPOT_FEE), 6)} ${NICE[sSym]}` : `$${fmt(parseFloat(sAmt) * (1 - SPOT_FEE))}`}</span>}</p>}
              <button onClick={execSpot} className={sSide === "BUY" ? btnG : btnR} style={{ width: "100%" }}>{sSide} {NICE[sSym]}</button>
            </div>
          ) : (
            <div className={card}>
              <h2 className="text-yellow-400 font-bold text-sm mb-3">FUTURES ТОРГІВЛЯ</h2>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div><label className="text-[10px] text-gray-500">МОНЕТА</label><select className={sel + " w-full"} value={fSym} onChange={(e) => setFSym(e.target.value)}>{SYMBOLS.map((s) => <option key={s} value={s}>{NICE[s]}/USDT</option>)}</select></div>
                <div><label className="text-[10px] text-gray-500">НАПРЯМОК</label><div className="flex gap-1"><button onClick={() => setFSide("LONG")} className={`flex-1 py-2 rounded text-xs font-bold cursor-pointer ${fSide === "LONG" ? "bg-green-600 text-white" : "bg-[#1a1a1a] text-gray-400"}`}>LONG</button><button onClick={() => setFSide("SHORT")} className={`flex-1 py-2 rounded text-xs font-bold cursor-pointer ${fSide === "SHORT" ? "bg-red-600 text-white" : "bg-[#1a1a1a] text-gray-400"}`}>SHORT</button></div></div>
              </div>
              <div className="mb-2"><label className="text-[10px] text-gray-500">ПЛЕЧЕ</label><div className="flex gap-1">{LEVERAGES.map((l) => <button key={l} onClick={() => setFLev(l)} className={`flex-1 py-1.5 rounded text-xs font-bold transition cursor-pointer ${fLev === l ? "bg-yellow-500 text-black" : "bg-[#1a1a1a] text-gray-400"}`}>x{l}</button>)}</div></div>
              <div className="mb-2"><label className="text-[10px] text-gray-500">СУМА (USDT)</label><input className={inp} type="number" placeholder="0.00" value={fAmt} onChange={(e) => setFAmt(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div><label className="text-[10px] text-gray-500">STOP LOSS ($)</label><input className={inp} type="number" placeholder={`напр. ${prices[fSym] ? fmt(prices[fSym] * (fSide === "LONG" ? 0.95 : 1.05), prices[fSym] < 1 ? 4 : 2) : "—"}`} value={fSl} onChange={(e) => setFSl(e.target.value)} /></div>
                <div><label className="text-[10px] text-gray-500">TAKE PROFIT ($)</label><input className={inp} type="number" placeholder={`напр. ${prices[fSym] ? fmt(prices[fSym] * (fSide === "LONG" ? 1.05 : 0.95), prices[fSym] < 1 ? 4 : 2) : "—"}`} value={fTp} onChange={(e) => setFTp(e.target.value)} /></div>
              </div>
              {prices[fSym] && fAmt && parseFloat(fAmt) > 0 && <p className="text-[10px] text-gray-500 mb-2">Маржа: ${fmt(parseFloat(fAmt) / fLev)} · Notional: ${fmt(parseFloat(fAmt))} · Комісія: ${fmt(parseFloat(fAmt) * FUT_FEE)}{fSl ? ` · SL: $${fSl}` : ""}{fTp ? ` · TP: $${fTp}` : ""}</p>}
              <button onClick={execFutures} className={fSide === "LONG" ? btnG : btnR} style={{ width: "100%" }}>OPEN {fSide} x{fLev}</button>
            </div>
          )}
        </div>
      )}

      {/* ═══ PORTFOLIO ═══ */}
      {view === "portfolio" && activeUser && (
        <div className="space-y-3">
          <div className={card}>
            <h2 className="text-green-400 font-bold text-sm mb-3">SPOT ПОЗИЦІЇ</h2>
            {Object.keys(activeUser.spot).length === 0 ? <p className="text-gray-600 text-xs">Немає spot-позицій</p> : (
              <table className="w-full text-sm"><thead><tr className="text-gray-500 text-xs"><th className="text-left py-1">МОНЕТА</th><th className="text-right py-1">К-СТЬ</th><th className="text-right py-1">ВАРТІСТЬ</th></tr></thead>
                <tbody>{Object.entries(activeUser.spot).map(([s, qty]) => <tr key={s} className="border-t border-[#222]"><td className="py-1 text-yellow-400">{NICE[s]}</td><td className="py-1 text-right">{fmt(qty, 6)}</td><td className="py-1 text-right">${fmt(qty * (prices[s] || 0))}</td></tr>)}</tbody></table>
            )}
          </div>
          <div className={card}>
            <h2 className="text-yellow-400 font-bold text-sm mb-3">FUTURES ПОЗИЦІЇ</h2>
            {activeUser.futures.length === 0 ? <p className="text-gray-600 text-xs">Немає відкритих futures-позицій</p> : (
              <div className="space-y-2">{activeUser.futures.map((f) => {
                const cp = prices[f.sym] || f.entry;
                const isClosed = f.liquidated || f.closedBySl || f.closedByTp;
                const pnl = f.liquidated ? -f.margin : f.side === "LONG" ? ((cp - f.entry) / f.entry) * f.margin * f.leverage : ((f.entry - cp) / f.entry) * f.margin * f.leverage;
                const pnlP = f.margin > 0 ? (pnl / f.margin) * 100 : 0;
                const statusLabel = f.liquidated ? "LIQUIDATED" : f.closedBySl ? "STOP LOSS" : f.closedByTp ? "TAKE PROFIT" : null;
                const statusColor = f.liquidated ? "text-red-500" : f.closedBySl ? "text-red-400" : "text-green-400";
                return (
                  <div key={f.id} className={`p-3 rounded border ${f.liquidated ? "border-red-800 bg-red-950/30" : f.closedBySl ? "border-red-700 bg-red-950/20" : f.closedByTp ? "border-green-700 bg-green-950/20" : "border-[#333] bg-[#0d0d0d]"}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-yellow-400 font-semibold text-sm">{NICE[f.sym]} {f.side} x{f.leverage}</span>
                      {statusLabel ? <span className={`${statusColor} font-bold text-xs ${f.liquidated ? "animate-pulse" : ""}`}>{statusLabel}</span> : <button onClick={() => closeFuture(f.id)} className="bg-red-700 hover:bg-red-600 text-white text-xs px-3 py-1 rounded font-bold transition cursor-pointer">CLOSE</button>}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 sm:gap-2 text-[10px] text-gray-400">
                      <div>Entry: ${fmt(f.entry, f.entry < 1 ? 4 : 2)}</div><div>Current: ${fmt(cp, cp < 1 ? 4 : 2)}</div><div>Margin: ${fmt(f.margin)}</div>
                      <div className={pnl >= 0 ? "text-green-400" : "text-red-400"}>PnL: {pnl >= 0 ? "+" : ""}${fmt(pnl)} ({fmtP(pnlP)})</div>
                    </div>
                    {(f.sl || f.tp) && (
                      <div className="flex gap-3 mt-1 text-[10px]">
                        {f.sl && <span className={isClosed ? "text-gray-500 line-through" : "text-red-400"}>SL: ${fmt(f.sl, f.sl < 1 ? 4 : 2)}</span>}
                        {f.tp && <span className={isClosed ? "text-gray-500 line-through" : "text-green-400"}>TP: ${fmt(f.tp, f.tp < 1 ? 4 : 2)}</span>}
                      </div>
                    )}
                  </div>
                );
              })}</div>
            )}
          </div>
        </div>
      )}

      {/* ═══ TRADES ═══ */}
      {view === "trades" && activeUser && (
        <div className={card}>
          <h2 className="text-green-400 font-bold text-sm mb-3">ІСТОРІЯ УГОД — {activeUser.name}</h2>
          {activeUser.trades.length === 0 ? <p className="text-gray-600 text-xs">Немає угод</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-gray-500"><th className="text-left py-1">ЧАС</th><th className="text-left py-1">ІНСТР</th><th className="text-left py-1">МОНЕТА</th><th className="text-left py-1">ТИП</th><th className="text-right py-1">ЦІНА</th><th className="text-right py-1">СУМА</th><th className="text-right py-1">КОМІСІЯ</th><th className="text-right py-1">SL</th><th className="text-right py-1">TP</th></tr></thead>
              <tbody>{activeUser.trades.map((t) => (
                <tr key={t.id} className="border-t border-[#222]">
                  <td className="py-1 text-gray-400">{t.time}</td><td className="py-1">{t.inst}</td><td className="py-1 text-yellow-400">{NICE[t.sym]}</td>
                  <td className={`py-1 font-semibold ${t.side.includes("BUY") || t.side.includes("LONG") ? "text-green-400" : "text-red-400"}`}>{t.side}</td>
                  <td className="py-1 text-right">${fmt(t.price, t.price < 1 ? 4 : 2)}</td><td className="py-1 text-right">${fmt(t.amount)}</td><td className="py-1 text-right text-gray-500">${fmt(t.fee, 4)}</td>
                  <td className="py-1 text-right text-red-400">{t.sl ? `$${fmt(t.sl, t.sl < 1 ? 4 : 2)}` : "—"}</td>
                  <td className="py-1 text-right text-green-400">{t.tp ? `$${fmt(t.tp, t.tp < 1 ? 4 : 2)}` : "—"}</td>
                </tr>
              ))}</tbody></table></div>
          )}
        </div>
      )}

      {/* ═══ SIGNALS ═══ */}
      {view === "signals" && (
        <div className={card}>
          <h2 className="text-green-400 font-bold text-sm mb-3">СИГНАЛИ</h2>
          <p className="text-[10px] text-gray-600 mb-3">RSI(14) · SMA(7/14) · MACD(12,26,9) · SMC (BOS / FVG / OB) · Дані з Binance 15-хв свічок (OHLC)</p>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-gray-500 text-xs"><th className="text-left py-1">ПАРА</th><th className="text-center py-1">RSI</th><th className="text-center py-1">RSI СИГ.</th><th className="text-center py-1">SMA</th><th className="text-center py-1">MACD</th><th className="text-center py-1">SMC</th></tr></thead>
            <tbody>{signals.map((s) => (
              <tr key={s.sym} className="border-t border-[#222]">
                <td className="py-2 text-yellow-400 font-semibold whitespace-nowrap">{NICE[s.sym]}</td>
                <td className="py-2 text-center">{s.rsi !== null ? fmt(s.rsi, 1) : "—"}</td>
                <td className={`py-2 text-center font-semibold whitespace-nowrap ${s.rsiColor}`}>{s.rsiSignal}</td>
                <td className={`py-2 text-center font-semibold whitespace-nowrap ${s.trendColor}`}>{s.trend}</td>
                <td className={`py-2 text-center font-semibold whitespace-nowrap ${s.macdColor}`}>{s.macdSignal}</td>
                <td className={`py-2 text-center font-semibold whitespace-nowrap ${s.smcColor}`}>{s.smcSignal}</td>
              </tr>
            ))}</tbody></table></div>
        </div>
      )}

      {/* ═══ STRATEGY ═══ */}
      {view === "strategy" && activeUser && (
        <div className="space-y-3">
          <div className={card}>
            <h2 className="text-yellow-400 font-bold text-sm mb-3">⚡ АВТО-СТРАТЕГІЯ — {activeUser.name}</h2>
            <p className="text-[10px] text-gray-500 mb-4">Бот автоматично торгує SPOT на кожному тіку цін. Сигнали потребують ≥15 тіків (~3.75 год).</p>
            <div className="mb-3"><label className="text-[10px] text-gray-500 block mb-1">СТРАТЕГІЯ</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{Object.entries(STRATEGIES).map(([key, s]) => (
                <button key={key} onClick={() => { updateUser(activeUserId, (u) => ({ ...u, strategy: { ...u.strategy, type: key } })); api.updateStrategy(activeUserId, { type: key }); }}
                  className={`p-2 rounded border text-left transition cursor-pointer ${activeUser.strategy?.type === key ? "border-yellow-500 bg-yellow-500/10" : "border-[#333] bg-[#0d0d0d] hover:border-[#444]"}`}>
                  <span className="text-xs font-bold block">{s.name}</span><span className="text-[10px] text-gray-500">{s.desc}</span>
                </button>
              ))}</div>
            </div>
            {activeUser.strategy?.type !== "none" && (
              <div className="space-y-3">
                <div><label className="text-[10px] text-gray-500 block mb-1">МОНЕТИ ДЛЯ ТОРГІВЛІ</label>
                  <div className="flex gap-1 flex-wrap">{SYMBOLS.map((s) => {
                    const active = (activeUser.strategy?.symbols || []).includes(s);
                    return <button key={s} onClick={() => {
                      const syms = active ? activeUser.strategy.symbols.filter((x: string) => x !== s) : [...activeUser.strategy.symbols, s];
                      updateUser(activeUserId, (u) => ({ ...u, strategy: { ...u.strategy, symbols: syms } }));
                      api.updateStrategy(activeUserId, { symbols: syms });
                    }} className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${active ? "bg-yellow-500 text-black" : "bg-[#1a1a1a] text-gray-400"}`}>{NICE[s]}</button>;
                  })}</div>
                </div>
                <div><label className="text-[10px] text-gray-500 block mb-1">ТАЙМФРЕЙМ</label>
                  <div className="flex gap-1">{Object.entries(TIMEFRAMES).map(([key, tf]) => (
                    <button key={key} onClick={() => {
                      updateUser(activeUserId, (u) => ({ ...u, strategy: { ...u.strategy, timeframe: key } }));
                      api.updateStrategy(activeUserId, { timeframe: key });
                    }} className={`flex-1 py-1.5 rounded text-xs font-bold transition cursor-pointer ${(activeUser.strategy?.timeframe || "15m") === key ? "bg-yellow-500 text-black" : "bg-[#1a1a1a] text-gray-400"}`}>{tf.label}</button>
                  ))}</div>
                </div>
                <div><label className="text-[10px] text-gray-500 block mb-1">СУМА НА ТРЕЙД (USDT)</label>
                  <input className={inp} type="number" value={activeUser.strategy?.amountPerTrade || 100} onChange={(e) => {
                    const v = Math.max(1, parseFloat(e.target.value) || 100);
                    updateUser(activeUserId, (u) => ({ ...u, strategy: { ...u.strategy, amountPerTrade: v } }));
                    api.updateStrategy(activeUserId, { amountPerTrade: v });
                  }} />
                </div>
                <button onClick={() => {
                  const newActive = !activeUser.strategy.active;
                  updateUser(activeUserId, (u) => ({ ...u, strategy: { ...u.strategy, active: newActive } }));
                  api.updateStrategy(activeUserId, { active: newActive });
                }} className={`w-full py-3 rounded font-bold text-sm transition cursor-pointer ${activeUser.strategy?.active ? "bg-red-600 hover:bg-red-500 text-white" : "bg-green-600 hover:bg-green-500 text-white"}`}>
                  {activeUser.strategy?.active ? "⏹ ЗУПИНИТИ БОТА" : "▶ ЗАПУСТИТИ БОТА"}
                </button>
                {activeUser.strategy?.active && (
                  <div className="text-center"><span className="inline-block px-3 py-1 bg-green-900/40 border border-green-700 rounded text-green-400 text-xs font-bold animate-pulse">⚡ БОТ АКТИВНИЙ — {STRATEGIES[activeUser.strategy.type]?.name}</span></div>
                )}
              </div>
            )}
          </div>
          {activeUser.strategy?.log?.length > 0 && (
            <div className={card}>
              <h2 className="text-yellow-400 font-bold text-sm mb-3">ЛОГ АВТО-ТРЕЙДІВ</h2>
              <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-gray-500"><th className="text-left py-1">ЧАС</th><th className="text-left py-1">МОНЕТА</th><th className="text-left py-1">ДІЯ</th><th className="text-right py-1">ЦІНА</th><th className="text-right py-1">СУМА</th><th className="text-left py-1">ПРИЧИНА</th></tr></thead>
                <tbody>{activeUser.strategy.log.map((l: any, i: number) => (
                  <tr key={i} className="border-t border-[#222]"><td className="py-1 text-gray-400">{l.time}</td><td className="py-1 text-yellow-400">{NICE[l.sym]}</td><td className={`py-1 font-bold ${l.action === "BUY" ? "text-green-400" : "text-red-400"}`}>{l.action}</td><td className="py-1 text-right">${fmt(l.price, l.price < 1 ? 4 : 2)}</td><td className="py-1 text-right">${fmt(l.amount)}</td><td className="py-1 text-gray-500">{l.reason}</td></tr>
                ))}</tbody></table></div>
            </div>
          )}
        </div>
      )}

      {/* ═══ BACKTEST ═══ */}
      {view === "backtest" && (
        <div className="space-y-3">
          <div className={card}>
            <h2 className="text-purple-400 font-bold text-sm mb-3">📊 БЕКТЕСТ СТРАТЕГІЙ</h2>
            <p className="text-[10px] text-gray-600 mb-3">Протестуй стратегію на історичних даних Binance. Вибери параметри і натисни &quot;Запустити&quot;.</p>

            {/* Instrument toggle */}
            <div className="flex gap-2 mb-3">
              {(["SPOT", "FUTURES"] as const).map((inst) => (
                <button key={inst} onClick={() => setBtInstrument(inst)} className={`px-4 py-1.5 rounded text-xs font-bold transition cursor-pointer ${btInstrument === inst ? (inst === "FUTURES" ? "bg-yellow-500 text-black" : "bg-green-600 text-white") : "bg-[#1a1a1a] text-gray-400 border border-[#333]"}`}>
                  {inst}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
              {/* Strategy */}
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">СТРАТЕГІЯ</label>
                <select value={btStrategy} onChange={(e) => setBtStrategy(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#333] rounded px-2 py-1.5 text-xs text-white">
                  {Object.entries(STRATEGIES).filter(([k]) => k !== "none").map(([k, v]) => (
                    <option key={k} value={k}>{v.name}</option>
                  ))}
                </select>
              </div>

              {/* Timeframe */}
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">ТАЙМФРЕЙМ</label>
                <select value={btTimeframe} onChange={(e) => setBtTimeframe(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#333] rounded px-2 py-1.5 text-xs text-white">
                  {Object.entries(TIMEFRAMES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>

              {/* Period */}
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">ПЕРІОД</label>
                <select value={btPeriod} onChange={(e) => setBtPeriod(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#333] rounded px-2 py-1.5 text-xs text-white">
                  {Object.entries(BT_PERIODS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>

              {/* Start Balance */}
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">СТАРТОВИЙ БАЛАНС ($)</label>
                <input type="number" value={btBalance} onChange={(e) => setBtBalance(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#333] rounded px-2 py-1.5 text-xs text-white" />
              </div>

              {/* Amount per trade */}
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">{btInstrument === "FUTURES" ? "NOTIONAL ($)" : "СУМА НА УГОДУ ($)"}</label>
                <input type="number" value={btAmount} onChange={(e) => setBtAmount(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#333] rounded px-2 py-1.5 text-xs text-white" />
              </div>

              {/* Futures-only fields */}
              {btInstrument === "FUTURES" && (
                <>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">ПЛЕЧЕ</label>
                    <select value={btLeverage} onChange={(e) => setBtLeverage(Number(e.target.value))} className="w-full bg-[#1a1a1a] border border-[#333] rounded px-2 py-1.5 text-xs text-white">
                      {LEVERAGES.map((l) => <option key={l} value={l}>x{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">НАПРЯМОК</label>
                    <select value={btSide} onChange={(e) => setBtSide(e.target.value as "AUTO" | "LONG" | "SHORT")} className="w-full bg-[#1a1a1a] border border-[#333] rounded px-2 py-1.5 text-xs text-white">
                      <option value="AUTO">AUTO (BUY→LONG, SELL→SHORT)</option>
                      <option value="LONG">Тільки LONG</option>
                      <option value="SHORT">Тільки SHORT</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">STOP LOSS (%)</label>
                    <input type="number" value={btSl} onChange={(e) => setBtSl(e.target.value)} placeholder="напр. 5" className="w-full bg-[#1a1a1a] border border-[#333] rounded px-2 py-1.5 text-xs text-white placeholder-gray-600" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">TAKE PROFIT (%)</label>
                    <input type="number" value={btTp} onChange={(e) => setBtTp(e.target.value)} placeholder="напр. 10" className="w-full bg-[#1a1a1a] border border-[#333] rounded px-2 py-1.5 text-xs text-white placeholder-gray-600" />
                  </div>
                </>
              )}
            </div>

            {/* Symbol selector */}
            <div className="mb-3">
              <label className="text-[10px] text-gray-500 block mb-1">МОНЕТИ</label>
              <div className="flex flex-wrap gap-2">
                {SYMBOLS.map((sym) => (
                  <button key={sym} onClick={() => setBtSymbols((p) => p.includes(sym) ? p.filter((s) => s !== sym) : [...p, sym])} className={`px-2 py-1 rounded text-[10px] font-semibold transition cursor-pointer ${btSymbols.includes(sym) ? "bg-yellow-500 text-black" : "bg-[#1a1a1a] text-gray-400 border border-[#333]"}`}>
                    {NICE[sym]}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={runBacktest} disabled={btRunning || btSymbols.length === 0} className="w-full sm:w-auto bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold text-xs px-6 py-2 rounded transition cursor-pointer">
              {btRunning ? btProgress || "Завантаження..." : "🚀 ЗАПУСТИТИ БЕКТЕСТ"}
            </button>
          </div>

          {/* Results */}
          {btResult && (
            <>
              {/* Stats */}
              <div className={card}>
                <h3 className="text-purple-400 font-bold text-sm mb-3">РЕЗУЛЬТАТИ</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-[#1a1a1a] rounded p-2 text-center">
                    <div className="text-gray-500 text-[10px] mb-1">СТАРТОВИЙ БАЛАНС</div>
                    <div className="text-white font-bold">${fmt(btResult.startBalance)}</div>
                  </div>
                  <div className="bg-[#1a1a1a] rounded p-2 text-center">
                    <div className="text-gray-500 text-[10px] mb-1">ФІНАЛЬНИЙ БАЛАНС</div>
                    <div className={`font-bold ${btResult.finalBalance >= btResult.startBalance ? "text-green-400" : "text-red-400"}`}>${fmt(btResult.finalBalance)}</div>
                  </div>
                  <div className="bg-[#1a1a1a] rounded p-2 text-center">
                    <div className="text-gray-500 text-[10px] mb-1">P&L</div>
                    <div className={`font-bold ${btResult.finalBalance >= btResult.startBalance ? "text-green-400" : "text-red-400"}`}>
                      {btResult.finalBalance >= btResult.startBalance ? "+" : ""}${fmt(btResult.finalBalance - btResult.startBalance)} ({fmtP((btResult.finalBalance - btResult.startBalance) / btResult.startBalance * 100)})
                    </div>
                  </div>
                  <div className="bg-[#1a1a1a] rounded p-2 text-center">
                    <div className="text-gray-500 text-[10px] mb-1">УГОД</div>
                    <div className="text-white font-bold">{btResult.totalTrades}</div>
                  </div>
                  <div className="bg-[#1a1a1a] rounded p-2 text-center">
                    <div className="text-gray-500 text-[10px] mb-1">WIN RATE</div>
                    <div className={`font-bold ${btResult.winRate >= 50 ? "text-green-400" : "text-red-400"}`}>{fmt(btResult.winRate, 1)}%</div>
                  </div>
                  <div className="bg-[#1a1a1a] rounded p-2 text-center">
                    <div className="text-gray-500 text-[10px] mb-1">МАКС. ПРОСАДКА</div>
                    <div className="text-red-400 font-bold">-{fmt(btResult.maxDrawdown, 1)}%</div>
                  </div>
                  <div className="bg-[#1a1a1a] rounded p-2 text-center">
                    <div className="text-gray-500 text-[10px] mb-1">СТРАТЕГІЯ</div>
                    <div className="text-yellow-400 font-bold text-[10px]">{STRATEGIES[btStrategy]?.name}</div>
                  </div>
                  <div className="bg-[#1a1a1a] rounded p-2 text-center">
                    <div className="text-gray-500 text-[10px] mb-1">РЕЖИМ</div>
                    <div className="text-white font-bold text-[10px]">{btResult.instrument}{btResult.instrument === "FUTURES" ? ` x${btLeverage}` : ""} · {BT_PERIODS[btPeriod]?.label} · {TIMEFRAMES[btTimeframe]?.label}</div>
                  </div>
                  {btResult.instrument === "FUTURES" && btResult.liquidations > 0 && (
                    <div className="bg-[#1a1a1a] rounded p-2 text-center">
                      <div className="text-gray-500 text-[10px] mb-1">ЛІКВІДАЦІЙ</div>
                      <div className="text-red-500 font-bold">{btResult.liquidations}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Equity chart (ASCII-style bar chart) */}
              {btResult.equity.length > 1 && (
                <div className={card}>
                  <h3 className="text-purple-400 font-bold text-sm mb-3">EQUITY КРИВА</h3>
                  <div className="h-40 flex items-end gap-[1px] overflow-hidden">
                    {(() => {
                      const eq = btResult.equity;
                      const minV = Math.min(...eq.map((e) => e.v));
                      const maxV = Math.max(...eq.map((e) => e.v));
                      const range = maxV - minV || 1;
                      /* downsample to max 200 bars */
                      const step = Math.max(1, Math.floor(eq.length / 200));
                      const sampled = eq.filter((_, i) => i % step === 0 || i === eq.length - 1);
                      return sampled.map((e, i) => {
                        const h = ((e.v - minV) / range) * 100;
                        const color = e.v >= btResult.startBalance ? "bg-green-500" : "bg-red-500";
                        return <div key={i} className={`${color} rounded-t-[1px] min-w-[2px]`} style={{ height: `${Math.max(h, 2)}%`, flex: 1 }} title={`$${fmt(e.v)} · ${new Date(e.t).toLocaleDateString("uk-UA")}`} />;
                      });
                    })()}
                  </div>
                  <div className="flex justify-between text-[9px] text-gray-600 mt-1">
                    <span>{new Date(btResult.equity[0].t).toLocaleDateString("uk-UA")}</span>
                    <span className="text-gray-500">${fmt(Math.min(...btResult.equity.map((e) => e.v)))} — ${fmt(Math.max(...btResult.equity.map((e) => e.v)))}</span>
                    <span>{new Date(btResult.equity[btResult.equity.length - 1].t).toLocaleDateString("uk-UA")}</span>
                  </div>
                </div>
              )}

              {/* Trades list */}
              <div className={card}>
                <h3 className="text-purple-400 font-bold text-sm mb-3">УГОДИ ({btResult.trades.length})</h3>
                {btResult.trades.length === 0 ? <p className="text-gray-600 text-xs">Стратегія не здійснила жодної угоди за цей період</p> : (
                  <div className="overflow-x-auto max-h-80 overflow-y-auto"><table className="w-full text-xs"><thead><tr className="text-gray-500 sticky top-0 bg-[#111]"><th className="text-left py-1">ДАТА</th><th className="text-left py-1">МОНЕТА</th><th className="text-left py-1">ТИП</th><th className="text-right py-1">ЦІНА</th><th className="text-right py-1">СУМА</th><th className="text-right py-1">КОМІСІЯ</th>{btResult.instrument === "FUTURES" && <th className="text-right py-1">PnL</th>}<th className="text-left py-1">ПРИЧИНА</th><th className="text-right py-1">БАЛАНС</th></tr></thead>
                    <tbody>{btResult.trades.map((t, i) => (
                      <tr key={i} className={`border-t border-[#222] ${t.action.startsWith("LIQ") ? "bg-red-950/30" : ""}`}>
                        <td className="py-1 text-gray-400 whitespace-nowrap">{new Date(t.time).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="py-1 text-yellow-400">{NICE[t.sym]}</td>
                        <td className={`py-1 font-semibold ${t.action.includes("BUY") || t.action.includes("LONG") || t.action.includes("TP") ? "text-green-400" : t.action.includes("LIQ") ? "text-red-500 animate-pulse" : "text-red-400"}`}>{t.action}</td>
                        <td className="py-1 text-right">${fmt(t.price, t.price < 1 ? 4 : 2)}</td>
                        <td className="py-1 text-right">${fmt(t.amount)}</td>
                        <td className="py-1 text-right text-gray-500">${fmt(t.fee, 4)}</td>
                        {btResult.instrument === "FUTURES" && <td className={`py-1 text-right font-semibold ${t.pnl !== undefined ? (t.pnl >= 0 ? "text-green-400" : "text-red-400") : "text-gray-600"}`}>{t.pnl !== undefined ? `${t.pnl >= 0 ? "+" : ""}$${fmt(t.pnl)}` : "—"}</td>}
                        <td className="py-1 text-gray-400 text-[10px]">{t.reason}</td>
                        <td className="py-1 text-right text-white">${fmt(t.balance)}</td>
                      </tr>
                    ))}</tbody></table></div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ COMPARE ═══ */}
      {view === "compare" && (
        <div className={card}>
          <h2 className="text-green-400 font-bold text-sm mb-3">ПОРІВНЯННЯ ЮЗЕРІВ</h2>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-gray-500 text-xs"><th className="text-left py-1">ЮЗЕР</th><th className="text-left py-1">СТРАТЕГІЯ</th><th className="text-right py-1">СТАРТ</th><th className="text-right py-1">EQUITY</th><th className="text-right py-1">P&L $</th><th className="text-right py-1">P&L %</th><th className="text-right py-1">УГОД</th></tr></thead>
            <tbody>{users.map((u) => {
              const eq = calcEquity(u); const pnl = eq - u.startBal;
              const pnlP = u.startBal > 0 ? (pnl / u.startBal) * 100 : 0;
              return (
                <tr key={u.id} className={`border-t border-[#222] ${u.id === activeUserId ? "bg-[#1a1a1a]" : ""}`}>
                  <td className="py-2 text-yellow-400 font-semibold whitespace-nowrap">{u.name}</td>
                  <td className="py-2 text-xs whitespace-nowrap">{u.strategy?.active && u.strategy.type !== "none" ? <span className="text-yellow-400">⚡ {STRATEGIES[u.strategy.type]?.name}</span> : <span className="text-gray-600">Ручна</span>}</td>
                  <td className="py-2 text-right whitespace-nowrap">${fmt(u.startBal)}</td>
                  <td className="py-2 text-right text-white font-semibold whitespace-nowrap">${fmt(eq)}</td>
                  <td className={`py-2 text-right font-semibold whitespace-nowrap ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>{pnl >= 0 ? "+" : ""}${fmt(pnl)}</td>
                  <td className={`py-2 text-right font-semibold whitespace-nowrap ${pnlP >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtP(pnlP)}</td>
                  <td className="py-2 text-right text-gray-400">{u.trades.length}</td>
                </tr>
              );
            })}</tbody></table></div>
        </div>
      )}

      <p className="text-center text-[10px] text-gray-700 mt-4">PAPER TRADING SIMULATOR · Neon Postgres · Binance OHLC · SMC + TA · {SYMBOLS.length} пар</p>
    </div>
  );
}
