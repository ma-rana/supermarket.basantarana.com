// create a run: copy config + products, simulate, save everything in one transaction

const fs = require("fs");
const path = require("path");
const { db } = require("./db");
const { DEFAULT_CONFIG, policyFor } = require("./sim/model");
const { simulate } = require("./sim/simulate");

const SEED_FILE = path.join(__dirname, "data", "products.seed.json");

function loadProducts() {
  const raw = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  return raw.map((p) => ({
    ...p,
    cost_cents: Math.round(p.cost * 100),
    price_cents: Math.round(p.price * 100),
  }));
}

function newRunId(seed) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `RUN-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(seed).slice(-4).padStart(4, "0")}`;
}

function createRun({ seed, label } = {}) {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const products = loadProducts();
  seed = Number.isInteger(seed) ? seed : Math.floor(Math.random() * 1e9);

  const openingCost = products.reduce((s, p) => s + p.initial_qty * p.cost_cents, 0);
  if (openingCost > config.opening_inventory_budget_cents) {
    throw new Error(`Opening inventory costs ${openingCost / 100}, above the $40,000 budget`);
  }

  const t0 = Date.now();
  const rec = simulate({ products, config, seed });
  const run_id = newRunId(seed);

  const ins = (table, cols) => {
    const stmt = db.prepare(`INSERT INTO ${table} (run_id, ${cols.join(",")}) VALUES (?, ${cols.map(() => "?").join(",")})`);
    return (row) => stmt.run(run_id, ...cols.map((c) => (row[c] === undefined ? null : row[c])));
  };

  db.exec("BEGIN");
  try {
    ins("runs", ["created_at", "seed", "days", "model_version", "config_json", "status", "duration_ms", "label"])({
      created_at: new Date().toISOString(), seed, days: config.days, model_version: config.model_version,
      config_json: JSON.stringify(config), status: "COMPLETED", duration_ms: Date.now() - t0, label: label || null,
    });
    const rp = ins("run_products", ["product_id", "name", "category", "unit_cost_cents", "unit_price_cents", "initial_qty",
      "perishable", "shelf_life_days", "popularity", "case_pack", "tags", "policy", "planning_daily_demand"]);
    for (const p of products) rp({ ...p, unit_cost_cents: p.cost_cents, unit_price_cents: p.price_cents,
      perishable: p.perishable ? 1 : 0, tags: p.tags.join(","), policy: policyFor(p, config.brain) });

    const write = (table, rows) => {
      if (!rows.length) return;
      const f = ins(table, Object.keys(rows[0]));
      for (const r of rows) f(r);
    };
    write("customer_visits", rec.visits);
    write("transactions", rec.transactions);
    write("transaction_items", rec.items);
    write("lost_demand", rec.lost);
    write("batches", rec.batches);
    write("sale_allocations", rec.allocations);
    write("write_offs", rec.writeOffs);
    write("replenishment_orders", rec.orders);
    write("daily_inventory", rec.dailyInventory);
    write("brain_events", rec.events);
    write("daily_summary", rec.daily);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { run_id, seed, duration_ms: Date.now() - t0 };
}

function getSubmittedRunId() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'submitted_run_id'").get();
  return row ? row.value : null;
}

// only called from the CLI script, not the web app
function setSubmittedRunId(runId) {
  const exists = db.prepare("SELECT 1 FROM runs WHERE run_id = ?").get(runId);
  if (!exists) throw new Error("Run not found: " + runId);
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('submitted_run_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(runId);
}

module.exports = { createRun, getSubmittedRunId, setSubmittedRunId, loadProducts };
