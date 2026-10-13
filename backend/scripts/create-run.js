// usage: node scripts/create-run.js [seed] [--submit]
const { createRun, setSubmittedRunId } = require("../runs");
const args = process.argv.slice(2);
const seedArg = args.find((a) => /^\d+$/.test(a));
const r = createRun({ seed: seedArg ? Number(seedArg) : undefined, label: "CLI run" });
console.log(`Created ${r.run_id} (seed ${r.seed}) in ${r.duration_ms} ms`);
if (args.includes("--submit")) { setSubmittedRunId(r.run_id); console.log("Marked as Submitted Run"); }
