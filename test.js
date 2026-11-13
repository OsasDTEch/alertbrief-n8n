// Runs the Code node scripts outside n8n with a fake $input, to test the logic.
const fs = require("fs");
const path = require("path");
const run = (file, items) => {
  const code = fs.readFileSync(path.join(__dirname, file), "utf8");
  const $input = { all: () => items };
  return new Function("$input", code)($input);
};
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};

// 1. Storm through the sample node, then AlertBrief
const sample = run("sample-storm-code-node.js", [{ json: {} }]);
const out = run("alertbrief-code-node.js", sample);
const inc = out.map((o) => o.json);
check("storm: 37 alerts in", sample[0].json.alerts.length === 37, `${sample[0].json.alerts.length}`);
check("storm: 2 incidents out", inc.length === 2, `${inc.length}`);
check("storm: root is orders-db-01", inc[0].rootHost === "orders-db-01", inc[0].rootHost);
check("storm: verdict likely real", inc[0].verdict === "Likely real", inc[0].verdict);
check("storm: cert is separate, not urgent", inc[1].rootHost === "auth-gw-01" && inc[1].verdict === "Real, not urgent tonight", `${inc[1].rootHost} ${inc[1].verdict}`);
check("storm: guard blocked nothing", inc.every((i) => i.guard.linesBlocked.length === 0), JSON.stringify(inc.map((i) => i.guard.linesBlocked)));
check("storm: no 'undefined' in text", inc.every((i) => !i.text.includes("undefined")));
check("storm: signl4 payload present", inc.every((i) => i.signl4 && i.signl4.Title && i.signl4["X-S4-ExternalID"]));
console.log("\n--- brief 1 as it would appear on the phone ---\n" + inc[0].text + "\n");
console.log("--- brief 2 ---\n" + inc[1].text + "\n");

// 2. A webhook item with one plain alert (as n8n's Webhook node delivers it)
const single = run("alertbrief-code-node.js", [{ json: { headers: {}, body: { Title: "CPU 92% on batch-worker-03", Message: "cpu_used_pct=92 threshold=85", Host: "batch-worker-03", "Time (UTC)": "2026-11-07T02:03:12Z" } } }]);
check("webhook single alert: 1 incident", single.length === 1, single[0].json.verdict);

// 3. Noise detection from history
const noisy = run("alertbrief-code-node.js", [{ json: { body: { alerts: [{ Title: "CPU 92% on batch-worker-03", Host: "batch-worker-03", "Time (UTC)": "2026-11-07T02:03:12Z" }], history: { "cpu_high|batch-worker-03": { fired7d: 23, acked: 0, autoResolvedFast: 21, fastMins: 4 } } } } }]);
check("noise: verdict likely noise", noisy[0].json.verdict === "Likely noise", noisy[0].json.verdict);

// 4. Lowercase / Prometheus-ish field names
const prom = run("alertbrief-code-node.js", [{ json: { body: [{ alertname: "HighLatency", description: "p99 3.2s", instance: "web-7", startsAt: "2026-11-07T04:00:00Z" }] } }]);
check("lowercase fields: host read", prom[0].json.rootHost === "web-7", prom[0].json.rootHost);

// 5. Guard really blocks: inject a fake line via a crafted alert? Test the guard path directly
const empty = run("alertbrief-code-node.js", [{ json: { body: {} } }]);
check("empty body: returns 1 item without crashing", empty.length === 1);
const none = run("alertbrief-code-node.js", [{ json: { body: [] } }]);
check("no alerts: clear error", !!none[0].json.error, none[0].json.error);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
