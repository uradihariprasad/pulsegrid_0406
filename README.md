# MARKET MASTER

**Dual-layer momentum & market structure intelligence for the NSE F&O universe.**

*Spot determines direction · Futures reveal positioning · Options validate premium response and contract suitability ·
Volume validates participation · Support & resistance define location · Buyer/seller intelligence evaluates control ·
The unified momentum engine assesses quality, continuation and reversal risk.*

---

## 1. What this is

A production-oriented market-intelligence terminal, not an indicator dashboard. Thirteen analytical engines run over one
normalised feed contract and feed thirteen working tabs plus a per-instrument inspector.

```
Upstox API v2 ──▶ universe discovery (master contract)
                ─▶ provider adapter ─▶ SymbolFeed (typed contract)
                                              │
                                              ▼
   indicators ─▶ underlying ─▶ options ─▶ futures ─▶ S/R ─▶ flow
                                              │
                                              ▼
                            scoring ─▶ quality/stage ─▶ trade geometry ─▶ events
                                              │
                                              ▼
                     Next.js route handlers ─▶ PostgreSQL (Drizzle) ─▶ React terminal
```

### Engine modules (`src/lib/engines/`)

| # | Engine | File | Contract out |
|---|--------|------|--------------|
| A | Underlying spot momentum | `underlying.ts` | `UnderlyingAnalysis` |
| B | Futures positioning (4 categories) | `futures.ts` | `FuturesAnalysis` |
| C/D | Option premium, alignment, premium efficiency, greeks | `options.ts` | `OptionsAnalysis` |
| E | Strike-wise OI windows | `oi.ts` | `OiWindow` |
| F | Dynamic support & resistance (structural / OI-only / confluence) | `structure.ts` | `SRAudit` |
| G | Buyer vs seller control | `flow.ts` | `FlowAnalysis` |
| H/J/K | Genuine-vs-weak, stage, breakout/breakdown validation | `momentum.ts` | `MomentumAnalysis` |
| I | Unified scoring (20/20/15/15/15/15) | `scoring.ts` | `MomentumScores` |
| M | Best strike selection (25/20/15/15/10/10/5) | `strike.ts` | `StrikeSelection` |
| L/N | Target, invalidation, opportunity classification, events | `trade.ts` | `TradeSetup`, `SignalEvent` |
| O | Unified decision pipeline | `index.ts` | `SymbolAnalysis`, `ScanResult` |

Supporting: `src/lib/indicators.ts` (EMA, SMA, VWAP, Bollinger, Wilder ATR, relative volume, fractal swings,
structure read, volume profile, candle aggregation), `src/lib/math.ts` (deterministic PRNG, Black–Scholes–Merton with
greeks, IST helpers, formatting), `src/lib/backtest.ts` (walk-forward evaluation).

### Directory structure

```
src/
  app/
    page.tsx                    terminal shell (server entry)
    layout.tsx                  fonts + metadata
    globals.css                 Tailwind v4 theme + console primitives
    api/
      health/route.ts           db + mode + limitations healthcheck
      session/route.ts          GET status · POST validate token · DELETE clear
      scan/route.ts             full-universe scan (engines)
      symbol/[symbol]/route.ts  instrument detail: candles, options, score history
      history/route.ts          recorded history + walk-forward evaluation
  components/
    Dashboard.tsx               state, tab routing, keyboard shortcuts
    Rail.tsx StatusStrip.tsx Tape.tsx StockDrawer.tsx
    PriceChart.tsx OiLadder.tsx ScanTable.tsx ui.tsx
    tabs/                       01…13 tab implementations
  db/
    index.ts                    pg pool + drizzle client (reads DATABASE_URL)
    schema.ts                   instruments, candles, oi_snapshots, momentum_scores,
                                signal_events, opportunities, settings
  lib/
    types.ts                    every data contract in one place
    upstox.ts                   Upstox v2 client + in-memory credential store + LIMITATIONS
    live.ts                     REST → SymbolFeed adapter (batching, budgets)
    universe.ts                 instrument discovery from the Upstox master contract
    scan.ts                     orchestration + cache + persistence hook
    persist.ts                  repository layer (Drizzle)
    serialize.ts                strips heavy candle arrays from scan payloads
```

---

## 2. Setup

```bash
npm install
cp .env.example .env      # or ensure .env defines DATABASE_URL
npx drizzle-kit push      # create tables in PostgreSQL
npm run dev               # http://localhost:3000
```

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | PostgreSQL connection string (Drizzle/`pg`). Dev `postgresql://postgres:postgres@127.0.0.1:5432/app_db`, production managed Postgres (Render/Neon/Supabase). |
| `NODE_ENV` | no | set by the platform |
| `UPSTOX_ACCESS_TOKEN` | no | *Not used* — the token is submitted at runtime and kept in **process memory only**. Never commit a token. |

No market-data key is read from the client. `NEXT_PUBLIC_*` secrets are not used anywhere.

### Health

`GET /api/health` → `{ ok, db, mode, connected, signals24h, limitations }` (HTTP 503 when the database is unreachable).

---

## 3. Upstox connection

1. Complete the Upstox OAuth2 flow for your app to obtain an **access token** (valid for the session/day per Upstox policy).
2. Paste it into the **UPSTOX ACCESS TOKEN** field in the status strip → **VALIDATE & CONNECT**.
3. The server calls `GET /v2/user/profile` to validate, then `GET /v2/feed/market-data-feed/authorize` for feed
   authorisation. Profile and feed status are returned; the token is not.
4. **DISCONNECT** calls `DELETE /api/session`, clearing the token from process memory.

Security posture:
* token lives in a server-side module store (`src/lib/upstox.ts`), never in localStorage/sessionStorage/cookies;
* it is never echoed in any response, never written to logs, never persisted to the database;
* the password input is cleared from React state immediately after submission;
* `.env` is git-ignored — no credential is committed.

### Endpoints actually used (documented v2)

| Endpoint | Use |
|----------|-----|
| `GET /v2/user/profile` | token validation & identity |
| `GET /v2/market-quote/quotes` | LTP/OHLC/OI/volume/5-level depth |
| `GET /v2/historical-candle/{key}/{interval}/{to}[/{from}]` | 1/5/15/30-minute and daily candles |
| `GET /v2/historical-candle/intraday/{key}/{interval}` | intraday candles |
| `GET /v2/option-chain/{key}?expiry=` (fallback `GET /v2/option/chain`) | option chain, strikes, OI, IV, greeks when supplied |
| `GET /v2/master/...` | master contract download (best effort) |
| `GET /v2/feed/market-data-feed/authorize` | feed endpoint authorisation / connection status |

Nothing outside this list is called, and no field is synthesised that the provider does not return.

---

## 4. Data mode — live Upstox only

There is **no synthetic, replay or simulated data path in the application**. `src/lib/replay.ts` and every generator
alongside it were removed: the only `SymbolFeed` producer is `src/lib/live.ts`, and it only ever maps Upstox REST
responses.

* **Connected** — instrument universe from `GET /v2/master/details?exchange=…`, then live candles, quotes, futures OI and
  option chains. Every instrument carries `source: live`, an age in seconds and a STALE flag when older than 60 s.
* **Not connected** — `/api/scan` returns `connected: false` with **zero instruments** and an explicit notice. The UI
  renders a connection screen (token instructions + provider limitations) instead of tabs showing fabricated values. No
  prices, strikes, expiries, OI values or signals are ever generated to fill the screen.
* If the master contract cannot be downloaded, the scan reports that failure rather than substituting a bundled symbol
  list — the universe is never hardcoded.
* If an individual request fails, that instrument is reported as `Data unavailable: …` and the engines emit
  `INSUFFICIENT DATA` / `unavailable` rather than zero-filling.

---

## 5. Database

| Table | Contents |
|-------|----------|
| `instruments` | instrument master metadata (origin: `upstox-master` / `bundled-fallback`) |
| `candles` | finalised 5-minute candles, unique (symbol, interval, ts), written once per session |
| `oi_snapshots` | timestamped OI snapshots, unique (contract, ts) |
| `momentum_scores` | score evolution per symbol per scan |
| `signal_events` | alerts, deduped on (symbol, kind, title, ts) |
| `opportunities` | trade opportunity records with entry/invalidation/targets |
| `settings` | key/value session markers (e.g. candle write guard) |

Migrations: `drizzle-kit push` (dev) or `drizzle-kit generate && drizzle-kit migrate` (pinned migrations).
Retention: delete `candles`/`oi_snapshots` older than your chosen window with a periodic
`DELETE FROM oi_snapshots WHERE ts < now() - interval '30 days'` job (indexes are in place).

---

## 6. Local development

```bash
npm run dev          # dev server
npm exec tsc -- --noEmit
npm exec vitest -- run     # 27 unit/scenario tests
npm run build        # production build
```

Keyboard: `Alt+1…Alt+0` switch tabs, `Esc` closes the instrument inspector.

---

## 7. Deployment (Render) — one click from the repo

A ready **`render.yaml` blueprint** is included at the repo root:

```bash
# Render dashboard → New → Blueprint → select this repository
# It provisions Postgres + the web service and wires DATABASE_URL automatically.
```

| Setting | Value |
|---------|-------|
| Runtime | Node |
| Build command | `npm install && npx next typegen && npm run build` |
| Start command | `npx drizzle-kit push && npm start` (applies schema, then starts Next) |
| Health check path | `/api/health` |
| Region | `singapore` (closest to NSE / Upstox) |
| Environment | `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`, `DATABASE_URL` (from the blueprint's database) |

No market-data secret is configured on Render: the **Upstox access token is entered in the UI at runtime**, validated
server-side and kept in process memory only.

Manual (non-blueprint) setup is the same two commands plus a `DATABASE_URL` env var. A `Dockerfile` and
`docker-compose.yml` are also included if you prefer a container build on Render:

```bash
docker compose up --build   # postgres + app on :3000
```

### Responsive / mobile

The terminal is fully responsive: below `md` the vertical function rail becomes a sticky horizontal strip, wide tables
scroll horizontally inside their own panel (no page-level sideways scroll), stat grids collapse to 2-up, touch targets
are ≥44px, table rows respond to `:active` (not just hover), the drawer is full-screen, charts resize with the
viewport and respect `safe-area-inset` on notched devices. Lightweight-charts supports tap, pan and pinch-zoom.

---

## 8. Tests

```bash
$ npx vitest run
 ✓ src/lib/__tests__/engines.test.ts (27 tests)
```

Coverage: SMA/EMA seeding, Bollinger collapse, VWAP, ATR, relative-volume no-look-ahead, OI window definitions
(5m/15m/session/baseline-unavailable), all four futures positioning sign pairs, missing-futures handling,
bull-vs-bear scoring separation, missing-component scoring (no phantom points), score bands, illiquid strike rejection,
`NO SUITABLE CONTRACT`, genuine-bullish vs weak-bullish classification, short-covering labelling, divergence warning,
trade geometry ordering (invalidation < entry < T1 < T2), NO TRADE gating, structural/OI-only separation, and
support/resistance side placement.

Synthetic series appear **only** in this test file; they are never imported by the dashboard.

---

## 9. Known limitations (reported in-app, never fabricated)

1. **Aggressor side** — Upstox does not expose per-print taker side for historical candles, so buyer/seller control is
   derived from candle direction and quoted depth and is labelled with a reduced confidence tier. It is never presented
   as verified executed buy/sell volume.
2. **Historical greeks** — when the provider does not return greeks/IV, they are computed with
   Black–Scholes–Merton (r = 6.5%, no dividends, European exercise) and flagged `black-scholes-derived`; the model and
   its assumptions are shown in the UI.
3. **Market-data feed** — `GET /feed/market-data-feed/authorize` is called and reported, but feed frames are protobuf
   encoded and the schema is not bundled with this build, so REST candle/quote polling is the authoritative ingestion
   path. The socket is not used to fabricate ticks.
4. **Master contract** — the universe depends entirely on `GET /v2/master/details`. If it is unreachable the scan fails
   with an explicit notice and **no instruments are shown**; no bundled universe is substituted.
   The master carries no sector column, so sector grouping is reported as `UNCLASSIFIED` instead of being invented.
5. **Futures keys in live mode** — a futures contract key cannot be derived without master-contract rows; if the master
   is unavailable the futures engine reports `INSUFFICIENT DATA` instead of guessing a contract.
6. **Positioning intent** — aggregate OI cannot prove institutional intent; labels are candidate-style with explicit
   confirmations and warnings.
7. **Option chain polling** — throttled, expiry-scoped and budgeted; premium history is fetched for the ATM ±2 family
   within a per-scan request budget, and skipped requests are listed as notes rather than silently reused.
8. **Scores are heuristic** — never displayed as probabilities. The historical tab reports win rate / profit factor /
   expectancy with in-sample vs held-out splits and costs, and states explicitly that the weights are not calibrated.
