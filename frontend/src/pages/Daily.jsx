import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useData, get, money, num, hhmm } from "../api";
import { Kpi, Badge, Loading, ProductLink, EVENT_LABEL, CAT } from "../components/ui.jsx";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function TxRow({ runId, t }) {
  const [items, setItems] = useState(null);
  return (
    <>
      <tr>
        <td className="mono"><a href="#" onClick={(e) => { e.preventDefault(); items ? setItems(null) : get(`/api/runs/${runId}/transactions/${t.transaction_id}`).then((d) => setItems(d.items)); }}>{items ? "▾" : "▸"} {t.transaction_id}</a></td>
        <td>{hhmm(t.minute)}</td><td>{t.mission}</td><td className="n">{t.units}</td><td className="n">{money(t.total_cents, 2)}</td>
      </tr>
      {items && items.map((i) => (
        <tr key={i.line_no} className="small"><td></td><td colSpan={2}>{i.qty} × <ProductLink runId={runId} id={i.product_id} name={i.name} /></td><td className="n">@ {money(i.unit_price_cents, 2)}</td><td className="n">{money(i.line_total_cents, 2)}</td></tr>
      ))}
    </>
  );
}

export default function Daily() {
  const { runId, day } = useParams();
  const d = Number(day);
  const nav = useNavigate();
  const s = useData(`/api/runs/${runId}/days/${d}`);
  const [invFilter, setInvFilter] = useState("flagged");
  const [txLimit, setTxLimit] = useState(30);

  const picker = (
    <div className="card">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn ghost" disabled={d <= 1} onClick={() => nav(`/runs/${runId}/days/${d - 1}`)}>← Previous day</button>
        <select value={d} onChange={(e) => nav(`/runs/${runId}/days/${e.target.value}`)}>
          {Array.from({ length: 60 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Day {n} ({WD[(n - 1) % 7]})</option>)}
        </select>
        <button className="btn ghost" disabled={d >= 60} onClick={() => nav(`/runs/${runId}/days/${d + 1}`)}>Next day →</button>
      </div>
      <div className="daystrip">
        {Array.from({ length: 60 }, (_, i) => i + 1).map((n) => (
          <Link key={n} to={`/runs/${runId}/days/${n}`} className={`${n === d ? "cur" : ""} ${(n - 1) % 7 >= 5 ? "we" : ""}`}>{n}</Link>
        ))}
      </div>
    </div>
  );
  if (!s.data) return <div className="wrap">{picker}<Loading state={s} /></div>;
  const { summary: x, inventory, events, orders, receipts, write_offs, hourly, missions, categories, transactions, checks } = s.data;
  const inv = inventory.filter((r) => invFilter === "all" || r.status !== "OK" || r.expired_qty > 0 || r.lost_units > 0);
  const productEvents = events.filter((e) => e.product_id);
  const storeEvents = events.filter((e) => !e.product_id);

  return (
    <div className="wrap">
      <h1>Daily Report · Day {d} <span className="muted" style={{ fontWeight: 400 }}>({x.weekday}{x.is_weekend ? ", weekend" : ""})</span></h1>
      {picker}

      <div className="grid kpis">
        <Kpi label="Customers" value={num(x.customers)} sub={`${x.walkouts} left without buying · traffic ramp ${(x.traffic_ramp * 100).toFixed(0)}%`} />
        <Kpi label="Transactions" value={num(x.transactions)} sub={`${num(x.units)} units · basket ${(x.units / Math.max(1, x.transactions)).toFixed(2)}`} />
        <Kpi label="Revenue" value={money(x.revenue_cents)} sub={`avg sale ${money(Math.round(x.revenue_cents / Math.max(1, x.transactions)), 2)}`} />
        <Kpi label="Gross profit" value={money(x.gross_profit_cents)} sub={`COGS ${money(x.cogs_cents)}`} />
        <Kpi label="Expired (morning)" value={`${num(x.write_off_units)} units`} sub={money(x.write_off_cents)} />
        <Kpi label="Received (morning)" value={`${num(x.received_units)} units`} />
        <Kpi label="Orders placed (close)" value={num(x.replenishment_orders)} sub={`${num(x.replenishment_units)} units · ${money(x.replenishment_cents)}`} />
        <Kpi label="At close" value={`${x.sold_out_products} sold out`} sub={`${x.low_stock_products} low stock`} />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Cash and integrity for this day</h3>
        <div className="equation">Opening cash {money(x.opening_cash_cents, 2)} + revenue {money(x.revenue_cents, 2)} − replenishment {money(x.replenishment_cents, 2)} = closing cash {money(x.closing_cash_cents, 2)}</div>
        <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span><Badge kind={checks.cash_balances ? "pass" : "fail"}>{checks.cash_balances ? "PASS" : "FAIL"}</Badge> cash balances</span>
          <span><Badge kind={checks.revenue_matches_transactions ? "pass" : "fail"}>{checks.revenue_matches_transactions ? "PASS" : "FAIL"}</Badge> revenue = sum of {transactions.length} transactions ({money(checks.transactions_total_cents, 2)})</span>
          <span><Badge kind={checks.inventory_rows_balance ? "pass" : "fail"}>{checks.inventory_rows_balance ? "PASS" : "FAIL"}</Badge> every product: opening + received − expired − sold = closing</span>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Closing inventory {num(x.closing_inventory_units)} units at cost {money(x.closing_inventory_cents)}.</p>
      </div>

      <h2>Store Brain log</h2>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>Order of the day: (1) receive last night's orders, (2) remove expired stock, (3) customers shop, (4) Store Brain reviews the close and orders for tomorrow morning.</p>
        {storeEvents.map((e) => <div key={e.event_id} className="callout" style={{ marginBottom: 8 }}><strong>{EVENT_LABEL[e.event_type]}:</strong> {e.message} <span className="muted">→ {e.action}</span></div>)}
        <div className="scroll"><table>
          <thead><tr><th>Phase</th><th>Condition</th><th>Product</th><th>Detected</th><th>Action</th></tr></thead>
          <tbody>{productEvents.map((e) => (
            <tr key={e.event_id}><td className="small">{e.phase === "OPEN" ? "Before opening" : "At close"}</td><td><Badge kind={e.severity}>{EVENT_LABEL[e.event_type]}</Badge></td>
              <td><ProductLink runId={runId} id={e.product_id} name={e.name} /></td><td className="small">{e.message}</td><td className="small">{e.action}</td></tr>))}
            {productEvents.length === 0 && <tr><td colSpan={5}>No product conditions raised today.</td></tr>}</tbody>
        </table></div>
      </div>

      <div className="grid two">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Replenishment ordered at close (arrives Day {d + 1})</h3>
          {orders.length === 0 ? <p>{d === 60 ? "None: no orders are placed after the close of Day 60." : "No orders placed."}</p> : (
            <div className="scroll" style={{ maxHeight: 320 }}><table><thead><tr><th>Order</th><th>Product</th><th>Trigger</th><th className="n">Forecast/day</th><th className="n">Sellable stock</th><th className="n">Qty</th><th className="n">Cost</th><th className="n">Cash after</th></tr></thead>
              <tbody>{orders.map((o) => (<tr key={o.order_id} className={o.cash_constrained ? "flag" : ""}><td className="mono">{o.order_id}</td><td><ProductLink runId={runId} id={o.product_id} name={o.name} /></td><td className="small">{o.trigger}</td>
                <td className="n">{o.forecast_units}</td><td className="n">{o.stock_position}</td><td className="n">{o.ordered_qty}</td><td className="n">{money(o.total_cents, 2)}</td><td className="n">{money(o.cash_after_cents)}</td></tr>))}</tbody></table></div>)}
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Before opening</h3>
          <h3>Received ({receipts.length} deliveries)</h3>
          {receipts.length === 0 ? <p className="small">{d === 1 ? "Opening inventory delivered (see Model Declaration)." : "None."}</p> : (
            <div className="scroll" style={{ maxHeight: 140 }}><table><tbody>{receipts.map((b) => <tr key={b.batch_id}><td className="mono small">{b.order_id}</td><td><ProductLink runId={runId} id={b.product_id} name={b.name} /></td><td className="n">{b.qty}</td><td className="small muted">{b.expiry_day ? `expires Day ${b.expiry_day}` : "no expiry"}</td></tr>)}</tbody></table></div>)}
          <h3>Expired and written off</h3>
          {write_offs.length === 0 ? <p className="small">None.</p> : (
            <table><tbody>{write_offs.map((w) => <tr key={w.batch_id}><td><ProductLink runId={runId} id={w.product_id} name={w.name} /></td><td className="mono small">{w.batch_id}</td><td className="n">{w.qty} units</td><td className="n">{money(w.value_cents, 2)}</td></tr>)}</tbody></table>)}
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Customers by hour</h3>
          <div style={{ height: 180 }}><ResponsiveContainer><BarChart data={hourly.map((h) => ({ ...h, label: `${h.hour}:00` }))}>
            <CartesianGrid stroke="#eef1ef" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
            <Bar dataKey="visits" name="Visits" fill="#1f6f5c" /></BarChart></ResponsiveContainer></div>
          <table><thead><tr><th>Mission</th><th className="n">Transactions</th><th className="n">Units</th><th className="n">Revenue</th></tr></thead>
            <tbody>{missions.map((m) => <tr key={m.mission}><td>{m.label}</td><td className="n">{m.transactions}</td><td className="n">{m.units}</td><td className="n">{money(m.revenue_cents)}</td></tr>)}</tbody></table>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Sales by category</h3>
          <table><thead><tr><th>Category</th><th className="n">Units</th><th className="n">Revenue</th></tr></thead>
            <tbody>{categories.map((c) => <tr key={c.category}><td>{c.label}</td><td className="n">{c.units}</td><td className="n">{money(c.revenue_cents)}</td></tr>)}</tbody></table>
        </div>
      </div>

      <h2>Inventory movement</h2>
      <div className="card">
        <div style={{ marginBottom: 8 }}>
          Show: <select value={invFilter} onChange={(e) => setInvFilter(e.target.value)}>
            <option value="flagged">Products with a condition or expiry today</option><option value="all">All {inventory.length} products</option>
          </select>
        </div>
        <div className="scroll"><table>
          <thead><tr><th>Product</th><th>Category</th><th>Policy</th><th className="n">Opening</th><th className="n">+ Received</th><th className="n">− Expired</th><th className="n">− Sold</th><th className="n">= Closing</th><th className="n">Unmet</th><th className="n">Forecast/day</th><th className="n">Cover</th><th>Status</th></tr></thead>
          <tbody>{inv.map((r) => (
            <tr key={r.product_id} className={r.status === "SOLD_OUT" ? "bad" : r.status !== "OK" ? "flag" : ""}>
              <td><ProductLink runId={runId} id={r.product_id} name={r.name} /></td><td className="small">{CAT[r.category]}</td><td className="small">{r.policy}</td>
              <td className="n">{r.opening_qty}</td><td className="n">{r.received_qty}</td><td className="n">{r.expired_qty}</td><td className="n">{r.sold_qty}</td><td className="n"><strong>{r.closing_qty}</strong></td>
              <td className="n">{r.lost_units || ""}</td><td className="n">{r.forecast_units}</td><td className="n">{r.cover_days >= 999 ? "—" : r.cover_days}</td><td><Badge kind={r.status}>{r.status}</Badge></td></tr>))}</tbody>
        </table></div>
      </div>

      <h2>Transactions ({transactions.length})</h2>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>Click a transaction to see its lines. Daily revenue above equals the sum of these totals.</p>
        <table><thead><tr><th>Transaction</th><th>Time</th><th>Mission</th><th className="n">Units</th><th className="n">Total</th></tr></thead>
          <tbody>{transactions.slice(0, txLimit).map((t) => <TxRow key={t.transaction_id} runId={runId} t={t} />)}</tbody></table>
        {txLimit < transactions.length && <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setTxLimit(transactions.length)}>Show all {transactions.length}</button>}
      </div>
    </div>
  );
}
