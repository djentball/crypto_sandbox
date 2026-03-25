"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";

/* ─────────────────── helpers ─────────────────── */
const fmt = (n: number, d = 2) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtP = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n)}%`;
const uid = () => Math.random().toString(36).slice(2, 10);
const ts = () => new Date().toLocaleTimeString("uk-UA", { hour12: false });

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
  sma_cross: { name: "SMA Crossover", desc: "BUY при SMA7>SMA14, SELL при SMA7<SMA14" },
  rsi_sma:   { name: "RSI + SMA Combo", desc: "BUY при RSI<30 і SMA7>SMA14, SELL при RSI>70 і SMA7<SMA14" },
};

/* ── types ── */
interface Trade {
  id: string; time: string; sym: string; inst: string; side: string;
  price: number; amount: number; fee: number; qty: number;
}
interface Future {
  id: string; sym: string; side: string; leverage: number;
  entry: number; margin: number; notional: number; fee: number;
  openTime: string; liquidated: boolean; liqTime?: string;
}
interface Strategy {
  type: string; symbols: string[]; amountPerTrade: number;
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
      body: JSON.stringify({ userId, type: s.type, symbols: s.symbols, amountPerTrade: s.amountPerTrade, active: s.active }),
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
  const [priceHistory, setPriceHistory] = useState<Record<string, number[]>>(() =>
    Object.fromEntries(SYMBOLS.map((s) => [s, []]))
  );
  const startPricesSet = useRef(false);
  const tickRef = useRef(0);

  const fetchPrices = useCallback(async () => {
    try {
      const r = await fetch(
        `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(SYMBOLS))}`
      );
      if (!r.ok) throw new Error("api");
      const data = await r.json();
      const m: Record<string, number> = {};
      data.forEach((d: any) => (m[d.symbol] = parseFloat(d.price)));
      return m;
    } catch {
      const base = Object.keys(prices).length ? prices : MOCK_BASE;
      const m: Record<string, number> = {};
      SYMBOLS.forEach((s) => { m[s] = base[s] * (1 + (Math.random() - 0.5) * 0.006); });
      return m;
    }
  }, [prices]);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      const p = await fetchPrices();
      if (!live) return;
      setPrices(p);
      tickRef.current += 1;
      if (!startPricesSet.current) { setStartPrices(p); startPricesSet.current = true; }
      setPriceHistory((h) => {
        const n = { ...h };
        SYMBOLS.forEach((s) => { n[s] = [...(h[s] || []).slice(-(maxHist - 1)), p[s]]; });
        return n;
      });
    };
    tick();
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
      strategy: { type: "none", symbols: ["BTCUSDT"], amountPerTrade: 100, active: false, log: [] },
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

  const execFutures = () => {
    const amount = parseFloat(fAmt);
    if (!amount || amount <= 0 || !prices[fSym]) return;
    const price = prices[fSym];
    const notional = amount;
    const margin = notional / fLev;
    const fee = notional * FUT_FEE;
    updateUser(activeUserId, (u) => {
      if (margin + fee > u.balance) return u;
      u.balance -= margin + fee;
      u.futures = [...u.futures, {
        id: uid(), sym: fSym, side: fSide, leverage: fLev,
        entry: price, margin, notional, fee, openTime: ts(), liquidated: false,
      }];
      const trade: Trade = { id: uid(), time: ts(), sym: fSym, inst: "FUTURES", side: `OPEN ${fSide}`, price, amount: notional, fee, qty: notional / price };
      u.trades = [trade, ...u.trades];
      api.recordTrade(u.id, trade);
      persistUser(u);
      return u;
    });
    setFAmt("");
  };

  /* ---- futures liquidation ---- */
  useEffect(() => {
    if (!Object.keys(prices).length) return;
    setUsers((prev) =>
      prev.map((u) => {
        let changed = false;
        const futs = u.futures.map((f) => {
          if (f.liquidated) return f;
          const cp = prices[f.sym];
          if (!cp) return f;
          const pnl = f.side === "LONG"
            ? ((cp - f.entry) / f.entry) * f.margin * f.leverage
            : ((f.entry - cp) / f.entry) * f.margin * f.leverage;
          if (pnl <= -f.margin * 0.9) {
            changed = true;
            return { ...f, liquidated: true, liqTime: ts() };
          }
          return f;
        });
        if (changed) {
          const nu = { ...u, futures: futs };
          api.updateUser(nu.id, { futures: futs });
          return nu;
        }
        return u;
      })
    );
  }, [prices]);

  const closeFuture = (fId: string) => {
    updateUser(activeUserId, (u) => {
      const f = u.futures.find((x) => x.id === fId);
      if (!f || f.liquidated) return u;
      const cp = prices[f.sym];
      if (!cp) return u;
      const pnl = f.side === "LONG"
        ? ((cp - f.entry) / f.entry) * f.margin * f.leverage
        : ((f.entry - cp) / f.entry) * f.margin * f.leverage;
      const closeFee = f.notional * FUT_FEE;
      u.balance += f.margin + pnl - closeFee;
      u.futures = u.futures.filter((x) => x.id !== fId);
      const trade: Trade = { id: uid(), time: ts(), sym: f.sym, inst: "FUTURES", side: `CLOSE ${f.side}`, price: cp, amount: f.notional, fee: closeFee, qty: pnl };
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
      return { sym: s, rsi, rsiSignal, rsiColor, sma7, sma14, trend, trendColor };
    });
  }, [priceHistory]);

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

      st.symbols.forEach((sym) => {
        const h = priceHistory[sym] || [];
        const price = prices[sym];
        if (!price) return;
        const rsi = calcRSI(h);
        const sma7 = calcSMA(h, 7);
        const sma14 = calcSMA(h, 14);
        let action: string | null = null;

        if (st.type === "rsi") {
          if (rsi !== null && rsi < 30) action = "BUY";
          if (rsi !== null && rsi > 70) action = "SELL";
        } else if (st.type === "sma_cross") {
          if (sma7 !== null && sma14 !== null) { action = sma7 > sma14 ? "BUY" : "SELL"; }
        } else if (st.type === "rsi_sma") {
          if (rsi !== null && sma7 !== null && sma14 !== null) {
            if (rsi < 30 && sma7 > sma14) action = "BUY";
            if (rsi > 70 && sma7 < sma14) action = "SELL";
          }
        }
        if (!action) return;

        const amt = st.amountPerTrade;
        const time = ts();
        if (action === "BUY" && uc.balance >= amt) {
          const got = (amt / price) * (1 - SPOT_FEE);
          const fee = (amt / price) * SPOT_FEE;
          uc.balance -= amt;
          uc.spot[sym] = (uc.spot[sym] || 0) + got;
          const trade: Trade = { id: uid(), time, sym, inst: "SPOT", side: "BUY [AUTO]", price, amount: amt, fee: fee * price, qty: got };
          uc.trades = [trade, ...uc.trades];
          const reason = st.type === "rsi" ? `RSI=${fmt(rsi!,1)}<30` : st.type === "sma_cross" ? "SMA7>SMA14" : `RSI=${fmt(rsi!,1)}<30 & SMA7>SMA14`;
          const logEntry = { time, sym, action: "BUY", price, amount: amt, reason };
          uc.strategy.log = [logEntry, ...uc.strategy.log].slice(0, 50);
          api.recordTrade(uc.id, trade);
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
            const reason = st.type === "rsi" ? `RSI=${fmt(rsi!,1)}>70` : st.type === "sma_cross" ? "SMA7<SMA14" : `RSI=${fmt(rsi!,1)}>70 & SMA7<SMA14`;
            const logEntry = { time, sym, action: "SELL", price, amount: sellQty * price, reason };
            uc.strategy.log = [logEntry, ...uc.strategy.log].slice(0, 50);
            api.recordTrade(uc.id, trade);
            api.recordStrategyLog(uc.id, logEntry);
          }
        }
      });
      api.updateUser(uc.id, { balance: uc.balance, spot: uc.spot, futures: uc.futures });
      return uc;
    }));
  }, [prices, priceHistory]);

  /* ---- equity ---- */
  const calcEquity = (u: User) => {
    let eq = u.balance;
    Object.entries(u.spot || {}).forEach(([s, qty]) => { eq += qty * (prices[s] || 0); });
    (u.futures || []).forEach((f) => {
      if (f.liquidated) return;
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
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
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
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
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
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
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
        <div className={`${card} mb-3 flex flex-wrap items-center gap-6`}>
          <div><span className="text-xs text-gray-500">ЮЗЕР</span><p className="text-green-400 font-bold">{activeUser.name}</p></div>
          <div><span className="text-xs text-gray-500">БАЛАНС</span><p className="text-white font-bold">${fmt(activeUser.balance)}</p></div>
          <div><span className="text-xs text-gray-500">EQUITY</span><p className="text-white font-bold">${fmt(calcEquity(activeUser))}</p></div>
          {(() => {
            const eq = calcEquity(activeUser);
            const pnl = eq - activeUser.startBal;
            const pnlP = activeUser.startBal > 0 ? (pnl / activeUser.startBal) * 100 : 0;
            return <div><span className="text-xs text-gray-500">P&L</span><p className={`font-bold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>{pnl >= 0 ? "+" : ""}${fmt(pnl)} ({fmtP(pnlP)})</p></div>;
          })()}
          {activeUser.strategy?.active && activeUser.strategy.type !== "none" && (
            <div><span className="text-xs text-gray-500">СТРАТЕГІЯ</span><p className="text-yellow-400 font-bold text-sm">⚡ {STRATEGIES[activeUser.strategy.type]?.name}</p></div>
          )}
        </div>
      )}

      {/* ═══ NAV ═══ */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {["market", "trade", "portfolio", "trades", "signals", "strategy", "compare"].map((v) => (
          <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded text-xs font-semibold uppercase transition cursor-pointer ${view === v ? (v === "strategy" ? "bg-yellow-500 text-black" : "bg-green-600 text-white") : "bg-[#1a1a1a] text-gray-400 hover:text-white"}`}>
            {v === "market" ? "Ринок" : v === "trade" ? "Торгівля" : v === "portfolio" ? "Портфель" : v === "trades" ? "Угоди" : v === "signals" ? "Сигнали" : v === "strategy" ? "⚡ Стратегія" : "Порівняння"}
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
          <p className="text-[10px] text-gray-600 mt-2">Оновлення кожні 10 сек · Binance API</p>
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
              {prices[fSym] && fAmt && parseFloat(fAmt) > 0 && <p className="text-[10px] text-gray-500 mb-2">Маржа: ${fmt(parseFloat(fAmt) / fLev)} · Notional: ${fmt(parseFloat(fAmt))} · Комісія: ${fmt(parseFloat(fAmt) * FUT_FEE)}</p>}
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
                const pnl = f.liquidated ? -f.margin : f.side === "LONG" ? ((cp - f.entry) / f.entry) * f.margin * f.leverage : ((f.entry - cp) / f.entry) * f.margin * f.leverage;
                const pnlP = f.margin > 0 ? (pnl / f.margin) * 100 : 0;
                return (
                  <div key={f.id} className={`p-3 rounded border ${f.liquidated ? "border-red-800 bg-red-950/30" : "border-[#333] bg-[#0d0d0d]"}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-yellow-400 font-semibold text-sm">{NICE[f.sym]} {f.side} x{f.leverage}</span>
                      {f.liquidated ? <span className="text-red-500 font-bold text-xs animate-pulse">LIQUIDATED</span> : <button onClick={() => closeFuture(f.id)} className="bg-red-700 hover:bg-red-600 text-white text-xs px-3 py-1 rounded font-bold transition cursor-pointer">CLOSE</button>}
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-[10px] text-gray-400">
                      <div>Entry: ${fmt(f.entry, f.entry < 1 ? 4 : 2)}</div><div>Current: ${fmt(cp, cp < 1 ? 4 : 2)}</div><div>Margin: ${fmt(f.margin)}</div>
                      <div className={pnl >= 0 ? "text-green-400" : "text-red-400"}>PnL: {pnl >= 0 ? "+" : ""}${fmt(pnl)} ({fmtP(pnlP)})</div>
                    </div>
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
            <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-gray-500"><th className="text-left py-1">ЧАС</th><th className="text-left py-1">ІНСТР</th><th className="text-left py-1">МОНЕТА</th><th className="text-left py-1">ТИП</th><th className="text-right py-1">ЦІНА</th><th className="text-right py-1">СУМА</th><th className="text-right py-1">КОМІСІЯ</th></tr></thead>
              <tbody>{activeUser.trades.map((t) => (
                <tr key={t.id} className="border-t border-[#222]">
                  <td className="py-1 text-gray-400">{t.time}</td><td className="py-1">{t.inst}</td><td className="py-1 text-yellow-400">{NICE[t.sym]}</td>
                  <td className={`py-1 font-semibold ${t.side.includes("BUY") || t.side.includes("LONG") ? "text-green-400" : "text-red-400"}`}>{t.side}</td>
                  <td className="py-1 text-right">${fmt(t.price, t.price < 1 ? 4 : 2)}</td><td className="py-1 text-right">${fmt(t.amount)}</td><td className="py-1 text-right text-gray-500">${fmt(t.fee, 4)}</td>
                </tr>
              ))}</tbody></table></div>
          )}
        </div>
      )}

      {/* ═══ SIGNALS ═══ */}
      {view === "signals" && (
        <div className={card}>
          <h2 className="text-green-400 font-bold text-sm mb-3">СИГНАЛИ</h2>
          <p className="text-[10px] text-gray-600 mb-3">RSI(14) · SMA(7) vs SMA(14) · Потрібно ≥15 тіків (~2.5 хв)</p>
          <table className="w-full text-sm"><thead><tr className="text-gray-500 text-xs"><th className="text-left py-1">ПАРА</th><th className="text-center py-1">RSI(14)</th><th className="text-center py-1">СИГНАЛ RSI</th><th className="text-center py-1">SMA(7)</th><th className="text-center py-1">SMA(14)</th><th className="text-center py-1">ТРЕНД</th></tr></thead>
            <tbody>{signals.map((s) => (
              <tr key={s.sym} className="border-t border-[#222]">
                <td className="py-2 text-yellow-400 font-semibold">{NICE[s.sym]}</td>
                <td className="py-2 text-center">{s.rsi !== null ? fmt(s.rsi, 1) : "—"}</td>
                <td className={`py-2 text-center font-semibold ${s.rsiColor}`}>{s.rsiSignal}</td>
                <td className="py-2 text-center">{s.sma7 !== null ? `$${fmt(s.sma7, 2)}` : "—"}</td>
                <td className="py-2 text-center">{s.sma14 !== null ? `$${fmt(s.sma14, 2)}` : "—"}</td>
                <td className={`py-2 text-center font-semibold ${s.trendColor}`}>{s.trend}</td>
              </tr>
            ))}</tbody></table>
        </div>
      )}

      {/* ═══ STRATEGY ═══ */}
      {view === "strategy" && activeUser && (
        <div className="space-y-3">
          <div className={card}>
            <h2 className="text-yellow-400 font-bold text-sm mb-3">⚡ АВТО-СТРАТЕГІЯ — {activeUser.name}</h2>
            <p className="text-[10px] text-gray-500 mb-4">Бот автоматично торгує SPOT на кожному тіку цін. Сигнали потребують ≥15 тіків (~2.5 хв).</p>
            <div className="mb-3"><label className="text-[10px] text-gray-500 block mb-1">СТРАТЕГІЯ</label>
              <div className="grid grid-cols-2 gap-2">{Object.entries(STRATEGIES).map(([key, s]) => (
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

      {/* ═══ COMPARE ═══ */}
      {view === "compare" && (
        <div className={card}>
          <h2 className="text-green-400 font-bold text-sm mb-3">ПОРІВНЯННЯ ЮЗЕРІВ</h2>
          <table className="w-full text-sm"><thead><tr className="text-gray-500 text-xs"><th className="text-left py-1">ЮЗЕР</th><th className="text-left py-1">СТРАТЕГІЯ</th><th className="text-right py-1">СТАРТ</th><th className="text-right py-1">EQUITY</th><th className="text-right py-1">P&L $</th><th className="text-right py-1">P&L %</th><th className="text-right py-1">УГОД</th></tr></thead>
            <tbody>{users.map((u) => {
              const eq = calcEquity(u); const pnl = eq - u.startBal;
              const pnlP = u.startBal > 0 ? (pnl / u.startBal) * 100 : 0;
              return (
                <tr key={u.id} className={`border-t border-[#222] ${u.id === activeUserId ? "bg-[#1a1a1a]" : ""}`}>
                  <td className="py-2 text-yellow-400 font-semibold">{u.name}</td>
                  <td className="py-2 text-xs">{u.strategy?.active && u.strategy.type !== "none" ? <span className="text-yellow-400">⚡ {STRATEGIES[u.strategy.type]?.name}</span> : <span className="text-gray-600">Ручна</span>}</td>
                  <td className="py-2 text-right">${fmt(u.startBal)}</td>
                  <td className="py-2 text-right text-white font-semibold">${fmt(eq)}</td>
                  <td className={`py-2 text-right font-semibold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>{pnl >= 0 ? "+" : ""}${fmt(pnl)}</td>
                  <td className={`py-2 text-right font-semibold ${pnlP >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtP(pnlP)}</td>
                  <td className="py-2 text-right text-gray-400">{u.trades.length}</td>
                </tr>
              );
            })}</tbody></table>
        </div>
      )}

      <p className="text-center text-[10px] text-gray-700 mt-4">PAPER TRADING SIMULATOR · Neon Postgres · Binance REST API · {SYMBOLS.length} пар</p>
    </div>
  );
}
