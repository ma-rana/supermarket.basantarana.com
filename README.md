# Autonomous Supermarket — Simulation, Store Brain & Commercial Assurance

A full-stack prototype that creates a small, unstaffed IGA-style supermarket near
Swanston Street / Melbourne Town Hall, runs it for 60 simulated days, and reports
whether the result is commercially coherent and trustworthy. Fictional educational
scenario; not affiliated with IGA.

- **Frontend:** React 18 (Vite) + React Router + Recharts
- **Backend:** Node.js + Express
- **Database:** SQLite through Node's built-in `node:sqlite` module (no native package to compile)

**Submitted Run ID: `RUN-20261013-160251-2345`** (seed 12345)

## 1. Install and run (localhost)

Requires **Node.js 22.5 or later** (tested on 22.22.2; `node:sqlite` is built into Node 22.5+). No environment variables are needed.

```bash
npm run setup     # installs backend and frontend dependencies
npm start         # builds the React app and starts the server
```

Open **http://localhost:3000**. The app opens directly on the Submitted Run's 60-Day Commercial Report.
To use a different port: `PORT=4000 npm start` (macOS/Linux) or `set PORT=4000 && npm start` (Windows cmd).

Optional environment variables: `PORT` (default 3000) and `READ_ONLY=true`, which disables creating new runs. Read-only mode is used for the public online demo so visitors cannot fill the server's disk; leave it off locally.

Optional development mode with hot reload: run `npm start --prefix backend` in one terminal and `npm run dev --prefix frontend` in another, then open http://localhost:5173.

## Online demo (optional)

The same app and Submitted Run are also deployed at **https://supermarket.basantarana.com** (Ubuntu VPS, Nginx reverse proxy, Let's Encrypt HTTPS, systemd service).

- Open https://supermarket.basantarana.com. It loads the Submitted Run (`RUN-20261013-160251-2345`) report directly.
- The 60-Day Commercial Report, Daily Reports (Days 1–60), Commercial Assurance, Model Declaration and product traces all work the same as locally.
- Health check: https://supermarket.basantarana.com/api/health returns `{"status":"ok"}`.
- The online demo runs with `READ_ONLY=true`, so **new runs can't be created there**. To test creating a new run, use the local copy (section 2).

## 2. Database, the Submitted Run, and new runs

- The database is **`backend/data/supermarket.db`** (included in the ZIP). It contains the completed Submitted Run and its full history.
- The Submitted Run ID is stored in the `app_settings` table and is shown with a **SUBMITTED RUN** badge everywhere in the app.
- **Create a new run** from the web app (*All simulation runs → Run simulation*, optional seed) or the command line:
  `npm run new-run` or `npm run new-run -- 12345` (a specific seed). Each run takes about 1.5 seconds.
  New runs are stored separately and never change the Submitted Run. Because customer behaviour is random, a new run will not reproduce the Submitted Run's figures unless you use the same seed and model version.
- (Command line only) `npm run set-submitted -- RUN-ID` changes which run is marked as submitted. The web app has no route for this.

## 3. Where to find things in the app

| Requirement | Location |
|---|---|
| Submitted Run + Run ID | Top bar on every page; *All simulation runs* lists all runs |
| 60-Day Commercial Report (Parts 1–3) | *60-Day Commercial Report* tab |
| Commercial Assurance (Part 4) | *Commercial Assurance* tab (summary also at the end of the report) |
| Daily Reports, Days 1–60 | *Daily Reports* tab: one reusable view with a day selector |
| Model Declaration | *Model Declaration* tab |
| Trace a product | *Products* tab, or any product link: daily movements, batches, orders, Store Brain decisions |
| Trace a sale | Daily Report → Transactions → click a transaction to see its lines |

## 4. Architecture and data flow

```
products.seed.json + sim/model.js (configuration)
        │  frozen into runs.config_json + run_products when a run starts
        ▼
sim/simulate.js — 60-day loop, in memory:
   morning: receive yesterday's orders → remove expired batches
   day:     customers arrive and shop (sales taken FIFO from batches)
   close:   Store Brain reviews every product, raises alerts, places cash-funded orders
        ▼
runs.js — writes the whole history in ONE SQLite transaction (all or nothing)
        ▼
SQLite history (append-only):
   runs, run_products, customer_visits, transactions, transaction_items, lost_demand,
   batches, sale_allocations, write_offs, replenishment_orders, daily_inventory,
   brain_events, daily_summary
        ▼
reports.js / assurance.js — read-only queries → Express API → React pages
```

- **Configuration, history and reports are separate.** Configuration is frozen per run; history tables only receive INSERTs. Reports and assurance checks are calculated from history when requested and are never stored.
- **Append-only history** is enforced in the database: every history table has `BEFORE UPDATE` and `BEFORE DELETE` triggers that abort the change. The API has no edit or delete routes for runs.
- **Money is stored as whole cents** (integers), so revenue and cash reconcile exactly with no rounding drift.

## 5. Customer/demand model and Store Brain (summary)

The full assumptions are on the *Model Declaration* page. In short:

- **Customers:** expected customers per weekday (Mon 560 to Fri 650, Sat 430, Sun 380) for a CBD office-worker location, a new-store ramp-up from 80% to 100% traffic by Day 21, ±6% daily noise, and an hourly arrival profile (weekday peaks at commute and lunch times; flatter weekends).
- **Shopping missions:** breakfast grab, lunch meal, snack & drink, top-up shop, resident stock-up and urgent essentials. Each mission sets the basket size and category mix, and the mix changes with time of day and weekday/weekend. Within a category, products are chosen by popularity weight, with a boost for mission-relevant items (e.g. "lunch" items at lunch). If a product is unavailable, the unmet unit is recorded and the customer may switch to another in-stock product in the same category.
- **Products:** 68 products in 8 categories. Opening stock costs A$35,358 (budget A$40,000; the unused budget does not become cash). Perishables are tracked as dated batches and sold first-expiry-first-out; expired batches are written off before opening.
- **Store Brain (rule-based):** at every close it forecasts each product from a 7-day average (lifted 25% after a sell-out), and classifies it as sold out, low stock, expiry risk or slow-moving. It manages four policies (daily-fresh, short-life, long-life chilled, shelf-stable), each with its own reorder point and target cover. Orders are paid from operating cash immediately, funded in priority order, never exceed available cash, and arrive the next morning. No orders are placed after Day 60.

## 6. AI collaboration

- **Tool used:** Microsoft Copilot, used for the product catalogue draft, modelling ideas, code assist, reconciliation checks, testing and README drafting.
- **Product catalogue:** the 68 products (names, pack sizes, categories, prices, unit costs, shelf lives, popularity) were first drafted with AI in `backend/data/catalogue.base.json`. The draft was reviewed for plausibility (realistic CBD prices, margins and shelf lives, a broad small-supermarket range), corrected (see examples 1 and 2), and the final range is my own modelling decision. Opening quantities were then calculated by `scripts/plan-opening-stock.js` from the customer model, not chosen by AI, and kept within the A$40,000 budget.
- **Responsibility:** I reviewed the generated model and results against plausibility tests before accepting them, and I remain responsible for the submitted system and its claims.
- **Examples where AI output was changed or rejected:**
  1. **Unrealistic demand.** The first catalogue/mission weights produced about 6 umbrellas a day, eggs outselling milk, and instant noodles as the store's top product. Each mission gave every category a fixed share, so the few household items split a large slice between them. The category weights and occasional-item popularity were rebalanced until water, milk and bananas led and occasional items sold about 1 a day.
  2. **Margins too high.** The first run showed a 49.6% gross margin (for example, A$0.45 water selling at A$2.20). Unit costs were corrected to give a realistic 39.8%.
  3. **Findings that did not match the data.** A generated finding said "ready meals and drinks carry the store", but the data showed Dairy, not Drinks, as the second-largest profit category. Another claimed "no rise in stockouts" without measuring it. Findings were rewritten so every statement is calculated from the run (sell-outs were in fact 28 in Days 1–30 and 23 in Days 31–60).
  4. **Checks that could not fail.** Assurance checks were tested against a deliberately tampered copy of the database (one sale line, one day's cash and one product's stock changed). All three tampers were detected and pinpointed.

## 7. Known limitations

- Operating costs (rent, monitoring staff, utilities, hardware) are outside the client's model boundary, so the closing cash balance overstates the store's real surplus.
- Customer volumes, mission mix, weekday/weekend split and product popularity are assumptions, not calibrated to real point-of-sale data.
- The Store Brain's 7-day average forecast ignores day-of-week patterns. This is deliberately left in the Submitted Run because it explains the main waste finding (F1); a weekday-aware forecast is the first recommended change.
- Prices are fixed (no promotions, markdowns or price elasticity); suppliers always deliver in full the next morning; shrinkage/theft is not modelled; customers are anonymous.
- Each 60-day run adds about 25 MB to the SQLite database.

## 8. Project structure

```
backend/
  server.js            Express API (+ serves the built React app)
  db.js                SQLite schema and append-only triggers
  runs.js              create a run, freeze config, write history in one transaction
  reports.js           60-day report, findings, daily report, product trace
  assurance.js         independent reconciliation and integrity checks
  sim/model.js         customer, mission and Store Brain configuration
  sim/simulate.js      60-day simulation and Store Brain logic
  sim/rng.js           seeded random number generator
  scripts/             create-run, set-submitted, plan-opening-stock
  data/                catalogue (seed JSON) and supermarket.db
frontend/src/pages/    Report, Daily, Assurance, Model, Products, ProductTrace, Runs
```
