import { useState, useEffect, useCallback, useRef, useMemo } from "react";

/* ─────────────────── helpers ─────────────────── */
const fmt = (n, d = 2) =>
  Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
const fmtP = (n) => `${n >= 0 ? "+" : ""}${fmt(n)}%`;
const uid = () => Math.random().toString(36).slice(2, 10);
const ts = () => new Date().toLocaleTimeString("uk-UA", { hour12: false });

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const NICE = { BTCUSDT: "BTC", ETHUSDT: "ETH", SOLUSDT: "SOL", BNBUSDT: "BNB", XRPUSDT: "XRP" };
const SPOT_FEE = 0.001;
const FUT_FEE = 0.0004;
const LEVERAGES = [1, 2, 5, 10, 20];
const PRICE_INTERVAL = 10_000;

const MOCK_BASE = { BTCUSDT: 67500, ETHUSDT: 3420, SOLUSDT: 172, BNBUSDT: 605, XRPUSDT: 0.62 };

/* ─────────── price history for signals ─────────── */
const maxHist = 30;

/* ─────────────── main component ─────────────── */
export default function CryptoSim() {
  /* ---- prices ---- */
  const [prices, setPrices] = useState({});
  const [startPrices, setStartPrices] = useState({});
  const [priceHistory, setPriceHistory] = useState(() =>
    Object.fromEntries(SYMBOLS.map((s) => [s, []]))
  );
  const startPricesSet = useRef(false);

  const fetchPrices = useCallback(async () => {
    try {
      const r = await fetch(
        `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(
          JSON.stringify(SYMBOLS)
        )}`
      );
      if (!r.ok) throw new Error("api");
      const data = await r.json();
      const m = {};
      data.forEach((d) => (m[d.symbol] = parseFloat(d.price)));
      return m;
    } catch {
      /* fallback mock */
      const base = Object.keys(prices).length ? prices : MOCK_BASE;
      const m = {};
      SYMBOLS.forEach((s) => {
        m[s] = base[s] * (1 + (Math.random() - 0.5) * 0.006);
      });
      return m;
    }
  }, [prices]);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      const p = await fetchPrices();
      if (!live) return;
      setPrices(p);
      if (!startPricesSet.current) {
        setStartPrices(p);
        startPricesSet.current = true;
      }
      setPriceHistory((h) => {
        const n = { ...h };
        SYMBOLS.forEach((s) => {
          n[s] = [...(h[s] || []).slice(-(maxHist - 1)), p[s]];
        });
        return n;
      });
    };
    tick();
    const id = setInterval(tick, PRICE_INTERVAL);
    return () => { live = false; clearInterval(id); };
  }, []);

  /* ---- users ---- */
  const [users, setUsers] = useState([
    { id: uid(), name: "Trader 1", startBal: 1000, balance: 1000, spot: {}, futures: [], trades: [] },
  ]);
  const [activeUserId, setActiveUserId] = useState(users[0].id);
  const activeUser = users.find((u) => u.id === activeUserId) || users[0];

  const updateUser = (id, fn) =>
    setUsers((prev) => prev.map((u) => (u.id === id ? fn({ ...u }) : u)));

  /* new user dialog */
  const [showNewUser, setShowNewUser] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBal, setNewBal] = useState("1000");
  const addUser = () => {
    if (!newName.trim()) return;
    const b = Math.max(0, parseFloat(newBal) || 1000);
    const u = { id: uid(), name: newName.trim(), startBal: b, balance: b, spot: {}, futures: [], trades: [] };
    setUsers((p) => [...p, u]);
    setActiveUserId(u.id);
    setShowNewUser(false);
    setNewName("");
    setNewBal("1000");
  };
  const [confirmDel, setConfirmDel] = useState(null);
  const delUser = (id) => {
    setUsers((p) => p.filter((u) => u.id !== id));
    if (activeUserId === id) setActiveUserId(users.find((u) => u.id !== id)?.id);
    setConfirmDel(null);
  };

  /* ---- tabs ---- */
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
        u.spot[sSym] = (u.spot[sSym] || 0) + got;
        u.trades.push({ id: uid(), time: ts(), sym: sSym, inst: "SPOT", side: "BUY", price, amount, fee: fee * price, qty: got });
      } else {
        const held = u.spot[sSym] || 0;
        const qty = Math.min(amount / price, held);
        if (qty <= 0) return u;
        const got = qty * price * (1 - SPOT_FEE);
        const fee = qty * price * SPOT_FEE;
        u.spot[sSym] = held - qty;
        if (u.spot[sSym] < 1e-10) delete u.spot[sSym];
        u.balance += got;
        u.trades.push({ id: uid(), time: ts(), sym: sSym, inst: "SPOT", side: "SELL", price, amount: qty * price, fee, qty });
      }
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
      u.futures.push({
        id: uid(),
        sym: fSym,
        side: fSide,
        leverage: fLev,
        entry: price,
        margin,
        notional,
        fee,
        openTime: ts(),
        liquidated: false,
      });
      u.trades.push({ id: uid(), time: ts(), sym: fSym, inst: "FUTURES", side: `OPEN ${fSide}`, price, amount: notional, fee, qty: notional / price });
      return u;
    });
    setFAmt("");
  };

  /* ---- futures: liquidation check every price update ---- */
  useEffect(() => {
    if (!Object.keys(prices).length) return;
    setUsers((prev) =>
      prev.map((u) => {
        let changed = false;
        const futs = u.futures.map((f) => {
          if (f.liquidated) return f;
          const cp = prices[f.sym];
          if (!cp) return f;
          const pnl =
            f.side === "LONG"
              ? ((cp - f.entry) / f.entry) * f.margin * f.leverage
              : ((f.entry - cp) / f.entry) * f.margin * f.leverage;
          if (pnl <= -f.margin * 0.9) {
            changed = true;
            return { ...f, liquidated: true, liqTime: ts() };
          }
          return f;
        });
        return changed ? { ...u, futures: futs } : u;
      })
    );
  }, [prices]);

  const closeFuture = (fId) => {
    updateUser(activeUserId, (u) => {
      const idx = u.futures.findIndex((f) => f.id === fId);
      if (idx < 0) return u;
      const f = u.futures[idx];
      if (f.liquidated) return u;
      const cp = prices[f.sym];
      if (!cp) return u;
      const pnl =
        f.side === "LONG"
          ? ((cp - f.entry) / f.entry) * f.margin * f.leverage
          : ((f.entry - cp) / f.entry) * f.margin * f.leverage;
      const closeFee = f.notional * FUT_FEE;
      u.balance += f.margin + pnl - closeFee;
      u.trades.push({
        id: uid(), time: ts(), sym: f.sym, inst: "FUTURES",
        side: `CLOSE ${f.side}`, price: cp,
        amount: f.notional, fee: closeFee, qty: pnl,
      });
      u.futures = u.futures.filter((x) => x.id !== fId);
      return u;
    });
  };

  /* ---- signals ---- */
  const calcRSI = (arr, period = 14) => {
    if (arr.length < period + 1) return null;
    const slice = arr.slice(-(period + 1));
    let gains = 0, losses = 0;
    for (let i = 1; i < slice.length; i++) {
      const d = slice[i] - slice[i - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    const ag = gains / period;
    const al = losses / period;
    if (al === 0) return 100;
    const rs = ag / al;
    return 100 - 100 / (1 + rs);
  };

  const calcSMA = (arr, period) => {
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
      let rsiSignal = "NEUTRAL ⚪";
      let rsiColor = "text-yellow-400";
      if (rsi !== null) {
        if (rsi > 70) { rsiSignal = "OVERBOUGHT 🔴"; rsiColor = "text-red-400"; }
        else if (rsi < 30) { rsiSignal = "OVERSOLD 🟢"; rsiColor = "text-green-400"; }
      }
      let trend = "—";
      let trendColor = "text-yellow-400";
      if (sma7 !== null && sma14 !== null) {
        if (sma7 > sma14) { trend = "BULLISH ▲"; trendColor = "text-green-400"; }
        else { trend = "BEARISH ▼"; trendColor = "text-red-400"; }
      }
      return { sym: s, rsi, rsiSignal, rsiColor, sma7, sma14, trend, trendColor };
    });
  }, [priceHistory]);

  /* ---- user equity ---- */
  const calcEquity = (u) => {
    let eq = u.balance;
    Object.entries(u.spot || {}).forEach(([s, qty]) => {
      eq += qty * (prices[s] || 0);
    });
    (u.futures || []).forEach((f) => {
      if (f.liquidated) return;
      const cp = prices[f.sym] || f.entry;
      const pnl =
        f.side === "LONG"
          ? ((cp - f.entry) / f.entry) * f.margin * f.leverage
          : ((f.entry - cp) / f.entry) * f.margin * f.leverage;
      eq += f.margin + pnl;
    });
    return eq;
  };

  /* ---- mini-sparkline ---- */
  const Spark = ({ data, w = 80, h = 24 }) => {
    if (!data || data.length < 2) return <span className="text-gray-600 text-xs">…</span>;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) =>
      `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`
    ).join(" ");
    const clr = data[data.length - 1] >= data[0] ? "#22c55e" : "#ef4444";
    return (
      <svg width={w} height={h} className="inline-block">
        <polyline fill="none" stroke={clr} strokeWidth="1.5" points={pts} />
      </svg>
    );
  };

  /* ──────────────────── render ──────────────────── */
  const bg = "bg-[#0a0a0a]";
  const card = "bg-[#111] border border-[#222] rounded-lg p-4";
  const btnG = "bg-green-600 hover:bg-green-500 text-white font-bold px-4 py-2 rounded text-sm transition";
  const btnR = "bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-2 rounded text-sm transition";
  const btnN = "bg-[#222] hover:bg-[#333] text-gray-200 px-3 py-1.5 rounded text-sm transition";
  const inp = "bg-[#1a1a1a] border border-[#333] text-gray-100 rounded px-3 py-2 text-sm focus:border-green-500 focus:outline-none w-full";
  const select = "bg-[#1a1a1a] border border-[#333] text-gray-100 rounded px-3 py-2 text-sm focus:border-green-500 focus:outline-none";

  return (
    <div className={`${bg} min-h-screen text-gray-100 p-3`} style={{ fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace" }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet" />

      {/* ═══ TOP BAR: USERS ═══ */}
      <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
        <span className="text-xs text-gray-500 mr-1 whitespace-nowrap">USERS:</span>
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-1">
            <button
              onClick={() => setActiveUserId(u.id)}
              className={`px-3 py-1 rounded text-xs font-semibold transition whitespace-nowrap ${
                u.id === activeUserId
                  ? "bg-green-600 text-white"
                  : "bg-[#1a1a1a] text-gray-400 hover:text-white hover:bg-[#222]"
              }`}
            >
              {u.name}
            </button>
            {users.length > 1 && (
              <button
                onClick={() => setConfirmDel(u.id)}
                className="text-red-800 hover:text-red-400 text-xs px-1 transition"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <button onClick={() => setShowNewUser(true)} className="text-green-500 hover:text-green-300 text-sm font-bold px-2 transition">
          + Додати
        </button>
      </div>

      {/* delete confirm */}
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

      {/* new user modal */}
      {showNewUser && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className={`${card} max-w-sm w-full`}>
            <h3 className="text-green-400 font-bold mb-3 text-sm">НОВИЙ ЮЗЕР</h3>
            <input
              className={`${inp} mb-2`}
              placeholder="Ім'я"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addUser()}
              autoFocus
            />
            <input
              className={`${inp} mb-3`}
              placeholder="Стартовий баланс ($)"
              type="number"
              value={newBal}
              onChange={(e) => setNewBal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addUser()}
            />
            <div className="flex gap-2">
              <button onClick={addUser} className={btnG}>Створити</button>
              <button onClick={() => setShowNewUser(false)} className={btnN}>Скасувати</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ BALANCE BAR ═══ */}
      <div className={`${card} mb-3 flex flex-wrap items-center gap-6`}>
        <div>
          <span className="text-xs text-gray-500">ЮЗЕР</span>
          <p className="text-green-400 font-bold">{activeUser.name}</p>
        </div>
        <div>
          <span className="text-xs text-gray-500">БАЛАНС</span>
          <p className="text-white font-bold">${fmt(activeUser.balance)}</p>
        </div>
        <div>
          <span className="text-xs text-gray-500">EQUITY</span>
          <p className="text-white font-bold">${fmt(calcEquity(activeUser))}</p>
        </div>
        {(() => {
          const eq = calcEquity(activeUser);
          const pnl = eq - activeUser.startBal;
          const pnlP = activeUser.startBal > 0 ? (pnl / activeUser.startBal) * 100 : 0;
          return (
            <div>
              <span className="text-xs text-gray-500">P&L</span>
              <p className={`font-bold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                {pnl >= 0 ? "+" : ""}${fmt(pnl)} ({fmtP(pnlP)})
              </p>
            </div>
          );
        })()}
      </div>

      {/* ═══ NAV ═══ */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {["market", "trade", "portfolio", "trades", "signals", "compare"].map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded text-xs font-semibold uppercase transition ${
              view === v ? "bg-green-600 text-white" : "bg-[#1a1a1a] text-gray-400 hover:text-white"
            }`}
          >
            {v === "market" ? "Ринок" : v === "trade" ? "Торгівля" : v === "portfolio" ? "Портфель" : v === "trades" ? "Угоди" : v === "signals" ? "Сигнали" : "Порівняння"}
          </button>
        ))}
      </div>

      {/* ═══ MARKET ═══ */}
      {view === "market" && (
        <div className={card}>
          <h2 className="text-green-400 font-bold text-sm mb-3">РИНОК</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs">
                  <th className="text-left py-1 pr-4">ПАРА</th>
                  <th className="text-right py-1 pr-4">ЦІНА</th>
                  <th className="text-right py-1 pr-4">ЗМІНА</th>
                  <th className="text-center py-1">ГРАФІК</th>
                </tr>
              </thead>
              <tbody>
                {SYMBOLS.map((s) => {
                  const p = prices[s];
                  const sp = startPrices[s];
                  const chg = p && sp ? ((p - sp) / sp) * 100 : 0;
                  return (
                    <tr key={s} className="border-t border-[#222]">
                      <td className="py-2 pr-4 text-yellow-400 font-semibold">{NICE[s]}/USDT</td>
                      <td className="py-2 pr-4 text-right text-white">${p ? fmt(p, p < 1 ? 4 : 2) : "—"}</td>
                      <td className={`py-2 pr-4 text-right font-semibold ${chg >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {fmtP(chg)}
                      </td>
                      <td className="py-2 text-center">
                        <Spark data={priceHistory[s]} />
                      </td>
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
              <button
                key={t}
                onClick={() => setInstrument(t)}
                className={`px-4 py-1.5 rounded text-xs font-bold transition ${
                  instrument === t ? "bg-yellow-500 text-black" : "bg-[#1a1a1a] text-gray-400 hover:text-white"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {instrument === "SPOT" ? (
            <div className={card}>
              <h2 className="text-green-400 font-bold text-sm mb-3">SPOT ТОРГІВЛЯ</h2>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="text-[10px] text-gray-500">МОНЕТА</label>
                  <select className={select + " w-full"} value={sSym} onChange={(e) => setSSym(e.target.value)}>
                    {SYMBOLS.map((s) => <option key={s} value={s}>{NICE[s]}/USDT</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">НАПРЯМОК</label>
                  <div className="flex gap-1">
                    <button onClick={() => setSSide("BUY")} className={`flex-1 py-2 rounded text-xs font-bold ${sSide === "BUY" ? "bg-green-600 text-white" : "bg-[#1a1a1a] text-gray-400"}`}>BUY</button>
                    <button onClick={() => setSSide("SELL")} className={`flex-1 py-2 rounded text-xs font-bold ${sSide === "SELL" ? "bg-red-600 text-white" : "bg-[#1a1a1a] text-gray-400"}`}>SELL</button>
                  </div>
                </div>
              </div>
              <div className="mb-2">
                <label className="text-[10px] text-gray-500">СУМА (USDT)</label>
                <input className={inp} type="number" placeholder="0.00" value={sAmt} onChange={(e) => setSAmt(e.target.value)} />
              </div>
              {prices[sSym] && (
                <p className="text-[10px] text-gray-500 mb-2">
                  Ціна: ${fmt(prices[sSym], prices[sSym] < 1 ? 4 : 2)} · Комісія: 0.1%
                  {sAmt && parseFloat(sAmt) > 0 && (
                    <> · Отримаєте: {sSide === "BUY"
                      ? `${fmt((parseFloat(sAmt) / prices[sSym]) * (1 - SPOT_FEE), 6)} ${NICE[sSym]}`
                      : `$${fmt(parseFloat(sAmt) * (1 - SPOT_FEE))}`
                    }</>
                  )}
                </p>
              )}
              <button onClick={execSpot} className={sSide === "BUY" ? btnG : btnR} style={{ width: "100%" }}>
                {sSide} {NICE[sSym]}
              </button>
            </div>
          ) : (
            <div className={card}>
              <h2 className="text-yellow-400 font-bold text-sm mb-3">FUTURES ТОРГІВЛЯ</h2>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="text-[10px] text-gray-500">МОНЕТА</label>
                  <select className={select + " w-full"} value={fSym} onChange={(e) => setFSym(e.target.value)}>
                    {SYMBOLS.map((s) => <option key={s} value={s}>{NICE[s]}/USDT</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">НАПРЯМОК</label>
                  <div className="flex gap-1">
                    <button onClick={() => setFSide("LONG")} className={`flex-1 py-2 rounded text-xs font-bold ${fSide === "LONG" ? "bg-green-600 text-white" : "bg-[#1a1a1a] text-gray-400"}`}>LONG</button>
                    <button onClick={() => setFSide("SHORT")} className={`flex-1 py-2 rounded text-xs font-bold ${fSide === "SHORT" ? "bg-red-600 text-white" : "bg-[#1a1a1a] text-gray-400"}`}>SHORT</button>
                  </div>
                </div>
              </div>
              <div className="mb-2">
                <label className="text-[10px] text-gray-500">ПЛЕЧЕ</label>
                <div className="flex gap-1">
                  {LEVERAGES.map((l) => (
                    <button key={l} onClick={() => setFLev(l)} className={`flex-1 py-1.5 rounded text-xs font-bold transition ${fLev === l ? "bg-yellow-500 text-black" : "bg-[#1a1a1a] text-gray-400"}`}>
                      x{l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-2">
                <label className="text-[10px] text-gray-500">СУМА (USDT)</label>
                <input className={inp} type="number" placeholder="0.00" value={fAmt} onChange={(e) => setFAmt(e.target.value)} />
              </div>
              {prices[fSym] && fAmt && parseFloat(fAmt) > 0 && (
                <p className="text-[10px] text-gray-500 mb-2">
                  Маржа: ${fmt(parseFloat(fAmt) / fLev)} · Notional: ${fmt(parseFloat(fAmt))} · Комісія: ${fmt(parseFloat(fAmt) * FUT_FEE)}
                </p>
              )}
              <button onClick={execFutures} className={fSide === "LONG" ? btnG : btnR} style={{ width: "100%" }}>
                OPEN {fSide} x{fLev}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══ PORTFOLIO ═══ */}
      {view === "portfolio" && (
        <div className="space-y-3">
          <div className={card}>
            <h2 className="text-green-400 font-bold text-sm mb-3">SPOT ПОЗИЦІЇ</h2>
            {Object.keys(activeUser.spot).length === 0 ? (
              <p className="text-gray-600 text-xs">Немає spot-позицій</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-gray-500 text-xs"><th className="text-left py-1">МОНЕТА</th><th className="text-right py-1">К-СТЬ</th><th className="text-right py-1">ВАРТІСТЬ</th></tr></thead>
                <tbody>
                  {Object.entries(activeUser.spot).map(([s, qty]) => (
                    <tr key={s} className="border-t border-[#222]">
                      <td className="py-1 text-yellow-400">{NICE[s]}</td>
                      <td className="py-1 text-right">{fmt(qty, 6)}</td>
                      <td className="py-1 text-right">${fmt(qty * (prices[s] || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className={card}>
            <h2 className="text-yellow-400 font-bold text-sm mb-3">FUTURES ПОЗИЦІЇ</h2>
            {activeUser.futures.length === 0 ? (
              <p className="text-gray-600 text-xs">Немає відкритих futures-позицій</p>
            ) : (
              <div className="space-y-2">
                {activeUser.futures.map((f) => {
                  const cp = prices[f.sym] || f.entry;
                  const pnl = f.liquidated ? -f.margin
                    : f.side === "LONG"
                      ? ((cp - f.entry) / f.entry) * f.margin * f.leverage
                      : ((f.entry - cp) / f.entry) * f.margin * f.leverage;
                  const pnlP = f.margin > 0 ? (pnl / f.margin) * 100 : 0;
                  return (
                    <div key={f.id} className={`p-3 rounded border ${f.liquidated ? "border-red-800 bg-red-950/30" : "border-[#333] bg-[#0d0d0d]"}`}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-yellow-400 font-semibold text-sm">{NICE[f.sym]} {f.side} x{f.leverage}</span>
                        {f.liquidated ? (
                          <span className="text-red-500 font-bold text-xs animate-pulse">LIQUIDATED</span>
                        ) : (
                          <button onClick={() => closeFuture(f.id)} className="bg-red-700 hover:bg-red-600 text-white text-xs px-3 py-1 rounded font-bold transition">CLOSE</button>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-[10px] text-gray-400">
                        <div>Entry: ${fmt(f.entry, f.entry < 1 ? 4 : 2)}</div>
                        <div>Current: ${fmt(cp, cp < 1 ? 4 : 2)}</div>
                        <div>Margin: ${fmt(f.margin)}</div>
                        <div className={pnl >= 0 ? "text-green-400" : "text-red-400"}>
                          PnL: {pnl >= 0 ? "+" : ""}${fmt(pnl)} ({fmtP(pnlP)})
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ TRADES ═══ */}
      {view === "trades" && (
        <div className={card}>
          <h2 className="text-green-400 font-bold text-sm mb-3">ІСТОРІЯ УГОД — {activeUser.name}</h2>
          {activeUser.trades.length === 0 ? (
            <p className="text-gray-600 text-xs">Немає угод</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500">
                    <th className="text-left py-1">ЧАС</th>
                    <th className="text-left py-1">ІНСТР</th>
                    <th className="text-left py-1">МОНЕТА</th>
                    <th className="text-left py-1">ТИП</th>
                    <th className="text-right py-1">ЦІНА</th>
                    <th className="text-right py-1">СУМА</th>
                    <th className="text-right py-1">КОМІСІЯ</th>
                  </tr>
                </thead>
                <tbody>
                  {[...activeUser.trades].reverse().map((t) => (
                    <tr key={t.id} className="border-t border-[#222]">
                      <td className="py-1 text-gray-400">{t.time}</td>
                      <td className="py-1">{t.inst}</td>
                      <td className="py-1 text-yellow-400">{NICE[t.sym]}</td>
                      <td className={`py-1 font-semibold ${t.side.includes("BUY") || t.side.includes("LONG") ? "text-green-400" : "text-red-400"}`}>{t.side}</td>
                      <td className="py-1 text-right">${fmt(t.price, t.price < 1 ? 4 : 2)}</td>
                      <td className="py-1 text-right">${fmt(t.amount)}</td>
                      <td className="py-1 text-right text-gray-500">${fmt(t.fee, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ SIGNALS ═══ */}
      {view === "signals" && (
        <div className={card}>
          <h2 className="text-green-400 font-bold text-sm mb-3">СИГНАЛИ</h2>
          <p className="text-[10px] text-gray-600 mb-3">RSI(14) · SMA(7) vs SMA(14) · Локальний розрахунок, потрібно ≥15 тіків (~2.5 хв)</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs">
                <th className="text-left py-1">ПАРА</th>
                <th className="text-center py-1">RSI(14)</th>
                <th className="text-center py-1">СИГНАЛ RSI</th>
                <th className="text-center py-1">SMA(7)</th>
                <th className="text-center py-1">SMA(14)</th>
                <th className="text-center py-1">ТРЕНД</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.sym} className="border-t border-[#222]">
                  <td className="py-2 text-yellow-400 font-semibold">{NICE[s.sym]}</td>
                  <td className="py-2 text-center">{s.rsi !== null ? fmt(s.rsi, 1) : "—"}</td>
                  <td className={`py-2 text-center font-semibold ${s.rsiColor}`}>{s.rsiSignal}</td>
                  <td className="py-2 text-center">{s.sma7 !== null ? `$${fmt(s.sma7, 2)}` : "—"}</td>
                  <td className="py-2 text-center">{s.sma14 !== null ? `$${fmt(s.sma14, 2)}` : "—"}</td>
                  <td className={`py-2 text-center font-semibold ${s.trendColor}`}>{s.trend}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ COMPARE ═══ */}
      {view === "compare" && (
        <div className={card}>
          <h2 className="text-green-400 font-bold text-sm mb-3">ПОРІВНЯННЯ ЮЗЕРІВ</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs">
                <th className="text-left py-1">ЮЗЕР</th>
                <th className="text-right py-1">СТАРТ</th>
                <th className="text-right py-1">EQUITY</th>
                <th className="text-right py-1">P&L $</th>
                <th className="text-right py-1">P&L %</th>
                <th className="text-right py-1">УГОД</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const eq = calcEquity(u);
                const pnl = eq - u.startBal;
                const pnlP = u.startBal > 0 ? (pnl / u.startBal) * 100 : 0;
                return (
                  <tr key={u.id} className={`border-t border-[#222] ${u.id === activeUserId ? "bg-[#1a1a1a]" : ""}`}>
                    <td className="py-2 text-yellow-400 font-semibold">{u.name}</td>
                    <td className="py-2 text-right">${fmt(u.startBal)}</td>
                    <td className="py-2 text-right text-white font-semibold">${fmt(eq)}</td>
                    <td className={`py-2 text-right font-semibold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {pnl >= 0 ? "+" : ""}${fmt(pnl)}
                    </td>
                    <td className={`py-2 text-right font-semibold ${pnlP >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {fmtP(pnlP)}
                    </td>
                    <td className="py-2 text-right text-gray-400">{u.trades.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ FOOTER ═══ */}
      <p className="text-center text-[10px] text-gray-700 mt-4">
        PAPER TRADING SIMULATOR · Фейкові гроші · Binance REST API · {SYMBOLS.length} пар
      </p>
    </div>
  );
}
