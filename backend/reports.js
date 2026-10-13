// report queries, all calculated from the stored run history

const { db } = require("./db");
const { CATEGORIES, WEEKDAYS } = require("./sim/model");
const { getSubmittedRunId } = require("./runs");

const all = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const pct = (a, b) => (b ? +((100 * a) / b).toFixed(1) : 0);
const r2 = (x) => +Number(x || 0).toFixed(2);

function getRun(runId) {
  const run = one("SELECT * FROM runs WHERE run_id = ?", runId);
  if (!run) return null;
  return { ...run, config: JSON.parse(run.config_json), config_json: undefined, is_submitted: getSubmittedRunId() === runId };
}

function listRuns() {
  const submitted = getSubmittedRunId();
  return all(`SELECT r.run_id, r.created_at, r.seed, r.days, r.model_version, r.status, r.duration_ms, r.label,
      COUNT(d.day) AS days_recorded, SUM(d.customers) AS customers, SUM(d.revenue_cents) AS revenue_cents,
      SUM(d.gross_profit_cents) AS gross_profit_cents, SUM(d.write_off_cents) AS write_off_cents
    FROM runs r LEFT JOIN daily_summary d ON d.run_id = r.run_id
    GROUP BY r.run_id ORDER BY r.created_at DESC`).map((r) => ({ ...r, is_submitted: r.run_id === submitted }));
}

function products(runId) {
  return all("SELECT * FROM run_products WHERE run_id = ? ORDER BY product_id", runId);
}

// model declaration

function getModel(runId) {
  const run = getRun(runId);
  if (!run) return null;
  const c = run.config;
  const prods = products(runId);
  const openingCost = prods.reduce((s, p) => s + p.initial_qty * p.unit_cost_cents, 0);
  const byCat = {};
  for (const p of prods) {
    const k = p.category;
    byCat[k] ||= { category: k, label: CATEGORIES[k], products: 0, opening_units: 0, opening_cost_cents: 0, perishable: 0 };
    byCat[k].products++; byCat[k].opening_units += p.initial_qty; byCat[k].opening_cost_cents += p.initial_qty * p.unit_cost_cents;
    byCat[k].perishable += p.perishable;
  }
  const policyCounts = {};
  for (const p of prods) policyCounts[p.policy] = (policyCounts[p.policy] || 0) + 1;
  return {
    run: { run_id: run.run_id, created_at: run.created_at, seed: run.seed, model_version: run.model_version, is_submitted: run.is_submitted, duration_ms: run.duration_ms },
    config: c,
    budget: { opening_inventory_budget_cents: c.opening_inventory_budget_cents, opening_inventory_cost_cents: openingCost,
      unused_budget_cents: c.opening_inventory_budget_cents - openingCost, opening_cash_cents: c.opening_cash_cents },
    categories: Object.values(byCat),
    policy_counts: policyCounts,
    products: prods,
    category_labels: CATEGORIES,
  };
}

// 60-day report (parts 1 and 2)

function getReport(runId) {
  const run = getRun(runId);
  if (!run) return null;
  const prods = products(runId);
  const pmap = Object.fromEntries(prods.map((p) => [p.product_id, p]));
  const daily = all("SELECT * FROM daily_summary WHERE run_id = ? ORDER BY day", runId);
  const sum = (k) => daily.reduce((s, d) => s + d[k], 0);
  const last = daily[daily.length - 1];

  const totals = {
    days: daily.length, customers: sum("customers"), walkouts: sum("walkouts"), transactions: sum("transactions"), units: sum("units"),
    revenue_cents: sum("revenue_cents"), cogs_cents: sum("cogs_cents"), gross_profit_cents: sum("gross_profit_cents"),
    write_off_units: sum("write_off_units"), write_off_cents: sum("write_off_cents"),
    replenishment_cents: sum("replenishment_cents"), replenishment_units: sum("replenishment_units"),
    opening_cash_cents: run.config.opening_cash_cents, closing_cash_cents: last.closing_cash_cents,
    opening_inventory_cents: prods.reduce((s, p) => s + p.initial_qty * p.unit_cost_cents, 0),
    closing_inventory_cents: last.closing_inventory_cents, closing_inventory_units: last.closing_inventory_units,
  };
  totals.gross_margin_pct = pct(totals.gross_profit_cents, totals.revenue_cents);
  totals.profit_after_write_off_cents = totals.gross_profit_cents - totals.write_off_cents;
  totals.avg_customers_per_day = r2(totals.customers / totals.days);
  totals.avg_basket_units = r2(totals.units / totals.transactions);
  totals.avg_transaction_cents = Math.round(totals.revenue_cents / totals.transactions);

  // weekday vs weekend
  const group = (rows) => {
    const n = rows.length, tx = rows.reduce((s, d) => s + d.transactions, 0);
    const u = rows.reduce((s, d) => s + d.units, 0), rev = rows.reduce((s, d) => s + d.revenue_cents, 0);
    return { days: n, avg_customers: r2(rows.reduce((s, d) => s + d.customers, 0) / n), avg_revenue_cents: Math.round(rev / n),
      avg_basket_units: r2(u / tx), avg_transaction_cents: Math.round(rev / tx), avg_write_off_cents: Math.round(rows.reduce((s, d) => s + d.write_off_cents, 0) / n) };
  };
  const weekdayWeekend = { weekday: group(daily.filter((d) => !d.is_weekend)), weekend: group(daily.filter((d) => d.is_weekend)) };
  const byWeekday = WEEKDAYS.map((w) => ({ weekday: w, ...group(daily.filter((d) => d.weekday === w)) }));

  // first 3 weeks vs last 3 weeks
  const trend = { first_21: group(daily.filter((d) => d.day <= 21)), last_21: group(daily.filter((d) => d.day > daily.length - 21)) };

  const missions = all(`SELECT mission, COUNT(*) AS transactions, SUM(units) AS units, SUM(total_cents) AS revenue_cents
    FROM transactions WHERE run_id = ? GROUP BY mission ORDER BY revenue_cents DESC`, runId)
    .map((m) => ({ ...m, label: run.config.missions[m.mission]?.label || m.mission, avg_units: r2(m.units / m.transactions),
      avg_transaction_cents: Math.round(m.revenue_cents / m.transactions), revenue_share_pct: pct(m.revenue_cents, totals.revenue_cents) }));

  const hourlyRaw = all(`SELECT v.minute / 60 AS hour, d.is_weekend, COUNT(*) AS visits FROM customer_visits v
    JOIN daily_summary d ON d.run_id = v.run_id AND d.day = v.day WHERE v.run_id = ? GROUP BY hour, d.is_weekend`, runId);
  const wdDays = weekdayWeekend.weekday.days, weDays = weekdayWeekend.weekend.days;
  const hours = [];
  for (let h = run.config.store_hours.open; h < run.config.store_hours.close; h++) {
    const wd = hourlyRaw.find((x) => x.hour === h && !x.is_weekend), we = hourlyRaw.find((x) => x.hour === h && x.is_weekend);
    hours.push({ hour: h, weekday_avg: r2((wd?.visits || 0) / wdDays), weekend_avg: r2((we?.visits || 0) / weDays) });
  }

  // product sales
  const sales = all(`SELECT product_id, SUM(qty) AS units, SUM(line_total_cents) AS revenue_cents, SUM(qty * unit_cost_cents) AS cogs_cents
    FROM transaction_items WHERE run_id = ? GROUP BY product_id`, runId);
  const salesMap = Object.fromEntries(sales.map((s) => [s.product_id, s]));
  const wo = all(`SELECT product_id, SUM(qty) AS units, SUM(value_cents) AS value_cents FROM write_offs WHERE run_id = ? GROUP BY product_id`, runId);
  const woMap = Object.fromEntries(wo.map((s) => [s.product_id, s]));
  const lost = all(`SELECT product_id, SUM(units) AS units, SUM(substituted_units) AS substituted, SUM(CASE WHEN units > 0 THEN 1 ELSE 0 END) AS days
    FROM lost_demand WHERE run_id = ? GROUP BY product_id`, runId);
  const lostMap = Object.fromEntries(lost.map((s) => [s.product_id, s]));
  const closingInv = Object.fromEntries(all("SELECT product_id, closing_qty, closing_value_cents, status, cover_days FROM daily_inventory WHERE run_id = ? AND day = ?", runId, daily.length).map((r) => [r.product_id, r]));

  const productRows = prods.map((p) => {
    const s = salesMap[p.product_id] || { units: 0, revenue_cents: 0, cogs_cents: 0 };
    const w = woMap[p.product_id] || { units: 0, value_cents: 0 };
    const l = lostMap[p.product_id] || { units: 0, substituted: 0, days: 0 };
    const ci = closingInv[p.product_id];
    return { product_id: p.product_id, name: p.name, category: p.category, policy: p.policy, units: s.units, revenue_cents: s.revenue_cents,
      gross_profit_cents: s.revenue_cents - s.cogs_cents, avg_daily_units: r2(s.units / daily.length),
      write_off_units: w.units, write_off_cents: w.value_cents, waste_rate_pct: pct(w.units, w.units + s.units),
      lost_units: l.units, lost_revenue_cents: l.units * p.unit_price_cents, sold_out_days: l.days,
      closing_qty: ci?.closing_qty ?? 0, closing_value_cents: ci?.closing_value_cents ?? 0, closing_cover_days: ci?.cover_days ?? 0 };
  });

  const categories = Object.keys(CATEGORIES).map((k) => {
    const rows = productRows.filter((p) => p.category === k);
    const s = (f) => rows.reduce((a, r) => a + r[f], 0);
    const rev = s("revenue_cents"), gp = s("gross_profit_cents"), w = s("write_off_cents");
    return { category: k, label: CATEGORIES[k], products: rows.length, units: s("units"), revenue_cents: rev, gross_profit_cents: gp,
      gross_margin_pct: pct(gp, rev), write_off_units: s("write_off_units"), write_off_cents: w, profit_after_write_off_cents: gp - w,
      revenue_share_pct: pct(rev, totals.revenue_cents), gp_share_pct: pct(gp, totals.gross_profit_cents),
      lost_units: s("lost_units"), closing_value_cents: s("closing_value_cents") };
  });

  const byRevenue = [...productRows].sort((a, b) => b.revenue_cents - a.revenue_cents);
  const part1 = {
    totals, weekday_weekend: weekdayWeekend, by_weekday: byWeekday, trend, missions, hours,
    daily: daily.map((d) => ({ day: d.day, weekday: d.weekday, is_weekend: d.is_weekend, customers: d.customers, transactions: d.transactions,
      units: d.units, revenue_cents: d.revenue_cents, gross_profit_cents: d.gross_profit_cents, write_off_cents: d.write_off_cents,
      closing_cash_cents: d.closing_cash_cents, closing_inventory_cents: d.closing_inventory_cents })),
    categories, top_products: byRevenue.slice(0, 10),
    weak_products: [...productRows].sort((a, b) => a.units - b.units).slice(0, 10),
  };

  // part 2
  const ev = all("SELECT event_type, COUNT(*) AS n, COUNT(DISTINCT product_id) AS products FROM brain_events WHERE run_id = ? GROUP BY event_type", runId);
  const evCount = (t) => ev.find((e) => e.event_type === t) || { n: 0, products: 0 };
  const orders = all(`SELECT o.trigger, COUNT(*) AS orders, SUM(o.ordered_qty) AS units, SUM(o.total_cents) AS spend_cents,
    SUM(o.cash_constrained) AS constrained FROM replenishment_orders o WHERE o.run_id = ? GROUP BY o.trigger`, runId);
  const ordersByCat = all(`SELECT p.category, COUNT(*) AS orders, SUM(o.ordered_qty) AS units, SUM(o.total_cents) AS spend_cents
    FROM replenishment_orders o JOIN run_products p ON p.run_id = o.run_id AND p.product_id = o.product_id
    WHERE o.run_id = ? GROUP BY p.category`, runId);
  const woByWeekday = WEEKDAYS.map((w) => {
    const r = one(`SELECT COALESCE(SUM(wo.qty),0) AS units, COALESCE(SUM(wo.value_cents),0) AS value_cents FROM write_offs wo
      JOIN daily_summary d ON d.run_id = wo.run_id AND d.day = wo.day WHERE wo.run_id = ? AND d.weekday = ?`, runId, w);
    const so = one(`SELECT COUNT(*) AS n FROM brain_events e JOIN daily_summary d ON d.run_id = e.run_id AND d.day = e.day
      WHERE e.run_id = ? AND e.event_type = 'SOLD_OUT' AND d.weekday = ?`, runId, w);
    return { weekday: w, write_off_units: r.units, write_off_cents: r.value_cents, sold_out_events: so.n };
  });
  // note: write-off day = morning it's removed, so it was unsold the day before

  const stockoutCases = productRows.filter((p) => p.sold_out_days > 0).sort((a, b) => b.lost_units - a.lost_units).slice(0, 6).map((p) => {
    const days = all(`SELECT day FROM brain_events WHERE run_id = ? AND product_id = ? AND event_type = 'SOLD_OUT' ORDER BY day`, runId, p.product_id).map((x) => x.day);
    const nextOrders = all(`SELECT order_day, ordered_qty, trigger FROM replenishment_orders WHERE run_id = ? AND product_id = ? AND trigger = 'SOLD_OUT'`, runId, p.product_id);
    const recoveredNextDay = days.filter((d) => !days.includes(d + 1)).length;
    return { ...p, sold_out_dates: days, sold_out_orders: nextOrders.length, sold_out_order_units: nextOrders.reduce((s, o) => s + o.ordered_qty, 0),
      recovered_next_day: recoveredNextDay };
  });
  const wasteCases = productRows.filter((p) => p.write_off_units > 0).sort((a, b) => b.write_off_cents - a.write_off_cents).slice(0, 6).map((p) => {
    const warn = one(`SELECT COUNT(*) AS n, COALESCE(SUM(json_extract(data_json,'$.units')),0) AS units FROM brain_events WHERE run_id = ? AND product_id = ? AND event_type = 'EXPIRY_WARNING'`, runId, p.product_id);
    const worst = all(`SELECT day, qty, value_cents FROM write_offs WHERE run_id = ? AND product_id = ? ORDER BY qty DESC LIMIT 3`, runId, p.product_id);
    return { ...p, expiry_warnings: warn.n, warned_units: warn.units, worst_days: worst };
  });
  const slow = all(`SELECT e.product_id, MIN(e.day) AS first_flag_day, COUNT(*) AS flags FROM brain_events e WHERE e.run_id = ? AND e.event_type = 'SLOW_MOVING' GROUP BY e.product_id`, runId)
    .map((s) => {
      const p = productRows.find((x) => x.product_id === s.product_id);
      const held = one(`SELECT COUNT(*) AS n FROM daily_inventory WHERE run_id = ? AND product_id = ? AND status = 'SLOW_MOVING'`, runId, s.product_id).n;
      const first = one(`SELECT message FROM brain_events WHERE run_id = ? AND product_id = ? AND event_type = 'SLOW_MOVING' ORDER BY day LIMIT 1`, runId, s.product_id);
      return { ...p, ...s, days_flagged: held, first_message: first.message };
    });

  const part2 = {
    inventory_health: {
      sold_out_events: evCount("SOLD_OUT").n, sold_out_products: evCount("SOLD_OUT").products,
      low_stock_events: evCount("LOW_STOCK").n, low_stock_products: evCount("LOW_STOCK").products,
      lost_units: productRows.reduce((s, p) => s + p.lost_units, 0), lost_revenue_cents: productRows.reduce((s, p) => s + p.lost_revenue_cents, 0),
      substituted_units: lost.reduce((s, l) => s + l.substituted, 0),
      write_off_units: totals.write_off_units, write_off_cents: totals.write_off_cents,
      slow_moving_products: slow.length,
      closing_inventory_units: totals.closing_inventory_units, closing_inventory_cents: totals.closing_inventory_cents,
    },
    write_off_by_product: productRows.filter((p) => p.write_off_units > 0).sort((a, b) => b.write_off_cents - a.write_off_cents),
    write_off_by_category: categories.map((c) => ({ category: c.category, label: c.label, units: c.write_off_units, value_cents: c.write_off_cents })),
    write_off_by_weekday: woByWeekday,
    stockouts_by_product: productRows.filter((p) => p.sold_out_days > 0).sort((a, b) => b.lost_units - a.lost_units),
    slow_moving: slow,
    replenishment: { by_trigger: orders, by_category: ordersByCat.map((o) => ({ ...o, label: CATEGORIES[o.category] })),
      total_orders: orders.reduce((s, o) => s + o.orders, 0), total_units: totals.replenishment_units, total_spend_cents: totals.replenishment_cents,
      cash_constrained_orders: evCount("CASH_CONSTRAINED").n },
    closing_inventory_by_category: categories.map((c) => ({ category: c.category, label: c.label, value_cents: c.closing_value_cents })),
    brain: {
      events: ["SOLD_OUT", "LOW_STOCK", "EXPIRY_WARNING", "EXPIRY_WRITE_OFF", "SLOW_MOVING", "SLOW_MOVING_CLEARED", "CASH_CONSTRAINED", "REPLENISHMENT", "FINAL_DAY"]
        .map((t) => ({ event_type: t, count: evCount(t).n, products: evCount(t).products })),
      stockout_cases: stockoutCases, waste_cases: wasteCases,
    },
  };

  return { run: { run_id: run.run_id, is_submitted: run.is_submitted, created_at: run.created_at, seed: run.seed }, part1, part2, products: productRows };
}

// part 3 findings

const $ = (c) => "$" + (c / 100).toLocaleString("en-AU", Math.abs(c) < 10000 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });

function getFindings(runId) {
  const rep = getReport(runId);
  if (!rep) return null;
  const { part1: p1, part2: p2 } = rep;
  const t = p1.totals;
  const findings = [];

  // F1: daily-fresh waste
  const waste = p2.write_off_by_product[0];
  if (waste) {
    const woW = p2.write_off_by_weekday;
    const peak = [...woW].sort((a, b) => b.write_off_cents - a.write_off_cents).slice(0, 2);
    const readyCat = p1.categories.find((c) => c.category === "READY");
    const wasteShare = pct(waste.write_off_cents, t.write_off_cents);
    const so = p2.stockouts_by_product.find((s) => s.product_id === waste.product_id);
    const wd = p1.weekday_weekend;
    const worstDay = p2.brain.waste_cases.find((c) => c.product_id === waste.product_id)?.worst_days?.[0];
    findings.push({
      id: "F1", title: `${waste.name} waste is the store's largest controllable loss`, kind: "Problem",
      observation: `Expiry write-offs totalled ${$(t.write_off_cents)} (${t.write_off_units} units) over 60 days. ${waste.name} alone accounts for ${wasteShare}% of that value: ${waste.write_off_units} units written off against ${waste.units} sold, a waste rate of ${waste.waste_rate_pct}%.`,
      evidence: [
        `Write-off value is highest on ${peak.map((p) => `${p.weekday} (${$(p.write_off_cents)})`).join(" and ")}. Stock removed on a given morning was left unsold the previous day.`,
        `Weekend days average ${Math.round(wd.weekend.avg_customers)} customers vs ${Math.round(wd.weekday.avg_customers)} on weekdays, and lunch is mainly a weekday office mission.`,
        so ? `The same product sold out on ${so.sold_out_days} day(s), losing ${so.lost_units} units of demand (about ${$(so.lost_revenue_cents)} revenue).` : `The product did not sell out during the run.`,
        worstDay ? `Largest single write-off: ${worstDay.qty} units on Day ${worstDay.day}.` : null,
      ].filter(Boolean),
      links: [{ type: "product", id: waste.product_id, label: `Trace ${waste.name}` }, worstDay ? { type: "day", id: worstDay.day, label: `Daily Report Day ${worstDay.day}` } : null].filter(Boolean),
      diagnosis: `The Store Brain orders daily-fresh items from a trailing 7-day average. That average blends busy weekday lunches with quiet weekends, so it over-orders before Saturday and Sunday and under-orders early in the week once the weekend lowers the average. With a ${rep.products.find((p) => p.product_id === waste.product_id).policy === "DAILY_FRESH" ? "one- or two-day" : "short"} shelf life, any over-order is written off the next morning.`,
      implication: `Waste on this one product equals ${pct(waste.write_off_cents, readyCat.gross_profit_cents)}% of Ready-to-Eat gross profit, while the stockouts lose sales on the store's highest-margin category. Both are caused by the same rule, so fixing it should improve margin and availability together.`,
      recommendation: `Change the daily-fresh rule to forecast from the same weekday in previous weeks (or apply a weekend factor), and order sushi in smaller packs or run a reduced weekend range. Validate with a new run, and later with real point-of-sale data.`,
      limitation: `The weekday/weekend demand gap is a model assumption about CBD office trade; the size of the saving depends on real weekend demand.`,
    });
  }

  // F2: weekday vs weekend trade
  const ranked = [...p1.categories].sort((a, b) => b.gross_profit_cents - a.gross_profit_cents);
  const topTwo = ranked.slice(0, 2);
  const ready = p1.categories.find((c) => c.category === "READY");
  const drinks = p1.categories.find((c) => c.category === "DRINKS");
  const lunch = p1.missions.find((m) => m.mission === "LUNCH");
  const stockUp = p1.missions.find((m) => m.mission === "STOCK_UP");
  const wd = p1.weekday_weekend;
  const weekendGap = pct(wd.weekday.avg_revenue_cents - wd.weekend.avg_revenue_cents, wd.weekday.avg_revenue_cents);
  const custGap = pct(wd.weekday.avg_customers - wd.weekend.avg_customers, wd.weekday.avg_customers);
  findings.push({
    id: "F2", title: "Weekday office trade drives volume; weekends rely on fewer, larger baskets", kind: "Opportunity / risk",
    observation: `Weekends bring ${custGap}% fewer customers than weekdays (${Math.round(wd.weekend.avg_customers)} vs ${Math.round(wd.weekday.avg_customers)} a day) but only ${weekendGap}% less revenue, because weekend baskets are larger (${wd.weekend.avg_basket_units} vs ${wd.weekday.avg_basket_units} items). The two biggest profit categories are ${topTwo[0].label} (${topTwo[0].gp_share_pct}% of gross profit) and ${topTwo[1].label} (${topTwo[1].gp_share_pct}%).`,
    evidence: [
      `Average daily revenue: weekdays ${$(wd.weekday.avg_revenue_cents)}, weekends ${$(wd.weekend.avg_revenue_cents)}. Average sale: weekdays ${$(wd.weekday.avg_transaction_cents)}, weekends ${$(wd.weekend.avg_transaction_cents)}.`,
      lunch ? `Lunch-meal shoppers made ${lunch.transactions.toLocaleString()} transactions (${lunch.revenue_share_pct}% of revenue).` : null,
      stockUp ? `Resident stock-up shoppers made ${stockUp.transactions.toLocaleString()} transactions averaging ${stockUp.avg_units} items and ${$(stockUp.avg_transaction_cents)} (${stockUp.revenue_share_pct}% of revenue).` : null,
      `Gross margin: ${ready.label} ${ready.gross_margin_pct}%, ${drinks.label} ${drinks.gross_margin_pct}%, store overall ${t.gross_margin_pct}%.`,
      `Traffic grew from ${Math.round(p1.trend.first_21.avg_customers)} customers/day in the first three weeks to ${Math.round(p1.trend.last_21.avg_customers)} in the last three weeks (new-store ramp-up).`,
    ].filter(Boolean),
    links: [{ type: "section", id: "categories", label: "Category performance" }, { type: "section", id: "weekday", label: "Weekday vs weekend" }],
    diagnosis: `The two halves of the week serve different shoppers. Weekdays are high-traffic, small-basket office trade (breakfast, lunch, snacks) where ready-to-eat and drinks earn the highest margins. Weekends are lower-traffic resident trade with bigger top-up and stock-up baskets weighted towards dairy, pantry and fresh lines.`,
    implication: `Weekday lunch availability carries much of the store's margin, so a disruption to office trade (hybrid work, a nearby competitor, lunch stockouts) hits profit hardest. Weekend revenue depends on residents finding a full range of grocery staples, not on the weekday food-to-go range.`,
    recommendation: `Run the store as two operating profiles: prioritise ready-to-eat and drinks availability for weekday 7-10am and 11am-2pm peaks, and shift weekend replenishment towards grocery staples and larger packs while cutting weekend ready-to-eat depth (see F1).`,
    limitation: `Customer volumes, mission mix and the weekday/weekend split are modelling assumptions; real foot-traffic and basket data are needed before sizing this.`,
  });

  // F3: opening stock vs what the brain needs
  const model = getModel(runId);
  const invByCat = model.categories.map((c) => {
    const close = p2.closing_inventory_by_category.find((x) => x.category === c.category);
    return { label: c.label, opening: c.opening_cost_cents, closing: close ? close.value_cents : 0 };
  }).map((c) => ({ ...c, drop: c.opening - c.closing })).sort((a, b) => b.drop - a.drop);
  const invDrop = t.opening_inventory_cents - t.closing_inventory_cents;
  const prodsAll = model.products;
  const overCovered = prodsAll.filter((p) => p.policy === "AMBIENT" && p.planning_daily_demand > 0 && p.initial_qty / p.planning_daily_demand > 14);
  const slowValue = p2.slow_moving.reduce((s, x) => s + x.closing_value_cents, 0);
  const half = Math.floor(t.days / 2);
  const so1 = one("SELECT COUNT(*) n FROM brain_events WHERE run_id = ? AND event_type = 'SOLD_OUT' AND day <= ?", runId, half).n;
  const so2 = one("SELECT COUNT(*) n FROM brain_events WHERE run_id = ? AND event_type = 'SOLD_OUT' AND day > ?", runId, half).n;
  const soAmbient = one(`SELECT COUNT(*) n FROM brain_events e JOIN run_products p ON p.run_id = e.run_id AND p.product_id = e.product_id
    WHERE e.run_id = ? AND e.event_type = 'SOLD_OUT' AND p.policy = 'AMBIENT'`, runId).n;
  findings.push({
    id: "F3", title: "The opening stock investment was larger than the Store Brain needs; cash never limited ordering", kind: "Trade-off",
    observation: `Opening inventory cost ${$(t.opening_inventory_cents)}. Once the Store Brain's reorder rules took over, the store traded with ${$(t.closing_inventory_cents)} of stock on Day 60, ${$(invDrop)} (${pct(invDrop, t.opening_inventory_cents)}%) less. Sold-out events: ${so1} in Days 1-${half} and ${so2} in Days ${half + 1}-${t.days}; shelf-stable products sold out ${soAmbient} time(s) in total. Operating cash rose from ${$(t.opening_cash_cents)} to ${$(t.closing_cash_cents)}, and ${p2.replenishment.cash_constrained_orders} order(s) were limited by cash.`,
    evidence: [
      `Largest inventory reductions by category: ${invByCat.slice(0, 3).map((c) => `${c.label} ${$(c.opening)} to ${$(c.closing)}`).join("; ")}.`,
      `${overCovered.length} shelf-stable products opened with more than two weeks of expected demand, mostly because of the 24-unit minimum display rule.`,
      `${p2.slow_moving.length} product(s) were flagged slow-moving (${p2.slow_moving.map((s) => s.name).join(", ") || "none"}); the Brain held replenishment until sales caught up, leaving ${$(slowValue)} of that stock at Day 60.`,
      `${p2.replenishment.total_orders.toLocaleString()} replenishment orders cost ${$(t.replenishment_cents)}, all funded from sales.`,
    ],
    links: p2.slow_moving.slice(0, 2).map((s) => ({ type: "product", id: s.product_id, label: `Trace ${s.name}` })).concat([{ type: "section", id: "replenishment", label: "Replenishment and closing stock" }]),
    diagnosis: `The opening plan stocked 10 days of cover with a full-shelf minimum, while the Brain replenishes to 3-9 days. The difference is capital that the running store did not need. The Brain's slow-moving rule worked as intended: it stopped re-ordering overstocked lines instead of compounding the error.`,
    implication: `Roughly ${$(invDrop)} of the A$40,000 opening budget could be held back or redirected. The rising cash balance is not profit: rent, monitoring staff, utilities and hardware are outside the model, so the cash result only shows that stock purchasing is self-funding.`,
    recommendation: `Plan opening stock from the same cover targets the Brain uses (about one week), cap occasional-use lines at two weeks of cover, and add operating costs to the next model version before using cash to judge store viability.`,
    limitation: `Operating costs are outside the client's model boundary, and supplier minimum orders or delivery fees (which would raise the cost of holding less stock) are not modelled.`,
  });

  return { run_id: runId, findings };
}

// daily report

function getDaily(runId, day) {
  const run = getRun(runId);
  if (!run) return null;
  const summary = one("SELECT * FROM daily_summary WHERE run_id = ? AND day = ?", runId, day);
  if (!summary) return null;
  const pmap = Object.fromEntries(products(runId).map((p) => [p.product_id, p]));
  const name = (pid) => pmap[pid]?.name;

  const inventory = all("SELECT * FROM daily_inventory WHERE run_id = ? AND day = ? ORDER BY product_id", runId, day)
    .map((r) => ({ ...r, name: name(r.product_id), category: pmap[r.product_id].category }));
  const events = all("SELECT * FROM brain_events WHERE run_id = ? AND day = ? ORDER BY event_id", runId, day)
    .map((e) => ({ ...e, name: e.product_id ? name(e.product_id) : null }));
  const orders = all("SELECT * FROM replenishment_orders WHERE run_id = ? AND order_day = ? ORDER BY order_id", runId, day).map((o) => ({ ...o, name: name(o.product_id) }));
  const receipts = all("SELECT * FROM batches WHERE run_id = ? AND received_day = ? AND source = 'REPLENISHMENT' ORDER BY batch_id", runId, day).map((b) => ({ ...b, name: name(b.product_id) }));
  const writeOffs = all("SELECT * FROM write_offs WHERE run_id = ? AND day = ?", runId, day).map((w) => ({ ...w, name: name(w.product_id) }));
  const hourly = all(`SELECT minute / 60 AS hour, COUNT(*) AS visits, SUM(CASE WHEN outcome='WALKED_OUT' THEN 1 ELSE 0 END) AS walkouts
    FROM customer_visits WHERE run_id = ? AND day = ? GROUP BY hour ORDER BY hour`, runId, day);
  const missions = all(`SELECT mission, COUNT(*) AS transactions, SUM(units) AS units, SUM(total_cents) AS revenue_cents
    FROM transactions WHERE run_id = ? AND day = ? GROUP BY mission ORDER BY transactions DESC`, runId, day)
    .map((m) => ({ ...m, label: run.config.missions[m.mission]?.label || m.mission }));
  const categories = all(`SELECT p.category, SUM(i.qty) AS units, SUM(i.line_total_cents) AS revenue_cents
    FROM transaction_items i JOIN transactions t ON t.run_id = i.run_id AND t.transaction_id = i.transaction_id
    JOIN run_products p ON p.run_id = i.run_id AND p.product_id = i.product_id
    WHERE i.run_id = ? AND t.day = ? GROUP BY p.category ORDER BY revenue_cents DESC`, runId, day).map((c) => ({ ...c, label: CATEGORIES[c.category] }));
  const transactions = all("SELECT transaction_id, minute, mission, item_count, units, total_cents FROM transactions WHERE run_id = ? AND day = ? ORDER BY minute, transaction_id", runId, day);
  const txSum = transactions.reduce((s, t) => s + t.total_cents, 0);

  return {
    run_id: runId, day, days: run.days, summary, inventory, events, orders, receipts, write_offs: writeOffs, hourly, missions, categories, transactions,
    checks: {
      revenue_matches_transactions: txSum === summary.revenue_cents, transactions_total_cents: txSum,
      cash_balances: summary.opening_cash_cents + summary.revenue_cents - summary.replenishment_cents === summary.closing_cash_cents,
      inventory_rows_balance: inventory.every((r) => r.opening_qty + r.received_qty - r.expired_qty - r.sold_qty === r.closing_qty),
    },
  };
}

function getTransaction(runId, txId) {
  const tx = one("SELECT * FROM transactions WHERE run_id = ? AND transaction_id = ?", runId, txId);
  if (!tx) return null;
  const items = all(`SELECT i.*, p.name FROM transaction_items i JOIN run_products p ON p.run_id = i.run_id AND p.product_id = i.product_id
    WHERE i.run_id = ? AND i.transaction_id = ? ORDER BY line_no`, runId, txId);
  return { ...tx, items };
}

// product trace

function getProduct(runId, pid) {
  const p = one("SELECT * FROM run_products WHERE run_id = ? AND product_id = ?", runId, pid);
  if (!p) return null;
  const daily = all("SELECT * FROM daily_inventory WHERE run_id = ? AND product_id = ? ORDER BY day", runId, pid);
  const events = all("SELECT * FROM brain_events WHERE run_id = ? AND product_id = ? ORDER BY event_id", runId, pid);
  const orders = all("SELECT * FROM replenishment_orders WHERE run_id = ? AND product_id = ? ORDER BY order_id", runId, pid);
  const batches = all(`SELECT b.*, COALESCE((SELECT SUM(qty) FROM sale_allocations a WHERE a.run_id = b.run_id AND a.batch_id = b.batch_id),0) AS sold,
      COALESCE((SELECT SUM(qty) FROM write_offs w WHERE w.run_id = b.run_id AND w.batch_id = b.batch_id),0) AS written_off
    FROM batches b WHERE b.run_id = ? AND b.product_id = ? ORDER BY b.received_day, b.batch_id`, runId, pid);
  const s = one(`SELECT COALESCE(SUM(qty),0) AS units, COALESCE(SUM(line_total_cents),0) AS revenue_cents FROM transaction_items WHERE run_id = ? AND product_id = ?`, runId, pid);
  const received = batches.filter((b) => b.source === "REPLENISHMENT").reduce((a, b) => a + b.qty, 0);
  const expired = batches.reduce((a, b) => a + b.written_off, 0);
  const closing = daily.length ? daily[daily.length - 1].closing_qty : 0;
  return {
    product: p, daily, events, orders, batches,
    totals: { opening: p.initial_qty, received, sold: s.units, expired, closing, revenue_cents: s.revenue_cents,
      reconciles: p.initial_qty + received - s.units - expired === closing },
  };
}

module.exports = { listRuns, getRun, getModel, getReport, getFindings, getDaily, getTransaction, getProduct };
