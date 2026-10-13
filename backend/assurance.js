// assurance checks, recalculated from the raw records.
// stockouts/waste are business results, not failures - only contradictions fail.

const { db, HISTORY_TABLES } = require("./db");
const { getRun } = require("./reports");

const all = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);

function check(id, group, title, pass, detail, exceptions = []) {
  return { id, group, title, status: pass ? "PASS" : "FAIL", detail, exceptions: exceptions.slice(0, 20), exception_count: exceptions.length };
}

function getAssurance(runId) {
  const run = getRun(runId);
  if (!run) return null;
  const cfg = run.config;
  const days = run.days;
  const checks = [];

  // history completeness
  const dayCount = one("SELECT COUNT(*) n, MIN(day) mn, MAX(day) mx FROM daily_summary WHERE run_id = ?", runId);
  const prodCount = one("SELECT COUNT(*) n FROM run_products WHERE run_id = ?", runId).n;
  const invRows = one("SELECT COUNT(*) n FROM daily_inventory WHERE run_id = ?", runId).n;
  const counts = {};
  for (const t of ["customer_visits", "transactions", "transaction_items", "batches", "sale_allocations", "write_offs", "replenishment_orders", "daily_inventory", "brain_events", "lost_demand"]) {
    counts[t] = one(`SELECT COUNT(*) n FROM ${t} WHERE run_id = ?`, runId).n;
  }
  const daysWithEvents = one("SELECT COUNT(DISTINCT day) n FROM brain_events WHERE run_id = ?", runId).n;
  checks.push(check("H1", "History completeness", `${dayCount.n}/${days} simulated days retained`,
    dayCount.n === days && dayCount.mn === 1 && dayCount.mx === days, `Daily summaries for days ${dayCount.mn}-${dayCount.mx}.`));
  checks.push(check("H2", "History completeness", "Daily inventory record for every product on every day",
    invRows === prodCount * days, `${invRows.toLocaleString()} rows = ${prodCount} products × ${days} days.`));
  checks.push(check("H3", "History completeness", "Store Brain review recorded at every close",
    daysWithEvents === days, `Brain events present on ${daysWithEvents} of ${days} days.`));
  const triggerCount = one("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'trigger' AND (name LIKE '%_no_update' OR name LIKE '%_no_delete')").n;
  checks.push(check("H4", "History completeness", "History is append-only (update/delete blocked in the database)",
    triggerCount === HISTORY_TABLES.length * 2, `${triggerCount} protection triggers on ${HISTORY_TABLES.length} history tables. The web app has no edit or delete routes for runs.`));

  // opening budget + cash
  const openingCost = one("SELECT SUM(initial_qty * unit_cost_cents) c FROM run_products WHERE run_id = ?", runId).c;
  const day1 = one("SELECT opening_cash_cents FROM daily_summary WHERE run_id = ? AND day = 1", runId);
  checks.push(check("C1", "Opening constraints", "Opening inventory within A$40,000 budget",
    openingCost <= cfg.opening_inventory_budget_cents, `Opening stock cost $${(openingCost / 100).toFixed(2)} of $${(cfg.opening_inventory_budget_cents / 100).toFixed(2)}.`));
  checks.push(check("C2", "Opening constraints", "Day 1 operating cash equals A$15,000",
    day1.opening_cash_cents === cfg.opening_cash_cents, `Day 1 opening cash $${(day1.opening_cash_cents / 100).toFixed(2)}.`));

  // inventory
  const recon = all(`
    SELECT p.product_id, p.name, p.initial_qty AS opening,
      COALESCE((SELECT SUM(qty) FROM batches b WHERE b.run_id = p.run_id AND b.product_id = p.product_id AND b.source = 'REPLENISHMENT'),0) AS received,
      COALESCE((SELECT SUM(qty) FROM transaction_items i WHERE i.run_id = p.run_id AND i.product_id = p.product_id),0) AS sold,
      COALESCE((SELECT SUM(qty) FROM write_offs w WHERE w.run_id = p.run_id AND w.product_id = p.product_id),0) AS expired,
      (SELECT closing_qty FROM daily_inventory d WHERE d.run_id = p.run_id AND d.product_id = p.product_id AND d.day = ?) AS closing,
      COALESCE((SELECT SUM(qty) FROM batches b WHERE b.run_id = p.run_id AND b.product_id = p.product_id),0)
        - COALESCE((SELECT SUM(qty) FROM sale_allocations a WHERE a.run_id = p.run_id AND a.product_id = p.product_id),0)
        - COALESCE((SELECT SUM(qty) FROM write_offs w WHERE w.run_id = p.run_id AND w.product_id = p.product_id),0) AS batch_balance
    FROM run_products p WHERE p.run_id = ? ORDER BY p.product_id`, days, runId);
  const reconBad = recon.filter((r) => r.opening + r.received - r.sold - r.expired !== r.closing || r.batch_balance !== r.closing);
  const tot = recon.reduce((a, r) => ({ opening: a.opening + r.opening, received: a.received + r.received, sold: a.sold + r.sold, expired: a.expired + r.expired, closing: a.closing + r.closing }),
    { opening: 0, received: 0, sold: 0, expired: 0, closing: 0 });
  checks.push(check("I1", "Inventory reconciliation", "Opening stock + received − sold − expired = closing stock (every product, 60 days)",
    reconBad.length === 0, `${tot.opening.toLocaleString()} + ${tot.received.toLocaleString()} − ${tot.sold.toLocaleString()} − ${tot.expired.toLocaleString()} = ${(tot.opening + tot.received - tot.sold - tot.expired).toLocaleString()}; recorded closing stock ${tot.closing.toLocaleString()} units. Also matches the batch ledger.`,
    reconBad.map((r) => `${r.product_id} ${r.name}: expected ${r.opening + r.received - r.sold - r.expired}, recorded ${r.closing}, batch ledger ${r.batch_balance}`)));

  const chainBad = all(`SELECT a.product_id, a.day FROM daily_inventory a WHERE a.run_id = ? AND
      (a.opening_qty + a.received_qty - a.expired_qty - a.sold_qty != a.closing_qty
       OR (a.day > 1 AND a.opening_qty != (SELECT b.closing_qty FROM daily_inventory b WHERE b.run_id = a.run_id AND b.product_id = a.product_id AND b.day = a.day - 1)))`, runId);
  checks.push(check("I2", "Inventory reconciliation", "Every product-day balances and carries forward to the next day",
    chainBad.length === 0, `${invRows.toLocaleString()} product-day rows checked.`, chainBad.map((r) => `${r.product_id} day ${r.day}`)));

  const dailySoldBad = all(`SELECT d.product_id, d.day, d.sold_qty,
      COALESCE((SELECT SUM(i.qty) FROM transaction_items i JOIN transactions t ON t.run_id = i.run_id AND t.transaction_id = i.transaction_id
        WHERE i.run_id = d.run_id AND i.product_id = d.product_id AND t.day = d.day),0) AS tx_qty,
      COALESCE((SELECT SUM(a.qty) FROM sale_allocations a WHERE a.run_id = d.run_id AND a.product_id = d.product_id AND a.day = d.day),0) AS alloc_qty
    FROM daily_inventory d WHERE d.run_id = ?`, runId).filter((r) => r.sold_qty !== r.tx_qty || r.sold_qty !== r.alloc_qty);
  checks.push(check("I3", "Inventory reconciliation", "Units sold per day agree across transactions, batch allocations and inventory",
    dailySoldBad.length === 0, "Sales lines, batch (FIFO) allocations and daily inventory movements compared product by product.",
    dailySoldBad.map((r) => `${r.product_id} day ${r.day}: inventory ${r.sold_qty}, transactions ${r.tx_qty}, batches ${r.alloc_qty}`)));

  const negative = all("SELECT product_id, day, closing_qty FROM daily_inventory WHERE run_id = ? AND closing_qty < 0", runId);
  const overAlloc = all(`SELECT b.batch_id, b.qty,
      COALESCE((SELECT SUM(qty) FROM sale_allocations a WHERE a.run_id = b.run_id AND a.batch_id = b.batch_id),0) +
      COALESCE((SELECT SUM(qty) FROM write_offs w WHERE w.run_id = b.run_id AND w.batch_id = b.batch_id),0) AS used
    FROM batches b WHERE b.run_id = ?`, runId).filter((b) => b.used > b.qty);
  checks.push(check("I4", "Inventory reconciliation", "No negative stock and no overselling",
    negative.length === 0 && overAlloc.length === 0, `${counts.batches.toLocaleString()} stock batches: none sold or written off beyond the quantity received.`,
    [...negative.map((r) => `${r.product_id} day ${r.day} closing ${r.closing_qty}`), ...overAlloc.map((b) => `${b.batch_id}: received ${b.qty}, used ${b.used}`)]));

  const expiredSales = all(`SELECT a.day, a.batch_id, a.product_id, a.qty, b.received_day, b.expiry_day FROM sale_allocations a
    JOIN batches b ON b.run_id = a.run_id AND b.batch_id = a.batch_id
    WHERE a.run_id = ? AND (a.day < b.received_day OR (b.expiry_day IS NOT NULL AND a.day >= b.expiry_day))`, runId);
  checks.push(check("I5", "Inventory reconciliation", "No expired (or not-yet-received) product sold",
    expiredSales.length === 0, `${counts.sale_allocations.toLocaleString()} batch sale allocations checked against receipt and expiry days.`,
    expiredSales.map((s) => `${s.batch_id} sold ${s.qty} on day ${s.day} (received ${s.received_day}, expires ${s.expiry_day})`)));

  const woBad = all(`SELECT w.batch_id, w.day, w.qty, w.value_cents, b.unit_cost_cents, b.expiry_day FROM write_offs w JOIN batches b ON b.run_id = w.run_id AND b.batch_id = w.batch_id
    WHERE w.run_id = ? AND (w.value_cents != w.qty * b.unit_cost_cents OR b.expiry_day IS NULL OR w.day != b.expiry_day)`, runId);
  checks.push(check("I6", "Inventory reconciliation", "Every write-off is an expired batch, removed on its expiry morning, valued at cost",
    woBad.length === 0, `${counts.write_offs.toLocaleString()} write-off records checked.`, woBad.map((w) => `${w.batch_id} day ${w.day}`)));

  const orderBad = all(`SELECT o.order_id, o.order_day, o.arrival_day, o.ordered_qty, b.qty AS received_qty, b.received_day FROM replenishment_orders o
    LEFT JOIN batches b ON b.run_id = o.run_id AND b.order_id = o.order_id
    WHERE o.run_id = ? AND (b.batch_id IS NULL OR b.qty != o.ordered_qty OR b.received_day != o.order_day + 1 OR o.arrival_day != o.order_day + 1 OR o.order_day >= ?)`, runId, days);
  checks.push(check("I7", "Inventory reconciliation", "Every order arrives exactly once, next morning (1-day lead time); no orders after Day 60",
    orderBad.length === 0, `${counts.replenishment_orders.toLocaleString()} orders matched to received batches.`, orderBad.map((o) => `${o.order_id} (day ${o.order_day})`)));

  // revenue
  const txBad = all(`SELECT t.transaction_id, t.total_cents, COALESCE(SUM(i.line_total_cents),0) AS lines FROM transactions t
    LEFT JOIN transaction_items i ON i.run_id = t.run_id AND i.transaction_id = t.transaction_id
    WHERE t.run_id = ? GROUP BY t.transaction_id HAVING t.total_cents != lines`, runId);
  const lineBad = one("SELECT COUNT(*) n FROM transaction_items WHERE run_id = ? AND line_total_cents != qty * unit_price_cents", runId).n;
  checks.push(check("R1", "Revenue reconciliation", "Each transaction total = sum of its lines (qty × price)",
    txBad.length === 0 && lineBad === 0, `${counts.transactions.toLocaleString()} transactions and ${counts.transaction_items.toLocaleString()} lines checked.`,
    txBad.map((t) => `${t.transaction_id}: total ${t.total_cents}, lines ${t.lines}`)));
  const dayRev = all(`SELECT d.day, d.revenue_cents, COALESCE((SELECT SUM(total_cents) FROM transactions t WHERE t.run_id = d.run_id AND t.day = d.day),0) AS tx,
      d.cogs_cents, COALESCE((SELECT SUM(cost_cents) FROM transactions t WHERE t.run_id = d.run_id AND t.day = d.day),0) AS txcost
    FROM daily_summary d WHERE d.run_id = ? ORDER BY d.day`, runId);
  const dayRevBad = dayRev.filter((d) => d.revenue_cents !== d.tx || d.cogs_cents !== d.txcost);
  checks.push(check("R2", "Revenue reconciliation", "Daily revenue = sum of that day's recorded transactions",
    dayRevBad.length === 0, `${dayRev.length} days compared (revenue and cost of goods sold).`, dayRevBad.map((d) => `Day ${d.day}: summary ${d.revenue_cents}, transactions ${d.tx}`)));
  const totalRev = dayRev.reduce((s, d) => s + d.revenue_cents, 0);
  const allTx = one("SELECT SUM(total_cents) s FROM transactions WHERE run_id = ?", runId).s;
  checks.push(check("R3", "Revenue reconciliation", "60-day revenue = sum of the daily revenue figures",
    totalRev === allTx, `Sum of daily revenue $${(totalRev / 100).toFixed(2)}; sum of all transactions $${(allTx / 100).toFixed(2)}.`));

  // cash
  const cashRows = all(`SELECT d.day, d.opening_cash_cents, d.revenue_cents, d.replenishment_cents, d.closing_cash_cents,
      COALESCE((SELECT SUM(total_cents) FROM replenishment_orders o WHERE o.run_id = d.run_id AND o.order_day = d.day),0) AS order_spend
    FROM daily_summary d WHERE d.run_id = ? ORDER BY d.day`, runId);
  const cashBad = [];
  cashRows.forEach((d, i) => {
    if (d.opening_cash_cents + d.revenue_cents - d.order_spend !== d.closing_cash_cents) cashBad.push(`Day ${d.day}: opening + revenue − orders ≠ closing`);
    if (d.order_spend !== d.replenishment_cents) cashBad.push(`Day ${d.day}: orders ${d.order_spend} ≠ recorded spend ${d.replenishment_cents}`);
    if (i > 0 && d.opening_cash_cents !== cashRows[i - 1].closing_cash_cents) cashBad.push(`Day ${d.day}: opening cash ≠ previous closing`);
  });
  const finalCash = cashRows[cashRows.length - 1].closing_cash_cents;
  const totalSpend = cashRows.reduce((s, d) => s + d.order_spend, 0);
  checks.push(check("K1", "Operating-cash reconciliation", "Closing cash = opening cash + sales revenue − replenishment spending",
    cashBad.length === 0 && cfg.opening_cash_cents + totalRev - totalSpend === finalCash,
    `$${(cfg.opening_cash_cents / 100).toFixed(2)} + $${(totalRev / 100).toFixed(2)} − $${(totalSpend / 100).toFixed(2)} = $${((cfg.opening_cash_cents + totalRev - totalSpend) / 100).toFixed(2)}; recorded closing cash $${(finalCash / 100).toFixed(2)}.`, cashBad));
  const overspend = all(`SELECT order_id, order_day, total_cents, cash_before_cents FROM replenishment_orders WHERE run_id = ? AND (total_cents > cash_before_cents OR cash_after_cents < 0 OR cash_after_cents != cash_before_cents - total_cents)`, runId);
  const minCash = Math.min(...cashRows.map((d) => d.closing_cash_cents));
  checks.push(check("K2", "Operating-cash reconciliation", "No order spent more cash than was available when it was placed",
    overspend.length === 0 && minCash >= 0, `Lowest closing cash balance: $${(minCash / 100).toFixed(2)}.`, overspend.map((o) => `${o.order_id}: cost ${o.total_cents} > cash ${o.cash_before_cents}`)));

  const summary = { total: checks.length, passed: checks.filter((c) => c.status === "PASS").length };
  summary.failed = summary.total - summary.passed;
  return {
    run_id: runId, is_submitted: run.is_submitted, days, summary, counts, checks,
    inventory_by_product: recon,
    note: "Stockouts, slow-moving stock, expiry write-offs and low cash are business outcomes, not integrity failures. A check fails only if the stored history contradicts itself.",
  };
}

module.exports = { getAssurance };
