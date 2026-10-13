import { Routes, Route, Navigate, NavLink, Link, useParams, Outlet, useLocation } from "react-router-dom";
import { useData } from "./api";
import { Badge } from "./components/ui.jsx";
import Runs from "./pages/Runs.jsx";
import Report from "./pages/Report.jsx";
import Daily from "./pages/Daily.jsx";
import Assurance from "./pages/Assurance.jsx";
import Model from "./pages/Model.jsx";
import Products from "./pages/Products.jsx";
import ProductTrace from "./pages/ProductTrace.jsx";

function Home() {
  const s = useData("/api/runs");
  if (s.loading) return null;
  if (s.data?.submitted_run_id) return <Navigate to={`/runs/${s.data.submitted_run_id}/report`} replace />;
  return <Navigate to="/runs" replace />;
}

function RunLayout() {
  const { runId } = useParams();
  const loc = useLocation();
  const s = useData("/api/runs");
  const run = s.data?.runs.find((r) => r.run_id === runId);
  return (
    <>
      <div className="runbar">
        <div>
          <span className="muted small">Run </span><span className="mono">{runId}</span>{" "}
          {run?.is_submitted ? <Badge kind="sub">SUBMITTED RUN</Badge> : run && <Badge kind="LOW">development run</Badge>}
        </div>
        <nav className="tabs">
          <NavLink to={`/runs/${runId}/report`}>60-Day Commercial Report</NavLink>
          <NavLink to={`/runs/${runId}/days/1`} className={() => (loc.pathname.includes("/days/") ? "active" : "")}>Daily Reports</NavLink>
          <NavLink to={`/runs/${runId}/assurance`}>Commercial Assurance</NavLink>
          <NavLink to={`/runs/${runId}/model`}>Model Declaration</NavLink>
          <NavLink to={`/runs/${runId}/products`} end={false}>Products</NavLink>
        </nav>
      </div>
      <Outlet />
    </>
  );
}

export default function App() {
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand" style={{ color: "#fff" }}>Autonomous Supermarket <span>· Swanston St / Town Hall, Melbourne CBD</span></Link>
        <span style={{ marginLeft: "auto" }}><Link to="/runs">All simulation runs</Link></span>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/runs" element={<Runs />} />
        <Route path="/runs/:runId" element={<RunLayout />}>
          <Route index element={<Navigate to="report" replace />} />
          <Route path="report" element={<Report />} />
          <Route path="days/:day" element={<Daily />} />
          <Route path="assurance" element={<Assurance />} />
          <Route path="model" element={<Model />} />
          <Route path="products" element={<Products />} />
          <Route path="products/:pid" element={<ProductTrace />} />
        </Route>
      </Routes>
    </>
  );
}
