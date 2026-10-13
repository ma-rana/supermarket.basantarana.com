import { useParams } from "react-router-dom";
import { useData, money, num } from "../api";
import { Badge, Loading, ProductLink, CAT } from "../components/ui.jsx";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function Model() {
  const { runId } = useParams();
  const s = useData(`/api/runs/${runId}/model`);
  if (!s.data) return <Loading state={s} />;
  const { run, config: c, budget, categories, products, policy_counts } = s.data;
  const b = c.brain;
  const mixRow = (band) => Object.entries(band.mix).map(([k, v]) => `${c.missions[k].label} ${Math.round(v * 100)}%`).join(", ");

  return (
    <div className="wrap">
      <h1>Model Declaration</h1>
      <p className="muted">Configuration frozen when run <span className="mono">{run.run_id}</span> started {run.is_submitted && <Badge kind="sub">SUBMITTED RUN</Badge>} (model v{run.model_version}, seed <span className="mono">{run.seed}</span>, simulated in {run.duration_ms} ms). Changing the model creates a new run; this one is never rewritten. The model is a pre-operational prototype: real trading data is needed to validate and calibrate it.</p>

      <div className="grid kpis">
        <div className="kpi"><div className="label">Opening inventory budget</div><div className="value">{money(budget.opening_inventory_budget_cents)}</div></div>
        <div className="kpi"><div className="label">Opening inventory used (at cost)</div><div className="value">{money(budget.opening_inventory_cost_cents)}</div><div className="sub">{money(budget.unused_budget_cents)} unused (does not become cash)</div></div>
        <div className="kpi"><div className="label">Opening operating cash</div><div className="value">{money(budget.opening_cash_cents)}</div><div className="sub">available from Day 1 for replenishment</div></div>
        <div className="kpi"><div className="label">Simulation</div><div className="value">{c.days} days</div><div className="sub">Day 1 = {WD[c.start_weekday]} · open {c.store_hours.open}:00–{c.store_hours.close}:00</div></div>
      </div>

      <div className="card decl">
        <dl>
          <dt>Scope and boundary</dt>
          <dd>A small, unstaffed IGA-style store near Swanston St / Melbourne Town Hall, monitored remotely. Only stock, sales, expiry, replenishment and operating cash are modelled. Rent, fit-out, refrigeration, utilities, insurance, store hardware, staff and corporate overhead are outside the boundary, so "cash" means stock-trading cash, not profit. Fictional scenario, not based on IGA data.</dd>

          <dt>1. How customer activity is generated and how it varies</dt>
          <dd>Expected customers per day at maturity: {c.customers.base_by_weekday.map((n, i) => `${WD[i]} ${n}`).join(", ")}. This reflects a CBD office-worker location: busiest Thursday/Friday, quieter weekends. A new-store ramp-up starts traffic at {Math.round(c.customers.ramp.start_factor * 100)}% and reaches 100% by Day {c.customers.ramp.full_by_day}. Each day gets ±{Math.round(c.customers.daily_noise_sd * 100)}% random variation (normal distribution). Arrival times follow an hourly profile: weekday peaks at 8am (commute), 12–1pm (lunch) and 5–7pm (going home); weekends are flatter around midday.</dd>

          <dt>2. How shopping behaviour and product demand are generated</dt>
          <dd>Each customer has one shopping mission that sets basket size and which categories they shop:
            <table className="small" style={{ margin: "6px 0" }}><thead><tr><th>Mission</th><th>Products in basket</th><th>Category mix</th><th>Boosted products</th></tr></thead>
              <tbody>{Object.entries(c.missions).map(([k, m]) => (<tr key={k}><td>{m.label}</td><td>{m.lines[0]}–{m.lines[1]}</td><td>{Object.entries(m.categories).map(([cat, w]) => `${CAT[cat].split(" ")[0]} ${Math.round(w * 100)}%`).join(", ")}</td><td>{m.boost_tag ? `"${m.boost_tag}" items ×${c.tag_boost}` : "—"}</td></tr>))}</tbody></table>
            The mission depends on the time of day and weekday/weekend. For example, on weekdays 10am–2pm: {mixRow(c.mission_mix.weekday[1])}; on weekends 3–7pm: {mixRow(c.mission_mix.weekend[2])}.
            Within a category, each product is chosen in proportion to its popularity weight (staples such as milk, water and bread high; umbrellas, cables and sunscreen low), so demand is deliberately not uniform. Most lines are one unit, with occasional two-unit lines (more often for stock-up shopping). If the wanted product is unavailable, the unmet unit is recorded and the customer switches to another in-stock product in the same category {Math.round(c.substitution_p * 100)}% of the time. A customer who ends up with an empty basket leaves without a transaction.
            Sales can only use stock that is in the catalogue, on hand and not expired; each completed sale creates a transaction record and reduces the batches it was taken from.</dd>

          <dt>3. How perishable stock and shelf life are handled</dt>
          <dd>Every delivery is stored as a batch with its received day and expiry day (received day + shelf life). Sales take stock from the batch that expires first (FIFO). Before opening each day, any batch reaching its expiry day is written off at cost and removed from sale, so expired units can never be sold. Shelf lives range from 1 day (sushi) and 2 days (sandwiches, croissants) to 60 days (butter). Non-perishable lines have no expiry.</dd>

          <dt>4. How the Store Brain identifies stock, expiry and slow-moving conditions</dt>
          <dd>At every close the Brain calculates a forecast for each product: the average units sold over the last {b.forecast_window_days} days, raised by {Math.round((b.sold_out_uplift - 1) * 100)}% if the product sold out in that window (because sales were cut short). <em>Sellable stock</em> is closing stock minus units that expire before tomorrow's opening. It then classifies each product:
            <ul>
              <li><strong>Sold out</strong>: no units left at close.</li>
              <li><strong>Low stock</strong>: sellable stock at or below the policy reorder point (days of cover × forecast).</li>
              <li><strong>Expiry warning</strong>: units that will expire before the next opening (excluded from sellable stock). <strong>Expiry write-off</strong>: units removed before opening.</li>
              <li><strong>Slow-moving</strong> (shelf-stable and long-life lines, from Day {b.slow_moving.from_day}): stock covers more than {b.slow_moving.cover_days_over} days at the forecast rate, or nothing sold in the last 7 days.</li>
            </ul>
            Products are managed under four policies, because they behave differently:
            <table className="small" style={{ margin: "6px 0" }}><thead><tr><th>Policy</th><th className="n">Products</th><th>Rule</th></tr></thead>
              <tbody>{Object.entries(b.policies).map(([k, p]) => <tr key={k}><td>{k}</td><td className="n">{policy_counts[k] || 0}</td><td>{p.description}</td></tr>)}</tbody></table></dd>

          <dt>5. How replenishment decisions are made under the cash constraint</dt>
          <dd>For each product that is sold out, low on stock, or on a daily-fresh standing order, the Brain orders enough to bring sellable stock up to its policy target (target days × forecast), rounded up to the supplier case size. Orders are placed at close, paid immediately from operating cash, and delivered before opening next day (fixed {b.lead_time_days}-day lead time). Orders are funded in priority order: sold out first, then low stock, then daily-fresh standing orders, each ranked by expected daily gross profit. If cash runs short, an order is cut to the cases that can be afforded (or skipped) and a cash-constrained alert is recorded. Slow-moving lines are not reordered. No orders are placed after the close of Day {c.days}. The manager does not approve individual orders, and markdowns are not modelled.</dd>

          <dt>6. Other assumptions that materially affect the result</dt>
          <dd>Prices and unit costs are fixed for 60 days (no promotions, markdowns or price elasticity). Suppliers always deliver in full and on time. Opening stock was planned once from expected demand (see the planning script): 1 day for daily-fresh, 3 days for short-life, 7 days for long-life, and 10 days for shelf-stable lines with a minimum display of {c.opening_plan.AMBIENT.min_display_units} units. Theft, damage and shrinkage are not modelled. Customers are anonymous; repeat customers are not tracked.</dd>
        </dl>
      </div>

      <h2>Opening inventory by category</h2>
      <div className="card"><table>
        <thead><tr><th>Category</th><th className="n">Products</th><th className="n">Perishable</th><th className="n">Opening units</th><th className="n">Opening cost</th></tr></thead>
        <tbody>{categories.map((x) => <tr key={x.category}><td>{x.label}</td><td className="n">{x.products}</td><td className="n">{x.perishable}</td><td className="n">{num(x.opening_units)}</td><td className="n">{money(x.opening_cost_cents)}</td></tr>)}
          <tr><td><strong>Total</strong></td><td className="n"><strong>{products.length}</strong></td><td></td><td className="n"><strong>{num(products.reduce((a, p) => a + p.initial_qty, 0))}</strong></td><td className="n"><strong>{money(budget.opening_inventory_cost_cents)}</strong></td></tr></tbody>
      </table></div>

      <h2>Product data ({products.length} products)</h2>
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>ID</th><th>Product</th><th>Category</th><th className="n">Unit cost</th><th className="n">Price</th><th className="n">Margin</th><th>Perishable</th><th className="n">Shelf life</th><th className="n">Case</th><th className="n">Popularity</th><th>Policy</th><th className="n">Opening qty</th></tr></thead>
        <tbody>{products.map((p) => (<tr key={p.product_id}><td className="mono">{p.product_id}</td><td><ProductLink runId={runId} id={p.product_id} name={p.name} /></td><td className="small">{CAT[p.category]}</td>
          <td className="n">{money(p.unit_cost_cents, 2)}</td><td className="n">{money(p.unit_price_cents, 2)}</td><td className="n">{Math.round((100 * (p.unit_price_cents - p.unit_cost_cents)) / p.unit_price_cents)}%</td>
          <td>{p.perishable ? "Yes" : "No"}</td><td className="n">{p.shelf_life_days ? `${p.shelf_life_days} d` : "—"}</td><td className="n">{p.case_pack}</td><td className="n">{p.popularity}</td><td className="small">{p.policy}</td><td className="n">{num(p.initial_qty)}</td></tr>))}</tbody>
      </table></div></div>
    </div>
  );
}
