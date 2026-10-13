// 60-day simulation
// each day: receive orders -> remove expired -> customers shop -> brain reorders at close

const { makeRng } = require("./rng");
const { WEEKDAYS, policyFor } = require("./model");

const pad = (n, w) => String(n).padStart(w, "0");

// customers and demand

function customerCount(rng, cfg, day) {
  const c = cfg.customers;
  const wd = (cfg.start_weekday + day - 1) % 7;
  const ramp = Math.min(1, c.ramp.start_factor + ((1 - c.ramp.start_factor) * (day - 1)) / (c.ramp.full_by_day - 1));
  const noise = 1 + c.daily_noise_sd * rng.normal();
  return { wd, ramp, count: Math.max(0, Math.round(c.base_by_weekday[wd] * ramp * noise)) };
}

function visitTimes(rng, cfg, isWeekend, count) {
  const weights = cfg.customers.hourly_weights[isWeekend ? "weekend" : "weekday"];
  const hourMap = {};
  weights.forEach((w, i) => (hourMap[cfg.store_hours.open + i] = w));
  const mins = [];
  for (let i = 0; i < count; i++) {
    const h = Number(rng.weighted(hourMap));
    mins.push(h * 60 + rng.int(0, 59));
  }
  return mins.sort((a, b) => a - b);
}

function missionFor(rng, cfg, isWeekend, minute) {
  const hour = Math.floor(minute / 60);
  const bands = cfg.mission_mix[isWeekend ? "weekend" : "weekday"];
  const band = bands.find((b) => hour >= b.from && hour < b.to) || bands[bands.length - 1];
  return rng.weighted(band.mix);
}

// popularity x tag boost
function buildChoiceWeights(products, cfg) {
  const out = {};
  for (const [m, def] of Object.entries(cfg.missions)) {
    out[m] = {};
    for (const cat of Object.keys(def.categories)) {
      out[m][cat] = {};
      for (const p of products.filter((x) => x.category === cat)) {
        const boost = def.boost_tag && p.tags.includes(def.boost_tag) ? cfg.tag_boost : 1;
        out[m][cat][p.product_id] = p.popularity * boost;
      }
    }
  }
  return out;
}

function lineCount(rng, [min, max]) {
  // skewed towards smaller baskets
  return min + Math.floor(Math.pow(rng.next(), 1.6) * (max - min + 1));
}


function simulate({ products, config: cfg, seed }) {
  const rng = makeRng(seed);
  const brain = cfg.brain;
  const days = cfg.days;
  const byId = Object.fromEntries(products.map((p) => [p.product_id, p]));
  const weights = buildChoiceWeights(products, cfg);
  const policy = Object.fromEntries(products.map((p) => [p.product_id, policyFor(p, brain)]));

  const rec = {
    visits: [], transactions: [], items: [], lost: [], batches: [], allocations: [],
    writeOffs: [], orders: [], dailyInventory: [], events: [], daily: [],
  };
  let eventSeq = 0;
  const event = (day, phase, product_id, type, severity, message, action, data) =>
    rec.events.push({ event_id: ++eventSeq, day, phase, product_id, event_type: type, severity, message, action, data_json: JSON.stringify(data || {}) });

  // running state while simulating
  const stock = {}; // product_id -> [batch objects with .remaining]
  const salesHist = {}; // product_id -> array indexed by day
  const soldOutHist = {};
  const slowState = {};
  for (const p of products) { stock[p.product_id] = []; salesHist[p.product_id] = []; soldOutHist[p.product_id] = []; slowState[p.product_id] = false; }

  const addBatch = (b) => { rec.batches.push({ ...b }); stock[b.product_id].push({ ...b, remaining: b.qty }); };
  const onHand = (pid) => stock[pid].reduce((s, b) => s + b.remaining, 0);

  // opening stock arrives before day 1
  for (const p of products) {
    if (p.initial_qty > 0) addBatch({
      batch_id: `B-OPEN-${p.product_id}`, product_id: p.product_id, source: "OPENING", order_id: null,
      received_day: 1, expiry_day: p.perishable ? 1 + p.shelf_life_days : null, qty: p.initial_qty, unit_cost_cents: p.cost_cents,
    });
  }

  let cash = cfg.opening_cash_cents;
  let pending = []; // orders placed yesterday, arrive this morning
  let prevClosing = Object.fromEntries(products.map((p) => [p.product_id, p.initial_qty]));

  for (let day = 1; day <= days; day++) {
    const { wd, ramp, count } = customerCount(rng, cfg, day);
    const isWeekend = wd >= 5;
    const openingCash = cash;
    const dayInv = {};
    for (const p of products) dayInv[p.product_id] = { opening: prevClosing[p.product_id], received: 0, expired: 0, sold: 0, lost: 0, substituted: 0 };

    // 1. receive last night's orders
    for (const o of pending) {
      const p = byId[o.product_id];
      addBatch({ batch_id: `B-${o.order_id}`, product_id: o.product_id, source: "REPLENISHMENT", order_id: o.order_id,
        received_day: day, expiry_day: p.perishable ? day + p.shelf_life_days : null, qty: o.ordered_qty, unit_cost_cents: o.unit_cost_cents });
      dayInv[o.product_id].received += o.ordered_qty;
    }
    pending = [];

    // 2. remove expired stock
    let woUnits = 0, woCents = 0;
    for (const p of products) {
      let units = 0, value = 0;
      for (const b of stock[p.product_id]) {
        if (b.expiry_day !== null && b.expiry_day <= day && b.remaining > 0) {
          rec.writeOffs.push({ day, product_id: p.product_id, batch_id: b.batch_id, qty: b.remaining, value_cents: b.remaining * b.unit_cost_cents, reason: "EXPIRED" });
          units += b.remaining; value += b.remaining * b.unit_cost_cents;
          b.remaining = 0;
        }
      }
      stock[p.product_id] = stock[p.product_id].filter((b) => b.remaining > 0);
      if (units > 0) {
        dayInv[p.product_id].expired = units;
        woUnits += units; woCents += value;
        event(day, "OPEN", p.product_id, "EXPIRY_WRITE_OFF", "MEDIUM",
          `${units} unit(s) reached expiry and were removed from sale before opening (cost $${(value / 100).toFixed(2)}).`,
          "Removed from sale and written off", { units, value_cents: value });
      }
    }

    // 3. customers shop
    const allocToday = {}; // batch_id -> qty
    const take = (pid, qty) => { // FIFO: oldest expiry first
      const batches = stock[pid].slice().sort((a, b) => (a.expiry_day ?? 1e9) - (b.expiry_day ?? 1e9) || a.received_day - b.received_day);
      let left = qty;
      for (const b of batches) {
        if (left === 0) break;
        const n = Math.min(left, b.remaining);
        b.remaining -= n; left -= n;
        allocToday[b.batch_id] = (allocToday[b.batch_id] || { product_id: pid, qty: 0 });
        allocToday[b.batch_id].qty += n;
      }
      stock[pid] = stock[pid].filter((b) => b.remaining > 0);
    };

    const minutes = visitTimes(rng, cfg, isWeekend, count);
    let txSeq = 0, revenue = 0, cogs = 0, units = 0, walkouts = 0;
    minutes.forEach((minute, i) => {
      const visit_no = i + 1;
      const mission = missionFor(rng, cfg, isWeekend, minute);
      const def = cfg.missions[mission];
      const basket = new Map();
      const n = lineCount(rng, def.lines);
      for (let l = 0; l < n; l++) {
        const cat = rng.weighted(def.categories);
        const pid = rng.weighted(weights[mission][cat]);
        const want = rng.next() < def.multi_unit_p ? 2 : 1;
        const avail = onHand(pid) - (basket.get(pid) || 0);
        const got = Math.max(0, Math.min(want, avail));
        if (got > 0) basket.set(pid, (basket.get(pid) || 0) + got);
        if (got < want) {
          dayInv[pid].lost += want - got;
          if (got === 0 && rng.next() < cfg.substitution_p) {
            const alts = {};
            for (const [alt, w] of Object.entries(weights[mission][cat])) {
              if (alt !== pid && onHand(alt) - (basket.get(alt) || 0) > 0) alts[alt] = w;
            }
            if (Object.keys(alts).length) {
              const s = rng.weighted(alts);
              basket.set(s, (basket.get(s) || 0) + 1);
              dayInv[pid].substituted += 1;
            }
          }
        }
      }
      if (basket.size === 0) {
        walkouts++;
        rec.visits.push({ day, visit_no, minute, mission, outcome: "WALKED_OUT", transaction_id: null });
        return;
      }
      const transaction_id = `D${pad(day, 2)}-T${pad(++txSeq, 4)}`;
      let total = 0, cost = 0, u = 0, line_no = 0;
      for (const [pid, qty] of basket) {
        const p = byId[pid];
        take(pid, qty);
        dayInv[pid].sold += qty;
        const line = qty * p.price_cents;
        rec.items.push({ transaction_id, line_no: ++line_no, product_id: pid, qty, unit_price_cents: p.price_cents, unit_cost_cents: p.cost_cents, line_total_cents: line });
        total += line; cost += qty * p.cost_cents; u += qty;
      }
      rec.transactions.push({ transaction_id, day, minute, visit_no, mission, item_count: basket.size, units: u, total_cents: total, cost_cents: cost });
      rec.visits.push({ day, visit_no, minute, mission, outcome: "PURCHASED", transaction_id });
      revenue += total; cogs += cost; units += u;
    });
    for (const [batch_id, a] of Object.entries(allocToday)) rec.allocations.push({ day, product_id: a.product_id, batch_id, qty: a.qty });
    cash += revenue;

    // 4. store brain checks each product and orders
    const candidates = [];
    let soldOutCount = 0, lowCount = 0;
    const statusOf = {};
    for (const p of products) {
      const pid = p.product_id;
      const inv = dayInv[pid];
      salesHist[pid][day] = inv.sold;
      const closing = onHand(pid);
      soldOutHist[pid][day] = closing === 0;

      const from = Math.max(1, day - brain.forecast_window_days + 1);
      let sum = 0, soldOutInWindow = false;
      for (let d = from; d <= day; d++) { sum += salesHist[pid][d]; if (soldOutHist[pid][d]) soldOutInWindow = true; }
      let forecast = sum / (day - from + 1);
      if (soldOutInWindow) forecast *= brain.sold_out_uplift;

      const pol = policy[pid];
      const rules = brain.policies[pol];
      const expTomorrow = stock[pid].filter((b) => b.expiry_day === day + 1).reduce((s, b) => s + b.remaining, 0);
      const effective = closing - expTomorrow; // stock still sellable tomorrow
      const cover = forecast > 0 ? effective / forecast : effective > 0 ? 999 : 0;
      let targetDays = rules.target_days;
      if (pol === "SHORT_LIFE") targetDays = Math.min(targetDays, p.shelf_life_days - 1);
      const target = forecast * targetDays;
      const reorderPoint = rules.reorder_point_days === null ? null : forecast * rules.reorder_point_days;

      let status = "OK";
      if (closing === 0) status = "SOLD_OUT";
      else if (pol !== "DAILY_FRESH" && effective <= reorderPoint) status = "LOW_STOCK";
      else if ((pol === "AMBIENT" || pol === "LONG_LIFE") && day >= brain.slow_moving.from_day &&
        (cover > brain.slow_moving.cover_days_over || sum === 0)) status = "SLOW_MOVING";
      statusOf[pid] = status;

      if (expTomorrow > 0) {
        event(day, "CLOSE", pid, "EXPIRY_WARNING", "LOW",
          `${expTomorrow} unit(s) expire before tomorrow's opening (cost $${((expTomorrow * p.cost_cents) / 100).toFixed(2)}).`,
          "Excluded from sellable stock in tonight's reorder calculation", { units: expTomorrow, value_cents: expTomorrow * p.cost_cents });
      }
      if (status === "SOLD_OUT") {
        soldOutCount++;
        event(day, "CLOSE", pid, "SOLD_OUT", "HIGH",
          `Sold out at close. Unmet demand today: ${inv.lost} unit(s), ${inv.substituted} switched to another product.`,
          day < days ? "Replenishment requested (see orders)" : "No order: final day of horizon",
          { lost_units: inv.lost, substituted: inv.substituted, forecast: +forecast.toFixed(2) });
      } else if (status === "LOW_STOCK") {
        lowCount++;
        event(day, "CLOSE", pid, "LOW_STOCK", "MEDIUM",
          `Sellable stock ${effective} is at or below reorder point ${reorderPoint.toFixed(1)} (${cover.toFixed(1)} days of cover).`,
          day < days ? "Replenishment requested (see orders)" : "No order: final day of horizon",
          { effective, reorder_point: +reorderPoint.toFixed(2), cover_days: +cover.toFixed(2) });
      }
      if (status === "SLOW_MOVING" && !slowState[pid]) {
        event(day, "CLOSE", pid, "SLOW_MOVING", "MEDIUM",
          `Stock of ${closing} covers ${cover >= 999 ? "no recent sales" : cover.toFixed(0) + " days"} at the 7-day sales rate (threshold ${brain.slow_moving.cover_days_over} days).`,
          "Replenishment held; flagged to manager for markdown or range review", { closing, cover_days: +Math.min(cover, 999).toFixed(1), stock_value_cents: closing * p.cost_cents });
      } else if (status !== "SLOW_MOVING" && slowState[pid]) {
        event(day, "CLOSE", pid, "SLOW_MOVING_CLEARED", "LOW", `Stock cover back under ${brain.slow_moving.cover_days_over} days.`, "Normal replenishment rules resume", { cover_days: +cover.toFixed(1) });
      }
      slowState[pid] = status === "SLOW_MOVING";

      const wantsOrder = status === "SOLD_OUT" || status === "LOW_STOCK" || pol === "DAILY_FRESH";
      if (day < days && wantsOrder) {
        const need = Math.ceil(target - effective);
        if (need > 0) {
          const qty = Math.ceil(need / p.case_pack) * p.case_pack;
          const trigger = status === "SOLD_OUT" ? "SOLD_OUT" : status === "LOW_STOCK" ? "LOW_STOCK" : "DAILY_FRESH";
          candidates.push({ p, trigger, qty, forecast, effective, target, gp: forecast * (p.price_cents - p.cost_cents) });
        }
      }

      rec.dailyInventory.push({ day, product_id: pid, opening_qty: inv.opening, received_qty: inv.received, expired_qty: inv.expired,
        sold_qty: inv.sold, closing_qty: closing, closing_value_cents: stock[pid].reduce((s, b) => s + b.remaining * b.unit_cost_cents, 0),
        status, policy: pol, forecast_units: +forecast.toFixed(2), cover_days: +Math.min(cover, 999).toFixed(1), lost_units: inv.lost, substituted_units: inv.substituted });
      if (inv.lost > 0 || inv.substituted > 0) rec.lost.push({ day, product_id: pid, units: inv.lost, substituted_units: inv.substituted });
      prevClosing[pid] = closing;
    }

    // pay for orders in priority order, never more than the cash we have
    const rank = Object.fromEntries(brain.order_priority.map((t, i) => [t, i]));
    candidates.sort((a, b) => rank[a.trigger] - rank[b.trigger] || b.gp - a.gp);
    let orderSeq = 0, spend = 0, orderedUnits = 0, constrained = 0;
    const cashBeforeOrders = cash;
    for (const c of candidates) {
      const caseCost = c.p.case_pack * c.p.cost_cents;
      let qty = c.qty;
      if (qty * c.p.cost_cents > cash) {
        qty = Math.floor(cash / caseCost) * c.p.case_pack;
        constrained++;
        event(day, "CLOSE", c.p.product_id, "CASH_CONSTRAINED", "HIGH",
          `Requested ${c.qty} unit(s) but only $${(cash / 100).toFixed(2)} cash remained.`,
          qty > 0 ? `Order reduced to ${qty} unit(s)` : "Order skipped", { requested: c.qty, ordered: qty, cash_cents: cash });
        if (qty === 0) continue;
      }
      const total = qty * c.p.cost_cents;
      const order = { order_id: `O${pad(day, 2)}-${pad(++orderSeq, 3)}`, order_day: day, arrival_day: day + 1, product_id: c.p.product_id,
        trigger: c.trigger, forecast_units: +c.forecast.toFixed(2), stock_position: c.effective, target_qty: +c.target.toFixed(2),
        requested_qty: c.qty, ordered_qty: qty, unit_cost_cents: c.p.cost_cents, total_cents: total,
        cash_before_cents: cash, cash_after_cents: cash - total, cash_constrained: qty < c.qty ? 1 : 0 };
      cash -= total; spend += total; orderedUnits += qty;
      rec.orders.push(order);
      pending.push(order);
    }
    if (day < days) {
      event(day, "CLOSE", null, "REPLENISHMENT", "INFO",
        `Placed ${orderSeq} order(s): ${orderedUnits} units costing $${(spend / 100).toFixed(2)}. Cash $${(cashBeforeOrders / 100).toFixed(2)} -> $${(cash / 100).toFixed(2)}.`,
        constrained ? `${constrained} order(s) limited by cash` : "All requested orders funded", { orders: orderSeq, units: orderedUnits, spend_cents: spend, constrained });
    } else {
      event(day, "CLOSE", null, "FINAL_DAY", "INFO",
        `End of 60-day horizon: no orders placed after the close of Day ${days}. ${soldOutCount} product(s) sold out and ${lowCount} low at close.`,
        "Closing conditions reported only", { sold_out: soldOutCount, low_stock: lowCount });
    }

    let invUnits = 0, invCents = 0;
    for (const p of products) for (const b of stock[p.product_id]) { invUnits += b.remaining; invCents += b.remaining * b.unit_cost_cents; }
    rec.daily.push({ day, weekday: WEEKDAYS[wd], is_weekend: isWeekend ? 1 : 0, traffic_ramp: +ramp.toFixed(3), customers: count, walkouts,
      transactions: txSeq, units, revenue_cents: revenue, cogs_cents: cogs, gross_profit_cents: revenue - cogs,
      write_off_units: woUnits, write_off_cents: woCents,
      received_units: Object.values(dayInv).reduce((s, x) => s + x.received, 0),
      replenishment_orders: orderSeq, replenishment_units: orderedUnits, replenishment_cents: spend,
      opening_cash_cents: openingCash, closing_cash_cents: cash, closing_inventory_units: invUnits, closing_inventory_cents: invCents,
      sold_out_products: soldOutCount, low_stock_products: lowCount });
  }
  return rec;
}

module.exports = { simulate, customerCount, visitTimes, missionFor, buildChoiceWeights, lineCount };
