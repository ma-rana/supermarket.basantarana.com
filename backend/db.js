// sqlite setup. history tables are append-only (triggers block update/delete)

const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "supermarket.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  seed INTEGER NOT NULL,
  days INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  label TEXT
);
CREATE TABLE IF NOT EXISTS run_products (
  run_id TEXT NOT NULL REFERENCES runs(run_id), product_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
  unit_cost_cents INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, initial_qty INTEGER NOT NULL,
  perishable INTEGER NOT NULL, shelf_life_days INTEGER, popularity REAL NOT NULL, case_pack INTEGER NOT NULL,
  tags TEXT, policy TEXT NOT NULL, planning_daily_demand REAL,
  PRIMARY KEY (run_id, product_id)
);
CREATE TABLE IF NOT EXISTS customer_visits (
  run_id TEXT NOT NULL REFERENCES runs(run_id), day INTEGER NOT NULL, visit_no INTEGER NOT NULL, minute INTEGER NOT NULL,
  mission TEXT NOT NULL, outcome TEXT NOT NULL, transaction_id TEXT,
  PRIMARY KEY (run_id, day, visit_no)
);
CREATE TABLE IF NOT EXISTS transactions (
  run_id TEXT NOT NULL REFERENCES runs(run_id), transaction_id TEXT NOT NULL, day INTEGER NOT NULL, minute INTEGER NOT NULL,
  visit_no INTEGER NOT NULL, mission TEXT NOT NULL, item_count INTEGER NOT NULL, units INTEGER NOT NULL,
  total_cents INTEGER NOT NULL, cost_cents INTEGER NOT NULL,
  PRIMARY KEY (run_id, transaction_id)
);
CREATE TABLE IF NOT EXISTS transaction_items (
  run_id TEXT NOT NULL REFERENCES runs(run_id), transaction_id TEXT NOT NULL, line_no INTEGER NOT NULL, product_id TEXT NOT NULL,
  qty INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, unit_cost_cents INTEGER NOT NULL, line_total_cents INTEGER NOT NULL,
  PRIMARY KEY (run_id, transaction_id, line_no)
);
CREATE TABLE IF NOT EXISTS lost_demand (
  run_id TEXT NOT NULL REFERENCES runs(run_id), day INTEGER NOT NULL, product_id TEXT NOT NULL,
  units INTEGER NOT NULL, substituted_units INTEGER NOT NULL,
  PRIMARY KEY (run_id, day, product_id)
);
CREATE TABLE IF NOT EXISTS batches (
  run_id TEXT NOT NULL REFERENCES runs(run_id), batch_id TEXT NOT NULL, product_id TEXT NOT NULL, source TEXT NOT NULL,
  order_id TEXT, received_day INTEGER NOT NULL, expiry_day INTEGER, qty INTEGER NOT NULL, unit_cost_cents INTEGER NOT NULL,
  PRIMARY KEY (run_id, batch_id)
);
CREATE TABLE IF NOT EXISTS sale_allocations (
  run_id TEXT NOT NULL REFERENCES runs(run_id), day INTEGER NOT NULL, product_id TEXT NOT NULL, batch_id TEXT NOT NULL, qty INTEGER NOT NULL,
  PRIMARY KEY (run_id, day, batch_id)
);
CREATE TABLE IF NOT EXISTS write_offs (
  run_id TEXT NOT NULL REFERENCES runs(run_id), day INTEGER NOT NULL, product_id TEXT NOT NULL, batch_id TEXT NOT NULL,
  qty INTEGER NOT NULL, value_cents INTEGER NOT NULL, reason TEXT NOT NULL,
  PRIMARY KEY (run_id, day, batch_id)
);
CREATE TABLE IF NOT EXISTS replenishment_orders (
  run_id TEXT NOT NULL REFERENCES runs(run_id), order_id TEXT NOT NULL, order_day INTEGER NOT NULL, arrival_day INTEGER NOT NULL,
  product_id TEXT NOT NULL, trigger TEXT NOT NULL, forecast_units REAL NOT NULL, stock_position INTEGER NOT NULL, target_qty REAL NOT NULL,
  requested_qty INTEGER NOT NULL, ordered_qty INTEGER NOT NULL, unit_cost_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
  cash_before_cents INTEGER NOT NULL, cash_after_cents INTEGER NOT NULL, cash_constrained INTEGER NOT NULL,
  PRIMARY KEY (run_id, order_id)
);
CREATE TABLE IF NOT EXISTS daily_inventory (
  run_id TEXT NOT NULL REFERENCES runs(run_id), day INTEGER NOT NULL, product_id TEXT NOT NULL,
  opening_qty INTEGER NOT NULL, received_qty INTEGER NOT NULL, expired_qty INTEGER NOT NULL, sold_qty INTEGER NOT NULL,
  closing_qty INTEGER NOT NULL, closing_value_cents INTEGER NOT NULL, status TEXT NOT NULL, policy TEXT NOT NULL,
  forecast_units REAL NOT NULL, cover_days REAL NOT NULL, lost_units INTEGER NOT NULL, substituted_units INTEGER NOT NULL,
  PRIMARY KEY (run_id, day, product_id)
);
CREATE TABLE IF NOT EXISTS brain_events (
  run_id TEXT NOT NULL REFERENCES runs(run_id), event_id INTEGER NOT NULL, day INTEGER NOT NULL, phase TEXT NOT NULL,
  product_id TEXT, event_type TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL, action TEXT NOT NULL, data_json TEXT,
  PRIMARY KEY (run_id, event_id)
);
CREATE TABLE IF NOT EXISTS daily_summary (
  run_id TEXT NOT NULL REFERENCES runs(run_id), day INTEGER NOT NULL, weekday TEXT NOT NULL, is_weekend INTEGER NOT NULL,
  traffic_ramp REAL NOT NULL, customers INTEGER NOT NULL, walkouts INTEGER NOT NULL, transactions INTEGER NOT NULL, units INTEGER NOT NULL,
  revenue_cents INTEGER NOT NULL, cogs_cents INTEGER NOT NULL, gross_profit_cents INTEGER NOT NULL,
  write_off_units INTEGER NOT NULL, write_off_cents INTEGER NOT NULL, received_units INTEGER NOT NULL,
  replenishment_orders INTEGER NOT NULL, replenishment_units INTEGER NOT NULL, replenishment_cents INTEGER NOT NULL,
  opening_cash_cents INTEGER NOT NULL, closing_cash_cents INTEGER NOT NULL,
  closing_inventory_units INTEGER NOT NULL, closing_inventory_cents INTEGER NOT NULL,
  sold_out_products INTEGER NOT NULL, low_stock_products INTEGER NOT NULL,
  PRIMARY KEY (run_id, day)
);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);

CREATE INDEX IF NOT EXISTS ix_tx_day ON transactions(run_id, day);
CREATE INDEX IF NOT EXISTS ix_items_product ON transaction_items(run_id, product_id);
CREATE INDEX IF NOT EXISTS ix_events_day ON brain_events(run_id, day);
CREATE INDEX IF NOT EXISTS ix_events_product ON brain_events(run_id, product_id);
CREATE INDEX IF NOT EXISTS ix_orders_product ON replenishment_orders(run_id, product_id);
CREATE INDEX IF NOT EXISTS ix_inv_product ON daily_inventory(run_id, product_id);
CREATE INDEX IF NOT EXISTS ix_visits_day ON customer_visits(run_id, day);
`);

const HISTORY_TABLES = ["runs", "run_products", "customer_visits", "transactions", "transaction_items", "lost_demand",
  "batches", "sale_allocations", "write_offs", "replenishment_orders", "daily_inventory", "brain_events", "daily_summary"];

for (const t of HISTORY_TABLES) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t}
      BEGIN SELECT RAISE(ABORT, 'Simulation history is append-only: ${t} cannot be updated'); END;
    CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t}
      BEGIN SELECT RAISE(ABORT, 'Simulation history is append-only: ${t} cannot be deleted'); END;
  `);
}

module.exports = { db, DB_PATH, HISTORY_TABLES };
