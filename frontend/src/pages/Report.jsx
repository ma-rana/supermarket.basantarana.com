import { Link, useNavigate, useParams } from "react-router-dom";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, LineChart } from "recharts";
import { useData, money, num, pct } from "../api";
import { Kpi, Badge, Loading, ProductLink, DayLink, EVENT_LABEL } from "../components/ui.jsx";

export default function Report() {
  const { runId } = useParams();
  const nav = useNavigate();
  const rep = useData(`/api/runs/${runId}/report`);
  const fnd = useData(`/api/runs/${runId}/findings`);
  const asr = useData(`/api/runs/${runId}/assurance`);
  if (!rep.data) return <Loading state={rep} />;
  const { part1: p1, part2: p2 } = rep.data;
  const t = p1.totals;
  const wd = p1.weekday_weekend;
  const chartDaily = p1.daily.map((d) => ({ ...d, label: `${d.day}`, revenue: d.revenue_cents / 100, gp: d.gross_profit_cents / 100, waste: d.write_off_cents / 100 }));

  return (
    <div className="wrap">
      <h1>60-Day Commercial Report</h1>
      <p className="muted">Every figure below is calculated from the stored history of run <span className="mono">{runId}</span>. Click a day, product or finding link to trace it to the Daily Report and stored records.</p>
      <div className="section-nav">
        <a href="#part1">1 · Business performance</a><a href="#part2">2 · Inventory &amp; autonomous operations</a>
        <a href="#part3">3 · Diagnosis &amp; recommendations</a><a href="#part4">4 · Commercial assurance</a>
      </div>

      <div className="grid kpis">
        <Kpi label="Sales revenue" value={money(t.revenue_cents)} sub={`${money(Math.round(t.revenue_cents / t.days))} per day`} />
        <Kpi label="Gross profit" value={money(t.gross_profit_cents)} sub={`${pct(t.gross_margin_pct)} margin`} />
        <Kpi label="Expiry write-off (cost)" value={money(t.write_off_cents)} sub={`${num(t.write_off_units)} units · ${pct(100 * t.write_off_cents / t.gross_profit_cents)} of GP`} />
        <Kpi label="Gross profit after write-off" value={money(t.profit_after_write_off_cents)} />
        <Kpi label="Customers" value={num(t.customers)} sub={`${num(t.avg_customers_per_day)} per day · ${num(t.walkouts)} left empty-handed`} />
        <Kpi label="Transactions" value={num(t.transactions)} sub={`${num(t.units)} units sold`} />
        <Kpi label="Closing operating cash" value={money(t.closing_cash_cents)} sub={`from ${money(t.opening_cash_cents)} on Day 1`} />
        <Kpi label="Closing inventory (cost)" value={money(t.closing_inventory_cents)} sub={`opening stock ${money(t.opening_inventory_cents)}`} />
      </div>

      {/* part 1 */}
      <div className="part-title" id="part1"><h2 style={{ margin: 0 }}>Part 1 · Business performance</h2><span className="q">What happened to the business over the 60 days?</span></div>

      <h3>Daily revenue, gross profit and customers <span className="muted small">(click a bar to open that Daily Report)</span></h3>
      <div className="card" style={{ height: 300 }}>
        <ResponsiveContainer>
          <ComposedChart data={chartDaily} onClick={(e) => e?.activeLabel && nav(`/runs/${runId}/days/${e.activeLabel}`)}>
            <CartesianGrid stroke="#eef1ef" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={4} />
            <YAxis yAxisId="m" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v, n) => (n === "Customers" ? v : `$${Number(v).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`)} labelFormatter={(l) => `Day ${l} (${chartDaily[l - 1]?.weekday})`} />
            <Legend />
            <Bar yAxisId="m" dataKey="revenue" name="Revenue" fill="#9fcfc0" cursor="pointer" />
            <Bar yAxisId="m" dataKey="gp" name="Gross profit" fill="#1f6f5c" cursor="pointer" />
            <Line yAxisId="c" dataKey="customers" name="Customers" stroke="#17202a" dot={false} strokeWidth={1.5} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="small muted">Traffic starts at about 80% of mature level (new-store ramp-up) and the weekly cycle shows quieter Saturdays and Sundays. First 21 days: {num(p1.trend.first_21.avg_customers)} customers/day; last 21 days: {num(p1.trend.last_21.avg_customers)}.</p>

      <div className="grid two" id="weekday">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Shopper and basket performance</h3>
          <table>
            <thead><tr><th></th><th className="n">Weekday</th><th className="n">Weekend</th><th className="n">All days</th></tr></thead>
            <tbody>
              <tr><td>Days</td><td className="n">{wd.weekday.days}</td><td className="n">{wd.weekend.days}</td><td className="n">{t.days}</td></tr>
              <tr><td>Avg customers / day</td><td className="n">{num(wd.weekday.avg_customers)}</td><td className="n">{num(wd.weekend.avg_customers)}</td><td className="n">{num(t.avg_customers_per_day)}</td></tr>
              <tr><td>Avg revenue / day</td><td className="n">{money(wd.weekday.avg_revenue_cents)}</td><td className="n">{money(wd.weekend.avg_revenue_cents)}</td><td className="n">{money(Math.round(t.revenue_cents / t.days))}</td></tr>
              <tr><td>Avg basket size (units)</td><td className="n">{wd.weekday.avg_basket_units}</td><td className="n">{wd.weekend.avg_basket_units}</td><td className="n">{t.avg_basket_units}</td></tr>
              <tr><td>Avg transaction value</td><td className="n">{money(wd.weekday.avg_transaction_cents)}</td><td className="n">{money(wd.weekend.avg_transaction_cents)}</td><td className="n">{money(t.avg_transaction_cents)}</td></tr>
              <tr><td>Avg write-off / day</td><td className="n">{money(wd.weekday.avg_write_off_cents)}</td><td className="n">{money(wd.weekend.avg_write_off_cents)}</td><td className="n">{money(Math.round(t.write_off_cents / t.days))}</td></tr>
            </tbody>
          </table>
          <h3>By day of week</h3>
          <table>
            <thead><tr><th>Day</th><th className="n">Customers/day</th><th className="n">Revenue/day</th><th className="n">Basket</th><th className="n">Avg sale</th></tr></thead>
            <tbody>{p1.by_weekday.map((w) => (
              <tr key={w.weekday}><td>{w.weekday}</td><td className="n">{num(w.avg_customers)}</td><td className="n">{money(w.avg_revenue_cents)}</td><td className="n">{w.avg_basket_units}</td><td className="n">{money(w.avg_transaction_cents)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Customer activity by hour (average visits)</h3>
          <div style={{ height: 210 }}>
            <ResponsiveContainer>
              <LineChart data={p1.hours.map((h) => ({ ...h, label: `${h.hour}:00` }))}>
                <CartesianGrid stroke="#eef1ef" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={1} /><YAxis tick={{ fontSize: 11 }} />
                <Tooltip /><Legend />
                <Line dataKey="weekday_avg" name="Weekday" stroke="#1f6f5c" strokeWidth={2} dot={false} />
                <Line dataKey="weekend_avg" name="Weekend" stroke="#b7791f" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <h3>Shopping missions</h3>
          <table>
            <thead><tr><th>Mission</th><th className="n">Transactions</th><th className="n">Avg units</th><th className="n">Avg sale</th><th className="n">Revenue share</th></tr></thead>
            <tbody>{p1.missions.map((m) => (
              <tr key={m.mission}><td>{m.label}</td><td className="n">{num(m.transactions)}</td><td className="n">{m.avg_units}</td><td className="n">{money(m.avg_transaction_cents)}</td><td className="n">{pct(m.revenue_share_pct)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <h3 id="categories">Product and category performance</h3>
      <div className="card">
        <table>
          <thead><tr><th>Category</th><th className="n">Units sold</th><th className="n">Revenue</th><th className="n">Revenue share</th><th className="n">Gross profit</th><th className="n">GP share</th><th className="n">Margin</th><th className="n">Write-off</th><th className="n">GP after write-off</th></tr></thead>
          <tbody>{[...p1.categories].sort((a, b) => b.gross_profit_cents - a.gross_profit_cents).map((c) => (
            <tr key={c.category}><td>{c.label}</td><td className="n">{num(c.units)}</td><td className="n">{money(c.revenue_cents)}</td><td className="n">{pct(c.revenue_share_pct)}</td>
              <td className="n">{money(c.gross_profit_cents)}</td><td className="n">{pct(c.gp_share_pct)}</td><td className="n">{pct(c.gross_margin_pct)}</td>
              <td className="n">{money(c.write_off_cents)}</td><td className="n">{money(c.profit_after_write_off_cents)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="grid two">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Top-selling products (revenue)</h3>
          <table><thead><tr><th>Product</th><th className="n">Units</th><th className="n">Revenue</th><th className="n">Gross profit</th></tr></thead>
            <tbody>{p1.top_products.map((p) => (<tr key={p.product_id}><td><ProductLink runId={runId} id={p.product_id} name={p.name} /></td><td className="n">{num(p.units)}</td><td className="n">{money(p.revenue_cents)}</td><td className="n">{money(p.gross_profit_cents)}</td></tr>))}</tbody></table>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Weak / slow-selling products (units)</h3>
          <table><thead><tr><th>Product</th><th className="n">Units</th><th className="n">Per day</th><th className="n">Closing stock</th><th className="n">Cover (days)</th></tr></thead>
            <tbody>{p1.weak_products.map((p) => (<tr key={p.product_id}><td><ProductLink runId={runId} id={p.product_id} name={p.name} /></td><td className="n">{num(p.units)}</td><td className="n">{p.avg_daily_units}</td><td className="n">{num(p.closing_qty)}</td><td className="n">{p.closing_cover_days >= 999 ? "no sales" : num(p.closing_cover_days)}</td></tr>))}</tbody></table>
        </div>
      </div>

      {/* part 2 */}
      <div className="part-title" id="part2"><h2 style={{ margin: 0 }}>Part 2 · Inventory and autonomous operations</h2><span className="q">What operational problems occurred, and what did the Store Brain do?</span></div>
      <div className="grid kpis" style={{ marginTop: 12 }}>
        <Kpi label="Sold-out events" value={num(p2.inventory_health.sold_out_events)} sub={`${p2.inventory_health.sold_out_products} products`} />
        <Kpi label="Unmet demand" value={`${num(p2.inventory_health.lost_units)} units`} sub={`~${money(p2.inventory_health.lost_revenue_cents)} revenue · ${num(p2.inventory_health.substituted_units)} substituted`} />
        <Kpi label="Low-stock events" value={num(p2.inventory_health.low_stock_events)} sub={`${p2.inventory_health.low_stock_products} products`} />
        <Kpi label="Expired / written off" value={`${num(p2.inventory_health.write_off_units)} units`} sub={money(p2.inventory_health.write_off_cents)} />
        <Kpi label="Slow-moving products" value={num(p2.inventory_health.slow_moving_products)} />
        <Kpi label="Replenishment" value={money(p2.replenishment.total_spend_cents)} sub={`${num(p2.replenishment.total_orders)} orders · ${num(p2.replenishment.total_units)} units`} />
        <Kpi label="Orders limited by cash" value={num(p2.replenishment.cash_constrained_orders)} />
        <Kpi label="Closing inventory" value={`${num(p2.inventory_health.closing_inventory_units)} units`} sub={money(p2.inventory_health.closing_inventory_cents)} />
      </div>

      <div className="grid two">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Store Brain activity (60 days)</h3>
          <table><thead><tr><th>Condition / action</th><th className="n">Events</th><th className="n">Products</th></tr></thead>
            <tbody>{p2.brain.events.map((e) => (<tr key={e.event_type}><td>{EVENT_LABEL[e.event_type]}</td><td className="n">{num(e.count)}</td><td className="n">{e.event_type === "REPLENISHMENT" || e.event_type === "FINAL_DAY" ? "—" : num(e.products)}</td></tr>))}</tbody></table>
          <p className="small muted">Event types with zero occurrences are shown as 0, not omitted. Low-stock and sold-out events are counted per product per day at close.</p>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Expiry write-off and sell-outs by day of week</h3>
          <table><thead><tr><th>Day</th><th className="n">Units written off</th><th className="n">Write-off value</th><th className="n">Sold-out events</th></tr></thead>
            <tbody>{p2.write_off_by_weekday.map((w) => (<tr key={w.weekday}><td>{w.weekday}</td><td className="n">{num(w.write_off_units)}</td><td className="n">{money(w.write_off_cents)}</td><td className="n">{num(w.sold_out_events)}</td></tr>))}</tbody></table>
          <p className="small muted">Stock is removed on the morning it expires, so a Monday write-off is food left unsold on Sunday.</p>
        </div>
      </div>

      <h3>Sold-out cases: condition → Store Brain response → outcome</h3>
      <div className="card">
        {p2.brain.stockout_cases.length === 0 ? <p>No sold-out events in this run (0).</p> : (
          <table><thead><tr><th>Product</th><th>Policy</th><th className="n">Sold-out days</th><th className="n">Unmet units</th><th className="n">Lost revenue (est.)</th><th className="n">Emergency orders</th><th className="n">Recovered next day</th><th>Sold-out days (trace)</th></tr></thead>
            <tbody>{p2.brain.stockout_cases.map((c) => (
              <tr key={c.product_id}><td><ProductLink runId={runId} id={c.product_id} name={c.name} /></td><td className="small">{c.policy}</td><td className="n">{c.sold_out_dates.length}</td><td className="n">{num(c.lost_units)}</td><td className="n">{money(c.lost_revenue_cents)}</td>
                <td className="n">{c.sold_out_orders} ({num(c.sold_out_order_units)} u)</td><td className="n">{c.recovered_next_day}/{c.sold_out_dates.length}</td>
                <td className="small">{c.sold_out_dates.slice(0, 8).map((d, i) => <span key={d}>{i ? ", " : ""}<DayLink runId={runId} day={d}>{d}</DayLink></span>)}{c.sold_out_dates.length > 8 ? " …" : ""}</td></tr>))}</tbody></table>)}
        <p className="small muted">When a product sells out, the Brain raises a SOLD_OUT alert, lifts its forecast by 25% (sales were cut short) and orders that night for next-morning delivery. "Recovered next day" counts sell-outs that did not repeat the following day.</p>
      </div>

      <h3>Expiry and waste cases</h3>
      <div className="card">
        <table><thead><tr><th>Product</th><th>Policy</th><th className="n">Sold</th><th className="n">Written off</th><th className="n">Waste rate</th><th className="n">Value</th><th className="n">Expiry warnings</th><th>Largest write-offs</th></tr></thead>
          <tbody>{p2.brain.waste_cases.map((c) => (
            <tr key={c.product_id} className={c.waste_rate_pct > 15 ? "bad" : ""}><td><ProductLink runId={runId} id={c.product_id} name={c.name} /></td><td className="small">{c.policy}</td><td className="n">{num(c.units)}</td><td className="n">{num(c.write_off_units)}</td><td className="n">{pct(c.waste_rate_pct)}</td><td className="n">{money(c.write_off_cents)}</td><td className="n">{c.expiry_warnings}</td>
              <td className="small">{c.worst_days.map((w, i) => <span key={w.day}>{i ? ", " : ""}<DayLink runId={runId} day={w.day}>Day {w.day}</DayLink> ({w.qty})</span>)}</td></tr>))}</tbody></table>
        <p className="small muted">At close, the Brain warns about units that will expire before the next opening and excludes them from sellable stock when sizing the night's order. Expired units are removed before customers arrive, so none can be sold (see Assurance check I5).</p>
        <h3>Write-off by category</h3>
        <table><thead><tr><th>Category</th><th className="n">Units</th><th className="n">Value</th></tr></thead>
          <tbody>{p2.write_off_by_category.map((c) => <tr key={c.category}><td>{c.label}</td><td className="n">{num(c.units)}</td><td className="n">{money(c.value_cents)}</td></tr>)}</tbody></table>
      </div>

      <div className="grid two">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Slow-moving stock</h3>
          {p2.slow_moving.length === 0 ? <p>No products were flagged slow-moving (0).</p> : (
            <table><thead><tr><th>Product</th><th className="n">First flagged</th><th className="n">Days flagged</th><th className="n">Units sold</th><th className="n">Closing stock</th></tr></thead>
              <tbody>{p2.slow_moving.map((s) => (<tr key={s.product_id}><td><ProductLink runId={runId} id={s.product_id} name={s.name} /><div className="small muted">{s.first_message}</div></td>
                <td className="n"><DayLink runId={runId} day={s.first_flag_day} /></td><td className="n">{s.days_flagged}</td><td className="n">{num(s.units)}</td><td className="n">{num(s.closing_qty)} ({money(s.closing_value_cents)})</td></tr>))}</tbody></table>)}
          <p className="small muted">Response: replenishment is held while cover exceeds 30 days, and the product is flagged to the manager for markdown or range review (markdowns are not automated).</p>
        </div>
        <div className="card" id="replenishment">
          <h3 style={{ marginTop: 0 }}>Replenishment and closing inventory by category</h3>
          <table><thead><tr><th>Category</th><th className="n">Orders</th><th className="n">Units</th><th className="n">Spend</th><th className="n">Closing stock</th></tr></thead>
            <tbody>{p2.closing_inventory_by_category.map((c) => { const o = p2.replenishment.by_category.find((x) => x.category === c.category) || {}; return (
              <tr key={c.category}><td>{c.label}</td><td className="n">{num(o.orders || 0)}</td><td className="n">{num(o.units || 0)}</td><td className="n">{money(o.spend_cents || 0)}</td><td className="n">{money(c.value_cents)}</td></tr>); })}</tbody></table>
          <h3>Orders by trigger</h3>
          <table><thead><tr><th>Trigger</th><th className="n">Orders</th><th className="n">Units</th><th className="n">Spend</th><th className="n">Cash-limited</th></tr></thead>
            <tbody>{p2.replenishment.by_trigger.map((o) => <tr key={o.trigger}><td>{o.trigger}</td><td className="n">{num(o.orders)}</td><td className="n">{num(o.units)}</td><td className="n">{money(o.spend_cents)}</td><td className="n">{o.constrained}</td></tr>)}</tbody></table>
          <p className="small muted">Orders are funded in priority order (sold out, then low stock, then daily-fresh standing orders, highest expected gross profit first) and never exceed the cash available when placed.</p>
        </div>
      </div>

      {/* part 3 */}
      <div className="part-title" id="part3"><h2 style={{ margin: 0 }}>Part 3 · Commercial diagnosis and management recommendations</h2><span className="q">What should the client consider next?</span></div>
      {!fnd.data ? <Loading state={fnd} /> : fnd.data.findings.map((f) => (
        <div key={f.id} className={`card finding ${f.kind === "Problem" ? "problem" : ""}`} style={{ marginTop: 14 }}>
          <div><Badge kind={f.kind === "Problem" ? "HIGH" : "MEDIUM"}>{f.kind}</Badge> <strong style={{ fontSize: 16 }}>{f.id}. {f.title}</strong></div>
          <div className="chain">
            <div className="k">Observation</div><div>{f.observation}</div>
            <div className="k">Evidence</div><div><ul>{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
              <div className="small" style={{ marginTop: 4 }}>Trace: {f.links.map((l, i) => <span key={i}>{i ? " · " : ""}{l.type === "product" ? <ProductLink runId={runId} id={l.id} name={l.label} /> : l.type === "day" ? <DayLink runId={runId} day={l.id}>{l.label}</DayLink> : <a href={`#${l.id}`}>{l.label}</a>}</span>)}</div></div>
            <div className="k">Diagnosis</div><div>{f.diagnosis}</div>
            <div className="k">Business implication</div><div>{f.implication}</div>
            <div className="k">Recommendation</div><div><strong>{f.recommendation}</strong></div>
            <div className="k">Model limitation</div><div className="muted">{f.limitation}</div>
          </div>
        </div>
      ))}

      {/* part 4 */}
      <div className="part-title" id="part4"><h2 style={{ margin: 0 }}>Part 4 · Commercial assurance</h2><span className="q">Can the client trust the report?</span></div>
      {!asr.data ? <Loading state={asr} /> : (
        <div className="card" style={{ marginTop: 12 }}>
          <p style={{ marginTop: 0 }}><strong>{asr.data.summary.passed} of {asr.data.summary.total} checks passed</strong> {asr.data.summary.failed === 0 ? <Badge kind="pass">PASS</Badge> : <Badge kind="fail">{asr.data.summary.failed} FAILED</Badge>} · {asr.data.days}/60 days retained · {num(asr.data.counts.transactions)} transactions, {num(asr.data.counts.replenishment_orders)} orders, {num(asr.data.counts.brain_events)} Store Brain records.</p>
          <table><tbody>{asr.data.checks.filter((c) => ["H1", "I1", "I4", "I5", "R2", "R3", "K1", "K2"].includes(c.id)).map((c) => (
            <tr key={c.id}><td style={{ width: 70 }}><Badge kind={c.status === "PASS" ? "pass" : "fail"}>{c.status}</Badge></td><td><strong>{c.title}</strong><div className="small muted">{c.detail}</div></td></tr>))}</tbody></table>
          <p><Link to={`/runs/${runId}/assurance`}>Open the full Commercial Assurance view →</Link></p>
        </div>
      )}
    </div>
  );
}
