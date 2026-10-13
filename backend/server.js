// api - no edit/delete routes, runs can only be added
const express = require("express");
const path = require("path");
const fs = require("fs");
const { createRun, getSubmittedRunId } = require("./runs");
const R = require("./reports");
const { getAssurance } = require("./assurance");

const app = express();
const PORT = process.env.PORT || 3000;
// on a public server set READ_ONLY=true so visitors can't create runs (each one is ~25MB)
const READ_ONLY = process.env.READ_ONLY === "true";
app.use(express.json());

const send = (res, data) => (data ? res.json(data) : res.status(404).json({ error: "Not found" }));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.get("/api/runs", (req, res) => res.json({ submitted_run_id: getSubmittedRunId(), read_only: READ_ONLY, runs: R.listRuns() }));
app.post("/api/runs", (req, res) => {
  if (READ_ONLY) return res.status(403).json({ error: "This is a read-only demo. Run the project locally to create new runs." });
  try {
    const seed = req.body && Number.isInteger(req.body.seed) ? req.body.seed : undefined;
    res.status(201).json(createRun({ seed, label: (req.body && req.body.label) || "Created from web app" }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get("/api/runs/:id/model", (req, res) => send(res, R.getModel(req.params.id)));
app.get("/api/runs/:id/report", (req, res) => send(res, R.getReport(req.params.id)));
app.get("/api/runs/:id/findings", (req, res) => send(res, R.getFindings(req.params.id)));
app.get("/api/runs/:id/assurance", (req, res) => send(res, getAssurance(req.params.id)));
app.get("/api/runs/:id/days/:day", (req, res) => send(res, R.getDaily(req.params.id, Number(req.params.day))));
app.get("/api/runs/:id/products/:pid", (req, res) => send(res, R.getProduct(req.params.id, req.params.pid)));
app.get("/api/runs/:id/transactions/:tx", (req, res) => send(res, R.getTransaction(req.params.id, req.params.tx)));

// serve the built React app
const dist = path.join(__dirname, "..", "frontend", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (req, res) => (req.path.startsWith("/api/") ? res.status(404).json({ error: "Not found" }) : res.sendFile(path.join(dist, "index.html"))));
}

app.listen(PORT, () => console.log(`Autonomous Supermarket running at http://localhost:${PORT}${READ_ONLY ? " (read-only)" : ""}`));
