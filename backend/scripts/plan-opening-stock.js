// estimates daily demand per product and sets opening quantities -> products.seed.json
// usage: node scripts/plan-opening-stock.js

const fs = require("fs");
const path = require("path");
const { DEFAULT_CONFIG, policyFor } = require("../sim/model");
const { makeRng } = require("../sim/rng");
const { customerCount, visitTimes, missionFor, buildChoiceWeights, lineCount } = require("../sim/simulate");

const base = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/catalogue.base.json"), "utf8"));
const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
cfg.customers.ramp.start_factor = 1; // mature traffic for planning
cfg.customers.daily_noise_sd = 0;

const PLAN_DAYS = 28;
const rng = makeRng(20260801);
const weights = buildChoiceWeights(base, cfg);
const demand = Object.fromEntries(base.map((p) => [p.product_id, 0]));

for (let day = 1; day <= PLAN_DAYS; day++) {
  const { wd, count } = customerCount(rng, cfg, day);
  for (const minute of visitTimes(rng, cfg, wd >= 5, count)) {
    const m = missionFor(rng, cfg, wd >= 5, minute);
    const def = cfg.missions[m];
    const n = lineCount(rng, def.lines);
    for (let l = 0; l < n; l++) {
      const cat = rng.weighted(def.categories);
      const pid = rng.weighted(weights[m][cat]);
      demand[pid] += rng.next() < def.multi_unit_p ? 2 : 1;
    }
  }
}

let totalCost = 0;
const out = base.map((p) => {
  const daily = demand[p.product_id] / PLAN_DAYS;
  const pol = policyFor(p, cfg.brain);
  const plan = cfg.opening_plan[pol];
  let qty = daily * plan.days;
  if (pol === "AMBIENT") qty = Math.max(qty, plan.min_display_units);
  qty = Math.ceil(qty / p.case_pack) * p.case_pack;
  totalCost += qty * p.cost;
  return { ...p, initial_qty: qty, planning_daily_demand: +daily.toFixed(1) };
});

console.log("Expected units/day:", out.reduce((s, p) => s + p.planning_daily_demand, 0).toFixed(0));
console.log("Opening inventory cost: $" + totalCost.toFixed(2), totalCost <= 40000 ? "(within $40,000)" : "(OVER BUDGET)");
for (const p of out) console.log(p.product_id, p.name.padEnd(32), "demand/day", String(p.planning_daily_demand).padStart(6), "qty", p.initial_qty);
fs.writeFileSync(path.join(__dirname, "../data/products.seed.json"), JSON.stringify(out, null, 2));
