// Sample data: a synthetic 3am alert storm, shaped like SIGNL4 webhook alerts.
// One database runs out of memory and 30+ alerts cascade from it.
// An unrelated certificate alert arrives in the same window.
// All data is invented. No real system is represented.

const DAY = "2026-11-07";
const t = (hms) => `${DAY}T${hms}Z`;
let ext = 7310;
const A = (time, title, message, host, service, extra = {}) => ({
  Title: title, Message: message, Host: host, "Time (UTC)": t(time),
  "X-S4-Service": service, "X-S4-ExternalID": `INC${ext++}`, "X-S4-Status": "new", ...extra,
});

const alerts = [
  A("03:11:42", "Memory usage 97% on orders-db-01", "mem_used_pct=97 threshold=90 for 5m", "orders-db-01", "Database", { Value: "97", Threshold: "90" }),
  A("03:12:05", "Process killed by OOM killer on orders-db-01", "Out of memory: Killed process 2214 (postgres) on orders-db-01", "orders-db-01", "Database", { Process: "postgres", PID: "2214" }),
  A("03:12:09", "Health check failed: orders-db-01:5432", "TCP connect to orders-db-01:5432 failed", "orders-db-01", "Database"),
];
const api = ["checkout-api-1", "checkout-api-2", "checkout-api-3", "checkout-api-4"];
api.forEach((h, i) => alerts.push(A(`03:12:1${2 + i}`, "Connection refused to orders-db-01:5432", `${h}: dial tcp orders-db-01:5432: connect: connection refused`, h, "Checkout")));
[["03:12:4", 38], ["03:13:4", 41], ["03:14:4", 44]].forEach(([tm, rate]) =>
  api.forEach((h, i) => alerts.push(A(`${tm}${i}`, `HTTP 5xx rate ${rate + i}% on ${h}`, `5xx_rate=${rate + i}% threshold=5%; upstream errors: orders-db-01:5432 connection refused`, h, "Checkout"))));
["03:12:3", "03:13:3", "03:14:3"].forEach((tm) =>
  ["payments-worker-1", "payments-worker-2"].forEach((h, i) => alerts.push(A(`${tm}${i}`, `Job failures on ${h}`, `${h}: could not connect to orders-db-01:5432; 0 of last 50 jobs succeeded`, h, "Payments"))));
[["03:13:05", "6,200"], ["03:14:05", "12,900"], ["03:15:05", "18,400"]].forEach(([tm, d]) =>
  alerts.push(A(tm, `Queue depth ${d} on payments-queue`, `depth=${d} threshold=5,000; consumers payments-worker-1, payments-worker-2 not acknowledging`, "mq-01", "Messaging")));
[["03:13:20", "4.1"], ["03:14:20", "4.6"], ["03:15:20", "4.8"]].forEach(([tm, s]) =>
  alerts.push(A(tm, `p99 latency ${s}s on /checkout`, `p99=${s}s threshold=1.5s; slow upstream checkout-api`, "edge-gw-01", "Edge")));
["03:13:50", "03:14:50", "03:15:50"].forEach((tm) =>
  alerts.push(A(tm, "Checkout synthetic check failed", "POST /checkout returned 502 from 3 of 3 regions; backend checkout-api", "synthetic-monitor", "Edge")));
alerts.push(A("03:13:02", "Health check failed: orders-db-01:5432", "TCP connect to orders-db-01:5432 failed (2nd consecutive)", "orders-db-01", "Database"));
alerts.push(A("03:14:02", "Health check failed: orders-db-01:5432", "TCP connect to orders-db-01:5432 failed (3rd consecutive)", "orders-db-01", "Database"));
alerts.push(A("03:14:15", "TLS certificate expires in 6 days on auth-gw-01", "Certificate CN=auth.internal.example expires 2026-11-13; days_left=6", "auth-gw-01", "Identity", { DaysLeft: "6" }));

// What SIGNL4 already knows about past alerts: how often each fired this
// week, how often people acknowledged it, how often it cleared by itself.
const history = {
  "mem_high|orders-db-01": { fired7d: 2, acked: 2, autoResolvedFast: 0, notes: [] },
  "cert_expiry|auth-gw-01": { fired7d: 1, acked: 0, autoResolvedFast: 0, notes: [] },
};

return [{ json: { alerts, history } }];
