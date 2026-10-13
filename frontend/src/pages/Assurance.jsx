import { useParams, Link } from "react-router-dom";
import { useData, money, num } from "../api";
import { Badge, Loading, ProductLink } from "../components/ui.jsx";

export default function Assurance() {
  const { runId } = useParams();
  const s = useData(`/api/runs/${runId}/assurance`);
  if (!s.data) return <Loading state={s} />;
  const a = s.data;
  const groups = [...new Set(a.checks.map((c) => c.group))];
  const exceptions = a.checks.filter((c) => c.status === "FAIL");

  return (
    <div className="wrap">
      <h1>Commercial Assurance</h1>
      <p className="muted">Can the client trust the report? Each check below is recomputed directly from the stored records of this run, independently of the simulation's own totals.</p>

      <div className="card">
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
          <div><div className="muted small">Run ID</div><div className="mono">{a.run_id} {a.is_submitted && <Badge kind="sub">SUBMITTED RUN</Badge>}</div></div>
          <div><div className="muted small">Days retained</div><strong>{a.days}/60</strong></div>
          <div><div className="muted small">Checks</div><strong>{a.summary.passed}/{a.summary.total} passed</strong> {a.summary.failed === 0 ? <Badge kind="pass">ALL PASS</Badge> : <Badge kind="fail">{a.summary.failed} FAILED</Badge>}</div>
        </div>
        <h3>Records retained for audit</h3>
        <table><tbody>
          {Object.entries({ customer_visits: "Customer visits", transactions: "Transactions", transaction_items: "Transaction lines", batches: "Stock batches (opening + deliveries)",
            sale_allocations: "Batch sale allocations (FIFO)", write_offs: "Expiry write-offs", replenishment_orders: "Replenishment orders", daily_inventory: "Daily product inventory rows",
            brain_events: "Store Brain records", lost_demand: "Unmet-demand records" }).map(([k, label]) => (
            <tr key={k}><td>{label}</td><td className="n">{num(a.counts[k])}</td></tr>))}
        </tbody></table>
      </div>

      <div className={`callout ${exceptions.length ? "warn" : ""}`} style={{ marginBottom: 16 }}>
        <strong>Exceptions:</strong> {exceptions.length === 0 ? "No integrity failures or unexplained exceptions were found in this run." : `${exceptions.length} check(s) failed. See details below. Conclusions relying on the affected figures should not be used.`}
        <div className="small" style={{ marginTop: 4 }}>{a.note}</div>
      </div>

      {groups.map((g) => (
        <div className="card" key={g}>
          <h3 style={{ marginTop: 0 }}>{g}</h3>
          <table><tbody>{a.checks.filter((c) => c.group === g).map((c) => (
            <tr key={c.id} className={c.status === "FAIL" ? "bad" : ""}>
              <td style={{ width: 44 }} className="mono">{c.id}</td>
              <td style={{ width: 70 }}><Badge kind={c.status === "PASS" ? "pass" : "fail"}>{c.status}</Badge></td>
              <td><strong>{c.title}</strong><div className="small muted">{c.detail}</div>
                {c.exceptions.length > 0 && <ul className="small">{c.exceptions.map((e, i) => <li key={i}>{e}</li>)}{c.exception_count > c.exceptions.length && <li>… {c.exception_count - c.exceptions.length} more</li>}</ul>}</td>
            </tr>))}</tbody></table>
        </div>
      ))}

      <h2>Inventory reconciliation by product (Days 1–60)</h2>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>Opening stock (product data) + replenishment received (delivered batches) − units sold (transaction lines) − units expired (write-offs) = closing stock (Day 60 inventory record). Click a product to see its full movement history.</p>
        <div className="scroll"><table>
          <thead><tr><th>Product</th><th className="n">Opening</th><th className="n">+ Received</th><th className="n">− Sold</th><th className="n">− Expired</th><th className="n">= Expected</th><th className="n">Recorded closing</th><th></th></tr></thead>
          <tbody>{a.inventory_by_product.map((r) => { const exp = r.opening + r.received - r.sold - r.expired; const ok = exp === r.closing && r.batch_balance === r.closing; return (
            <tr key={r.product_id} className={ok ? "" : "bad"}><td><ProductLink runId={runId} id={r.product_id} name={r.name} /></td>
              <td className="n">{num(r.opening)}</td><td className="n">{num(r.received)}</td><td className="n">{num(r.sold)}</td><td className="n">{num(r.expired)}</td><td className="n">{num(exp)}</td><td className="n">{num(r.closing)}</td>
              <td><Badge kind={ok ? "pass" : "fail"}>{ok ? "PASS" : "FAIL"}</Badge></td></tr>); })}</tbody>
        </table></div>
      </div>
      <p className="small muted">Daily cash and revenue checks are also shown on each <Link to={`/runs/${runId}/days/1`}>Daily Report</Link>.</p>
    </div>
  );
}
