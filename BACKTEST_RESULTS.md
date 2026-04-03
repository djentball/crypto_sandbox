# Backtest Results — Crypto Paper Trading Simulator

## Test Parameters
- **Period**: 1 year of historical Binance data
- **Starting Balance**: $1,000
- **Instrument**: FUTURES (unless noted)
- **Timeframe**: 4h (unless noted)
- **SL**: 3% from entry (unless noted)
- **Direction**: AUTO (BUY→LONG, SELL→SHORT)

---

## Full Leaderboard (sorted by P&L%)

| # | Strategy | Assets | TF | Notional | Leverage | SL | TP | P&L | % | Max DD | Win Rate | Trades |
|---|----------|--------|----|----------|---------|-----|-----|------|---|--------|----------|--------|
| 1 | BOS | ETH+XRP | 4h | $1,000 | x5 | 3% | 15% | +$1,519 | +152.0% | -29.3% | 35.0% | 356 |
| 2 | BOS | ETH+XRP | 4h | $500 | x5 | 3% | 15% | +$759 | +75.9% | -16.7% | 35.0% | 356 |
| 3 | MACD | SOL | 4h | $500 | x3 | 3% | 10% | +$702 | +70.0% | -11.9% | 37.7% | — |
| 4 | BOS | XRP | 4h | $500 | x5 | 3% | 15% | +$449 | +44.9% | -14.2% | 39.3% | 169 |
| 5 | Donchian | SOL | 1h | $500 | x5 | 3% | 17% | +$444 | +44.4% | -17.4% | 35.8% | 381 |
| 6 | MACD | BTC+ETH | 4h | $300 | x3 | 3% | 10% | +$430 | +43.0% | -7.7% | 38.3% | — |
| 7 | Donchian | SOL | 1h | $500 | x3 | 3% | 15% | +$426 | +42.6% | -16.6% | 35.8% | 381 |
| 8 | Donchian | SOL | 1h | $500 | x5 | 3% | 15% | +$426 | +42.6% | -16.6% | 35.8% | 381 |
| 9 | FVG | SOL | 4h | $500 | x3 | 3% | 12% | +$380 | +38.0% | -13.5% | 36.8% | — |
| 10 | Donchian | SOL | 1h | $500 | x5 | 3% | 30% | +$356 | +35.6% | -18.7% | 35.8% | 381 |
| 11 | BOS | BTC+ETH | 4h | $500 | x5 | 3% | 15% | +$347 | +34.7% | -24.5% | 35.3% | — |
| 12 | Donchian | ETH | 1h | $500 | x5 | — | 30% | +$335 | +33.5% | -36.2% | 37.9% | 355 |
| 13 | Donchian | SOL | 1h | $500 | x5 | 3% | 20% | +$329 | +32.9% | -18.4% | 35.8% | 381 |
| 14 | FVG | SOL | 4h | $500 | x5 | 3% | 10% | +$306 | +30.6% | -14.5% | 36.8% | — |
| 15 | Donchian | SOL | 1h | $500 | x5 | — | 30% | +$243 | +24.3% | -28.0% | 40.5% | 381 |
| 16 | Donchian | XRP | 1h | $500 | x3 | 3% | 15% | +$226 | +22.6% | -19.8% | 36.6% | 367 |
| 17 | RSI | SOL | 1h | $500 | x3 | 3% | 8% | +$205 | +20.5% | -19.7% | 49.6% | — |
| 18 | Donchian | BNB | 1h | $500 | x5 | — | 30% | +$162 | +16.2% | -15.9% | 37.7% | 399 |
| 19 | Donchian | BNB | 4h | $500 | x3 | — | 15% | +$81 | +8.1% | -20.1% | 33.3% | 85 |
| 20 | BOS | BTC | 4h | $500 | x3 | 3% | 12% | +$53 | +5.4% | -19.8% | 39.4% | — |
| 21 | BOS | SOL | 4h | $500 | x5 | 3% | 12% | -$170 | -17.0% | -37.4% | 25.7% | 211 |
| 22 | OB | BTC+ETH | 4h | $500 | x5 | 3% | 12% | -$209 | -20.9% | -35.8% | 37.7% | 919 |
| 23 | OB | SOL | 4h | $500 | x5 | 3% | 12% | -$436 | -43.6% | -51.5% | 31.2% | 436 |

---

## Key Insights

### Best Strategies
- **BOS (Break of Structure)** on ETH+XRP is the overall champion. Scales linearly with notional ($500→+$759, $1000→+$1,519). Moderate drawdown at $500 (-16.7%).
- **MACD Crossover** on SOL is the best single-asset strategy (+$702, lowest drawdown -11.9%). On BTC+ETH gives best risk/reward ratio (-7.7% DD for +43%).
- **Donchian Breakout** is surprisingly strong on SOL 1h timeframe (+$444 with TP 17%). Unlike other strategies, Donchian works better on 1h than 4h — breakout needs more signals.

### Asset Patterns
- **SOL** works best with trend-following/breakout strategies (MACD, FVG, Donchian). Too volatile for structural strategies (BOS, OB).
- **ETH+XRP** is the best combo for structure-based strategies (BOS). Diversification reduces drawdown.
- **XRP alone** is excellent for BOS (+$449, lowest DD -14.2%) and decent for Donchian (+$226).
- **BTC alone** underperforms in most strategies — better paired with ETH or XRP.
- **BNB** is the most stable but least profitable asset across all strategies.

### Strategy Patterns
- Win rate 35-40% with wide TP (12-17%) outperforms higher win rate with narrow TP — "let winners run".
- 4h timeframe beats 1h for most strategies, **except Donchian** which needs 1h for more breakout signals.
- Donchian sweet spot for TP is 15-17%. Beyond 20%, profits decline as trends don't sustain.
- OB generates too many false signals (400-900 trades/year) — unprofitable everywhere.
- Donchian x3 vs x5 with SL 3% gives identical results — SL triggers before leverage difference matters.

### Risk/Reward Rankings (P&L% / Drawdown%)
1. MACD · SOL · 4h — 70% / 11.9% = **5.9x**
2. MACD · BTC+ETH · 4h — 43% / 7.7% = **5.6x**
3. BOS · ETH+XRP · 4h ($1000) — 152% / 29.3% = **5.2x**
4. BOS · ETH+XRP · 4h ($500) — 75.9% / 16.7% = **4.5x**
5. BOS · XRP · 4h — 44.9% / 14.2% = **3.2x**
6. Donchian · SOL · 1h (TP17) — 44.4% / 17.4% = **2.6x**
7. Donchian · SOL · 1h (TP15) — 42.6% / 16.6% = **2.6x**

### Recommended Portfolio (parallel strategies, $1000 total capital)
- **MACD · SOL · 4h · $500 · x3 · SL3/TP10** — trend-following leg (~+$702/yr)
- **BOS · ETH+XRP · 4h · $500 · x5 · SL3/TP15** — structural leg (~+$759/yr)
- **Expected combined P&L**: ~$1,461 (+146%) per year with diversified risk
- Alternative 3-leg portfolio: MACD SOL + BOS ETH+XRP + Donchian SOL 1h (adds breakout signals)

---

*Last updated: 2026-04-03*
