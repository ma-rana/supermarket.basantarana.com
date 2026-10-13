import { useParams, Link } from "react-router-dom";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { useData, money, num } from "../api";
import { Badge, Loading, DayLink, EVENT_LABEL, CAT } from "../components/ui.jsx";

export default function ProductTrace() {
  const { runId, pid } = useParams();
  const s = useData(`/api/runs/${runId}/products/${pid}`);
  if (!s.data) return <Loading state={s} />;
  const { product: p, daily, events, orders, batches, totals: t } = s.data;
  const chart = daily.map((d) => ({ day: d.day, Sold: d.sold_qty, Expired: d.expired_qty, Unmet: d.lost_units, "Closing stock": d.closing_qty }));

  return (
    <div className="wrap">
      <p className="small"><Link to={`/runs/${runId}/products`}>← All products</Link></p>
      <h1>{p.name} <span className="mono muted" style={{ fontWeight: 400 }}>{p.product_id}</span></h1>
      <p className="muted">{CAT[p.category]} · policy <strong>{p.policy}</strong> · cost {money(p.unit_cost_cents, 2)} · price {money(p.unit_price_cents, 2)} · case of {p.case_pack} · {p.perishable ? `perishable, ${p.shelf_life_days}-day shelf life` : "non-perishable"} · popularity weight {p.popularity}</p>

      <div className="card">
        <div className="equation">Opening {num(t.opening)} + received {num(t.received)} − sold {num(t.sold)} − expired {num(t.expired)} = {num(t.opening + t.received - t.sold - t.expired)} · recorded closing {num(t.closing)}{" "}
          <Badge kind={t.reconciles ? "pass" : "fail"}>{t.reconciles ? "RECONCILES" : "MISMATCH"}</Badge></div>
        <div className="small muted" style={{ marginTop: 4 }}>Revenue {money(t.revenue_cents)} from {num(t.sold)} units over 60 days.</div>
      </div>

      <div className="card" style={{ height: 280 }}>
        <ResponsiveContainer><ComposedChart data={chart}>
          <CartesianGrid stroke="#eef1ef" vertical={false} /><XAxis dataKey="day" tick={{ fontSize: 11 }} interval={4} /><YAxis tick={{ fontSize: 11 }} /><Tooltip labelFormatter={(l) => `Day ${l}`} /><Legend />
          <Bar dataKey="Sold" stackId="a" fill="#1f6f5c" /><Bar dataKey="Expired" stackId="a" fill="#b42318" /><Bar dataKey="Unmet" stackId="a" fill="#e0b25a" />
          <Line dataKey="Closing stock" stroke="#17202a" dot={false} strokeWidth={1.5} />
        </ComposedChart></ResponsiveContainer>
      </div>

      <div className="grid two">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Store Brain decisions ({events.length})</h3>
          <div className="scroll" style={{ maxHeight: 360 }}><table><tbody>{events.map((e) => (
            <tr key={e.event_id}><td><DayLink runId={runId} day={e.day} /></td><td><Badge kind={e.severity}>{EVENT_LABEL[e.event_type]}</Badge></td><td className="small">{e.message}<div className="muted">→ {e.action}</div></td></tr>))}
            {events.length === 0 && <tr><td>No conditions raised for this product.</td></tr>}</tbody></table></div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Replenishment orders ({orders.length})</h3>
          <div className="scroll" style={{ maxHeight: 360 }}><table>
            <thead><tr><th>Order</th><th>Placed</th><th>Trigger</th><th className="n">Forecast</th><th className="n">Stock</th><th className="n">Qty</th><th className="n">Cost</th></tr></thead>
            <tbody>{orders.map((o) => (<tr key={o.order_id} className={o.cash_constrained ? "flag" : ""}><td className="mono small">{o.order_id}</td><td><DayLink runId={runId} day={o.order_day} /></td><td className="small">{o.trigger}</td>
              <td className="n">{o.forecast_units}</td><td className="n">{o.stock_position}</td><td className="n">{o.ordered_qty}</td><td className="n">{money(o.total_cents, 2)}</td></tr>))}</tbody></table></div>
        </div>
      </div>

      <h3>Stock batches (receipt, expiry and what happened to each unit)</h3>
      <div className="card"><div className="scroll" style={{ maxHeight: 360 }}><table>
        <thead><tr><th>Batch</th><th>Source</th><th>Received</th><th>Expires</th><th className="n">Qty</th><th className="n">Sold</th><th className="n">Written off</th><th className="n">Remaining</th></tr></thead>
        <tbody>{batches.map((b) => (<tr key={b.batch_id} className={b.written_off ? "flag" : ""}><td className="mono small">{b.batch_id}</td><td className="small">{b.source}</td><td><DayLink runId={runId} day={b.received_day} /></td>
          <td>{b.expiry_day ? `Day ${b.expiry_day}` : "—"}</td><td className="n">{b.qty}</td><td className="n">{b.sold}</td><td className="n">{b.written_off}</td><td className="n">{b.qty - b.sold - b.written_off}</td></tr>))}</tbody>
      </table></div></div>

      <h3>Daily movement</h3>
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>Day</th><th className="n">Opening</th><th className="n">+ Received</th><th className="n">− Expired</th><th className="n">− Sold</th><th className="n">= Closing</th><th className="n">Unmet</th><th className="n">Forecast/day</th><th className="n">Cover</th><th>Status</th></tr></thead>
        <tbody>{daily.map((d) => (<tr key={d.day} className={d.status === "SOLD_OUT" ? "bad" : d.status !== "OK" ? "flag" : ""}><td><DayLink runId={runId} day={d.day} /></td>
          <td className="n">{d.opening_qty}</td><td className="n">{d.received_qty}</td><td className="n">{d.expired_qty}</td><td className="n">{d.sold_qty}</td><td className="n"><strong>{d.closing_qty}</strong></td>
          <td className="n">{d.lost_units || ""}</td><td className="n">{d.forecast_units}</td><td className="n">{d.cover_days >= 999 ? "—" : d.cover_days}</td><td><Badge kind={d.status}>{d.status}</Badge></td></tr>))}</tbody>
      </table></div></div>
    </div>
  );
}
