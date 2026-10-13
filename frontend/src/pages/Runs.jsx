import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useData, money, num } from "../api";
import { Badge, Loading } from "../components/ui.jsx";

export default function Runs() {
  const [refresh, setRefresh] = useState(0);
  const s = useData(`/api/runs?r=${refresh}`);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState("");
  const [msg, setMsg] = useState("");
  const nav = useNavigate();

  async function startRun() {
    setBusy(true); setMsg("");
    try {
      const body = seed.trim() ? { seed: Number(seed) } : {};
      const r = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setMsg(`Created ${data.run_id} (seed ${data.seed}) in ${data.duration_ms} ms.`);
      setRefresh((x) => x + 1);
      nav(`/runs/${data.run_id}/report`);
    } catch (e) { setMsg("Failed: " + e.message); } finally { setBusy(false); }
  }

  if (!s.data) return <Loading state={s} />;
  return (
    <div className="wrap">
      <h1>Simulation runs</h1>
      <p className="muted">Each run is one complete, frozen 60-day operating history. Runs cannot be edited or deleted. The Submitted Run is the evidence used for assessment; any new run is stored separately.</p>

      {s.data.read_only ? (
        <div className="callout" style={{ marginBottom: 16 }}>This is the read-only online demo, so new runs can't be created here. Run the project locally (see README) to create new runs.</div>
      ) : (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Start a new 60-day run</h3>
        <p className="small muted">Uses the current model configuration and product catalogue. Leave the seed blank for a random seed. Customer behaviour is stochastic, so a new run will not reproduce the Submitted Run's exact figures.</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input placeholder="Seed (optional)" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} style={{ width: 160 }} />
          <button className="btn" onClick={startRun} disabled={busy}>{busy ? "Simulating 60 days…" : "Run simulation"}</button>
          {msg && <span className="small">{msg}</span>}
        </div>
      </div>
      )}

      <div className="card">
        <table>
          <thead><tr><th>Run ID</th><th>Created</th><th className="n">Seed</th><th className="n">Days</th><th className="n">Customers</th><th className="n">Revenue</th><th className="n">Gross profit</th><th className="n">Write-off</th><th></th></tr></thead>
          <tbody>
            {s.data.runs.map((r) => (
              <tr key={r.run_id}>
                <td className="mono"><Link to={`/runs/${r.run_id}/report`}>{r.run_id}</Link> {r.is_submitted && <Badge kind="sub">SUBMITTED</Badge>}</td>
                <td className="small">{new Date(r.created_at).toLocaleString("en-AU")}</td>
                <td className="n mono">{r.seed}</td>
                <td className="n">{r.days_recorded}/{r.days}</td>
                <td className="n">{num(r.customers)}</td>
                <td className="n">{money(r.revenue_cents)}</td>
                <td className="n">{money(r.gross_profit_cents)}</td>
                <td className="n">{money(r.write_off_cents)}</td>
                <td><Link to={`/runs/${r.run_id}/assurance`}>Assurance</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
