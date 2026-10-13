// usage: node scripts/set-submitted.js RUN-ID
const { setSubmittedRunId } = require("../runs");
const id = process.argv[2];
if (!id) { console.error("Usage: node scripts/set-submitted.js RUN-ID"); process.exit(1); }
setSubmittedRunId(id);
console.log("Submitted Run set to", id);
