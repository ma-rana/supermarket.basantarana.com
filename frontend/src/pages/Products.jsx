import { useState } from "react";
import { useParams } from "react-router-dom";
import { useData, money, num, pct } from "../api";
import { Loading, ProductLink, CAT } from "../components/ui.jsx";

export default function Products() {
  const { runId } = useParams();
  const s = useData(`/api/runs/${runId}/report`);
  const [sort, setSort] = useState("revenue_cents");
  if (!s.data) return <Loading state={s} />;
  const rows = [...s.data.products].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : b[sort] - a[sort]));
  const H = ({ k, children }) => <th className="n" style={{ cursor: "pointer" }} onClick={() => setSort(k)}>{children}{sort === k ? " ▾" : ""}</th>;
  return (
    <div className="wrap">
      <h1>Products</h1>
      <p className="muted">60-day results per product. Click a column to sort, or a product to trace its daily stock, batches, orders and Store Brain decisions.</p>
      <div className="card"><div className="scroll" style={{ maxHeight: 640 }}><table>
        <thead><tr><th style={{ cursor: "pointer" }} onClick={() => setSort("name")}>Product</th><th>Category</th><th>Policy</th>
          <H k="units">Units sold</H><H k="revenue_cents">Revenue</H><H k="gross_profit_cents">Gross profit</H><H k="write_off_units">Expired</H><H k="waste_rate_pct">Waste rate</H>
          <H k="lost_units">Unmet</H><H k="sold_out_days">Sold-out days</H><H k="closing_qty">Closing stock</H></tr></thead>
        <tbody>{rows.map((p) => (<tr key={p.product_id}><td><ProductLink runId={runId} id={p.product_id} name={p.name} /></td><td className="small">{CAT[p.category]}</td><td className="small">{p.policy}</td>
          <td className="n">{num(p.units)}</td><td className="n">{money(p.revenue_cents)}</td><td className="n">{money(p.gross_profit_cents)}</td><td className="n">{num(p.write_off_units)}</td>
          <td className="n">{pct(p.waste_rate_pct)}</td><td className="n">{num(p.lost_units)}</td><td className="n">{p.sold_out_days}</td><td className="n">{num(p.closing_qty)}</td></tr>))}</tbody>
      </table></div></div>
    </div>
  );
}
