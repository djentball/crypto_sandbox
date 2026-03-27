# Crypto Paper Trading Simulator

## Project Overview
Multi-user paper trading simulator with Bloomberg-terminal aesthetic. Next.js full-stack app with Neon Postgres for persistent storage, deployed on Vercel.

## Tech Stack
- Next.js 16 (App Router)
- React 19, TypeScript
- Tailwind CSS v4 (via @tailwindcss/postcss)
- Neon Postgres (@neondatabase/serverless)
- Deployed on Vercel

## File Structure
```
index.html                     — browser-ready version (React+Babel+Tailwind CDN, self-contained, legacy)
crypto-trading-simulator.jsx   — artifact version (React component for Cowork, legacy)
CLAUDE.md                      — this file
.claude/settings.local.json    — local permissions
.env.example                   — env template
.gitignore
package.json
tsconfig.json
postcss.config.mjs
next.config.ts
src/
  app/
    globals.css                — Tailwind imports + theme
    layout.tsx                 — root layout with JetBrains Mono font
    page.tsx                   — entry point, renders TradingApp
    TradingApp.tsx             — main client component (all UI + trading logic)
    api/
      users/
        route.ts               — GET (list), POST (create), DELETE
        [id]/route.ts          — PATCH (update balance/spot/futures)
      trades/
        route.ts               — GET (by userId), POST (record)
      strategies/
        route.ts               — GET (log), POST (log entry), PATCH (update config)
  lib/
    db.ts                      — Neon connection helper
    constants.ts               — shared constants (SYMBOLS, fees, etc.)
    migrate.mjs                — database migration script
```

## Architecture
### Client-Server Split
- **Client**: prices from Binance, trading logic, signal calculations (RSI, SMA), auto-strategy engine
- **Server**: user persistence, trade history, strategy config via API routes
- State syncs to DB on every trade + debounced balance updates

### Database Schema (Neon Postgres)
- `users` — id, name, start_bal, balance, spot (JSONB), futures (JSONB)
- `trades` — id, user_id, time, symbol, instrument, side, price, amount, fee, qty
- `strategies` — user_id, type, symbols (JSONB), amount_per_trade, active
- `strategy_log` — user_id, time, symbol, action, price, amount, reason

### Data Flow
1. On load: fetch users + strategies from DB
2. On user switch: fetch trades + strategy log
3. Prices: Binance klines API (15m OHLC candles, client-side), initial load fetches 100 candles, then appends every 15min. Fallback to mock ±0.3%
4. Trades: executed client-side, then POSTed to DB
5. Strategy engine: runs client-side on price ticks, persists results to DB

### Trading Logic
**Spot** (0.1% fee):
- BUY:  `received = (amount / price) * (1 - 0.001)`
- SELL: `received = (qty * price) * (1 - 0.001)`

**Futures** (0.04% fee on notional):
- Margin = amount / leverage
- LONG PnL:  `(currentPrice - entryPrice) / entryPrice * margin * leverage`
- SHORT PnL: `(entryPrice - currentPrice) / entryPrice * margin * leverage`
- Liquidation: `PnL <= -margin * 0.9`
- **Stop Loss**: optional price level; LONG triggers when `price <= SL`, SHORT when `price >= SL`
- **Take Profit**: optional price level; LONG triggers when `price >= TP`, SHORT when `price <= TP`
- SL/TP auto-close the position, return margin ± PnL − fee to balance, record trade as `SL LONG`/`TP SHORT` etc.

### Signals (local calc, no external API)
- RSI(14): >70 OVERBOUGHT / <30 OVERSOLD / else NEUTRAL
- SMA(7) vs SMA(14): bullish/bearish trend
- MACD(12,26,9): EMA(12)−EMA(26) vs Signal EMA(9), histogram crossover
- RSI/SMA need ≥15 price ticks (~3.75 hrs), MACD needs ≥26 ticks (~6.5 hrs)
- **SMC (Smart Money Concepts)** — uses OHLC candle data:
  - BOS (Break of Structure): detects swing highs/lows, signals when price breaks last swing point
  - FVG (Fair Value Gap): finds 3-candle imbalances (high[0] < low[2] for bull, low[0] > high[2] for bear), signals when price enters gap
  - Order Blocks: identifies last opposite candle before a strong impulsive move, signals when price returns to OB zone

### Auto-Strategy Engine
Each user has a `strategy` object:
```
{ type, symbols: [], amountPerTrade, timeframe: "15m"|"1h"|"4h", active: bool, log: [] }
```
**Available strategies** (defined in `STRATEGIES` object):
- `none` — manual trading (default)
- `rsi` — RSI Mean Reversion: BUY when RSI<30, SELL when RSI>70
- `macd` — MACD Crossover: BUY when MACD histogram crosses above 0, SELL when crosses below 0
- `donchian` — Donchian Breakout (Turtle): BUY when price breaks above 20-period high, SELL when breaks below 20-period low
- `smc_fvg` — SMC Fair Value Gap: BUY when price enters bullish FVG, SELL when enters bearish FVG
- `smc_bos` — SMC Break of Structure: BUY on bullish BOS, SELL on bearish BOS
- `smc_ob` — SMC Order Block: BUY when price returns to bullish OB, SELL when returns to bearish OB

**Timeframes**: each user can select 15m, 1h, or 4h candle timeframe for their strategy.
Higher timeframes reduce noise but produce fewer signals. Candle data is fetched from Binance klines API.

**Execution**: on every price tick, for each user with `strategy.active === true`,
the engine evaluates signals for each selected symbol and executes SPOT trades.
Auto-trades are marked `[AUTO]` in the trade history.
Strategy log stores last 50 entries with timestamp, symbol, action, price, reason.

## Design System
- Background: `#0a0a0a`
- Cards: `#111` with `#222` borders
- Font: JetBrains Mono (Google Fonts)
- Green (`green-400/600`): profit, buy, positive
- Red (`red-400/600`): loss, sell, liquidation
- Yellow (`yellow-400/500`): neutral, pair names, futures accent
- Numbers: thousand separators, 2-4 decimal places

## Key Conventions
- All text in Ukrainian
- Each user is fully isolated (balance, portfolio, trades)
- Futures liquidation check runs on every price update
- Default starting balance: $1,000 (configurable per user)
- Supported pairs: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT

## Setup & Deployment
### Local Development
```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL
npm run db:migrate            # create tables in Neon
npm run dev                   # http://localhost:3000
```

### Deploy to Vercel
1. Push to GitHub
2. Import repo in Vercel
3. Add Neon Postgres integration from Vercel Marketplace (auto-sets DATABASE_URL)
4. Deploy — done

### Environment Variables
- `DATABASE_URL` — Neon Postgres connection string (set automatically by Vercel+Neon integration)

## Common Tasks
- **Add a coin**: add to `SYMBOLS`, `NICE`, and `MOCK_BASE` in `TradingApp.tsx` + `constants.ts`
- **Change fee**: update `SPOT_FEE` or `FUT_FEE` in `TradingApp.tsx` + `constants.ts`
- **Add leverage option**: append to `LEVERAGES` array
- **New view/tab**: add to the nav `map` array and add a conditional render block in `TradingApp.tsx`
- **Add strategy**: add to `STRATEGIES` object + add logic branch in the strategy engine `useEffect`
- **Modify DB schema**: edit `migrate.mjs`, run `npm run db:migrate`
