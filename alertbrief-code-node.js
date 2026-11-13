// AlertBrief for n8n (Code node, mode: Run Once for All Items)
//
// Input: one or more items. Each item can be:
//   - a webhook item whose json.body is one alert, an array of alerts,
//     or { alerts: [...], history: {...} }
//   - an item whose json is itself an alert
// Alerts use the SIGNL4 webhook shape when they can (Title, Message, Host,
// "Time (UTC)", X-S4-Service) but common lowercase names also work.
//
// Output: one item per incident, with the brief and a ready-to-send
// SIGNL4 payload in json.signl4.
//
// Rules: nothing is configured per customer. Incidents are grouped only
// by host names and timestamps found in the alerts. Every name and number
// in the brief is checked against the source data; a line that fails the
// check is removed before the brief leaves this node.

const WINDOW_MINUTES = 15;

// ---------- 1. Read input ----------
let alerts = [];
let history = {};
for (const item of $input.all()) {
  const j = item.json || {};
  const body = j.body !== undefined ? j.body : j;
  if (Array.isArray(body)) alerts.push(...body);
  else if (body && Array.isArray(body.alerts)) {
    alerts.push(...body.alerts);
    Object.assign(history, body.history || {});
  } else if (body && typeof body === "object") alerts.push(body);
}

const pick = (a, ...keys) => {
  for (const k of keys) if (a[k] !== undefined && a[k] !== null && a[k] !== "") return String(a[k]);
  return "";
};
alerts = alerts
  .filter((a) => a && typeof a === "object")
  .map((a) => {
    const title = pick(a, "Title", "title", "summary", "alertname", "name") || "Untitled alert";
    const message = pick(a, "Message", "message", "description", "text");
    const host = pick(a, "Host", "host", "instance", "hostname", "resource") || pick(a, "X-S4-Service", "service") || "unknown-host";
    const time = pick(a, "Time (UTC)", "time", "timestamp", "startsAt", "date") || new Date().toISOString();
    const service = pick(a, "X-S4-Service", "service", "Service", "job") || "General";
    return { ...a, Title: title, Message: message, Host: host, "Time (UTC)": time, "X-S4-Service": service };
  })
  .sort((x, y) => Date.parse(x["Time (UTC)"]) - Date.parse(y["Time (UTC)"]));

if (alerts.length === 0) {
  return [{ json: { error: "No alerts found in the input. Send one alert, an array of alerts, or { alerts: [...] }." } }];
}

// ---------- 2. Signatures: generic per alert type, never per customer ----------
const SIGS = [
  { id: "oom_killed", re: /OOM|out of memory/i, name: "Process killed for memory", severe: true },
  { id: "health_fail", re: /health ?check failed|is down|unreachable/i, name: "Health check failing", severe: true },
  { id: "conn_refused", re: /connection refused|could not connect|timed? ?out connecting/i, name: "Connection refused", severe: true },
  { id: "mem_high", re: /memory usage|mem(ory)? high/i, name: "Memory high" },
  { id: "http_5xx", re: /5xx|error rate/i, name: "Error rate high" },
  { id: "job_fail", re: /job failures|jobs? failing/i, name: "Jobs failing" },
  { id: "queue_backlog", re: /queue depth|backlog|lag/i, name: "Queue backing up" },
  { id: "latency", re: /latency|slow response|p99|p95/i, name: "Latency high" },
  { id: "synthetic", re: /synthetic check|uptime check/i, name: "User journey failing" },
  { id: "disk_full", re: /disk usage|disk (space|full)|filesystem/i, name: "Disk filling" },
  { id: "cpu_high", re: /\bCPU\b/i, name: "CPU high" },
  { id: "cert_expiry", re: /certificate expires|cert(ificate)? expir/i, name: "Certificate expiring" },
];
const sigOf = (a) => SIGS.find((s) => s.re.test(a.Title)) || SIGS.find((s) => s.re.test(a.Message)) || { id: "other", name: "Other" };

// Guidance per signature. {placeholders} are filled only from the alert;
// a line whose placeholder has no value is dropped, never guessed.
const GUIDANCE = {
  oom_killed: ["Check whether {Process} has restarted on {host}.", "Look at what was using memory on {host} just before {time} UTC. The kernel log lists the largest processes at the moment of the kill."],
  health_fail: ["Confirm {host} is reachable and its main process is running."],
  conn_refused: ["Check the service the alert says it cannot reach before restarting the caller."],
  mem_high: ["See which process on {host} is growing, and whether this matches a deploy or a scheduled job."],
  http_5xx: ["Check the upstream named in the error before scaling or restarting {host}."],
  job_fail: ["Read the first failed job's error on {host}; later failures are usually the same cause."],
  queue_backlog: ["Check that the consumers are alive before adding more of them."],
  latency: ["Find the slow upstream first; latency alerts are usually a symptom."],
  synthetic: ["Treat this as customer facing: the user journey is failing, not only a metric."],
  disk_full: ["Find what is growing on {host} (logs are the usual suspect) and whether rotation ran."],
  cpu_high: ["Check whether this matches a scheduled job on {host} before acting."],
  cert_expiry: ["Renew before the expiry date. No action is needed tonight."],
  other: ["Start with the earliest alert on {host}; later alerts are often fallout."],
};

// ---------- 3. Correlate into incidents ----------
const hosts = new Set(alerts.map((a) => a.Host));
const mentions = alerts.map((a) => {
  const text = `${a.Title} ${a.Message}`;
  const out = new Set();
  for (const h of hosts) {
    if (h === a.Host) continue;
    if (text.includes(h)) { out.add(h); continue; }
    const fam = h.replace(/-\d+$/, "");
    if (fam !== h && new RegExp(`\\b${fam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b(?!-\\d)`).test(text)) out.add(h);
  }
  return out;
});
const ts = alerts.map((a) => Date.parse(a["Time (UTC)"]) || 0);
const parent = alerts.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
for (let i = 0; i < alerts.length; i++) {
  for (let j = i + 1; j < alerts.length; j++) {
    if (Math.abs(ts[i] - ts[j]) > WINDOW_MINUTES * 60000) continue;
    const linked = alerts[i].Host === alerts[j].Host || mentions[i].has(alerts[j].Host) || mentions[j].has(alerts[i].Host);
    if (linked) parent[find(i)] = find(j);
  }
}
const groups = new Map();
alerts.forEach((a, i) => {
  const r = find(i);
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(i);
});

// ---------- 4. Brief each incident ----------
const hhmm = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toISOString().slice(11, 19);
};
const onHost = (title, host) => (title.includes(host) ? title : `${title} on ${host}`);
const fill = (tpl, vals) => {
  let missing = false;
  const out = tpl.replace(/\{(\w+)\}/g, (_, k) => {
    if (vals[k] === undefined || vals[k] === "") { missing = true; return ""; }
    return vals[k];
  });
  return missing ? null : out;
};

function briefFor(idx) {
  const al = idx.map((i) => alerts[i]);
  const score = new Map();
  idx.forEach((i) => mentions[i].forEach((h) => score.set(h, (score.get(h) || 0) + 1)));
  const groupHosts = [...new Set(al.map((a) => a.Host))];
  groupHosts.sort((x, y) => (score.get(y) || 0) - (score.get(x) || 0));
  const root = groupHosts[0];
  const rootAlerts = al.filter((a) => a.Host === root);
  const main = rootAlerts[0];
  const mainSig = sigOf(main);
  const namers = idx.filter((i) => mentions[i].has(root)).map((i) => alerts[i]);
  const namerServices = new Set(namers.map((a) => a["X-S4-Service"]));
  const services = new Set(al.map((a) => a["X-S4-Service"]));
  const derived = new Set();
  const D = (v) => { derived.add(String(v)); return v; };

  const h = history[`${mainSig.id}|${root}`] || history[mainSig.id] || null;
  const severe = rootAlerts.some((a) => sigOf(a).severe);
  const daysMatch = `${main.Title} ${main.Message}`.match(/(\d+)\s*days?/i);
  const daysLeft = main.DaysLeft || (mainSig.id === "cert_expiry" && daysMatch ? daysMatch[1] : "");

  const isReal = [];
  let verdict;
  if (h && h.fired7d >= 10 && (h.autoResolvedFast || 0) / h.fired7d >= 0.8 && !h.acked && !severe) {
    verdict = "Likely noise";
    isReal.push(`This alert fired ${h.fired7d} times in the last 7 days. ${h.autoResolvedFast} of those cleared on their own and nobody acknowledged any of them.`);
  } else if (daysLeft) {
    verdict = "Real, not urgent tonight";
    isReal.push(`Real: it expires in ${daysLeft} days. Nothing is broken yet.`);
  } else if (severe || namers.length) {
    verdict = "Likely real";
    const hard = rootAlerts.find((a) => sigOf(a).severe);
    if (hard) isReal.push(`${onHost(hard.Title, root)} is a hard failure, not a threshold that might be jittering.`);
    if (namers.length) isReal.push(`${D(namers.length)} alerts from ${D(namerServices.size)} other services independently name ${root}.`);
    if (h && h.acked) isReal.push(`This alert fired ${h.fired7d} times in the last 7 days and people acknowledged it ${h.acked} times.`);
  } else {
    verdict = "Needs a look";
    isReal.push(h ? `This alert fired ${h.fired7d} times in the last 7 days.` : "No history for this alert yet, so treat it as real until it proves otherwise.");
  }

  const headline = namers.length
    ? `${D(al.length)} alerts across ${D(services.size)} services trace back to ${root}. First sign: ${main.Title} at ${hhmm(main["Time (UTC)"])} UTC.`
    : al.length > 1
      ? `${D(al.length)} alerts on ${root}, starting with ${main.Title} at ${hhmm(main["Time (UTC)"])} UTC.`
      : `${onHost(main.Title, root)} at ${hhmm(main["Time (UTC)"])} UTC.`;

  const whatHappened = rootAlerts.slice(0, 4).map((a) => `${hhmm(a["Time (UTC)"])} UTC: ${a.Title}${a.Message ? `. ${a.Message}` : ""}`);
  if (h && h.notes && h.notes.length) whatHappened.push(`Last resolution note on this alert: "${h.notes[0]}".`);

  // Hard failures first, each filled from its own alert's fields and time
  const checkFirst = [];
  const firstBySig = new Map();
  rootAlerts.forEach((a) => { const s = sigOf(a); if (!firstBySig.has(s.id)) firstBySig.set(s.id, { s, a }); });
  const ordered = [...firstBySig.values()].sort((x, y) => (y.s.severe ? 1 : 0) - (x.s.severe ? 1 : 0));
  for (const { s, a } of ordered) {
    const vals = { host: root, time: hhmm(a["Time (UTC)"]), ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, String(v)])) };
    for (const tpl of GUIDANCE[s.id] || []) {
      const line = fill(tpl, vals);
      if (line && !checkFirst.includes(line)) checkFirst.push(line);
    }
  }
  if (namers.length) checkFirst.push(`Fix ${root} first. The ${D(al.length - rootAlerts.length)} downstream alerts should clear on their own once it recovers.`);
  if (verdict === "Likely noise" && h.fastMins) checkFirst.unshift(`If it is still firing in ${h.fastMins} minutes, treat it as real.`);

  const relatedCounts = new Map();
  al.forEach((a) => {
    const k = `${a["X-S4-Service"]} · ${sigOf(a).name}`;
    relatedCounts.set(k, (relatedCounts.get(k) || 0) + 1);
  });
  const related = [...relatedCounts.entries()].map(([k, n]) => ({ group: k, count: n }));
  [...relatedCounts.values()].forEach((n) => D(n));

  // ---------- 5. Fabrication guard ----------
  const source = JSON.stringify(al) + JSON.stringify(h || {});
  const FACT = /\b\d[\d,.:]*%?|\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b|\/[a-z0-9_/.-]+/gi;
  const blocked = [];
  let checked = 0;
  const traced = (line) => {
    const bad = (line.match(FACT) || [])
      .map((f) => f.replace(/[.,:]$/, ""))
      .filter(Boolean)
      .filter((f) => {
        const bare = f.replace(/%$/, "");
        return !(source.includes(f) || source.includes(bare) || derived.has(f) || derived.has(bare) || /^\d{2}:\d{2}:\d{2}$/.test(f) && source.includes(f));
      });
    checked += (line.match(FACT) || []).length;
    if (bad.length) blocked.push({ line, untraced: bad });
    return bad.length === 0;
  };
  const clean = (arr) => arr.filter(traced);
  const out = {
    incidentId: `alertbrief-${root}-${main["Time (UTC)"]}`,
    verdict,
    headline: traced(headline) ? headline : `${D(al.length)} alerts, earliest on ${root}.`,
    isReal: clean(isReal),
    whatHappened: clean(whatHappened),
    checkFirst: clean(checkFirst),
    related,
    rootHost: root,
    alertCount: al.length,
    services: [...services],
    startedUtc: main["Time (UTC)"],
    lastUtc: al[al.length - 1]["Time (UTC)"],
    guard: { factsChecked: checked, linesBlocked: blocked },
  };

  out.text = [
    `${verdict.toUpperCase()} · ${al.length} alert${al.length === 1 ? "" : "s"} · root ${root}`,
    out.headline,
    "",
    "Is it real?",
    ...out.isReal.map((l) => `- ${l}`),
    "",
    "What happened",
    ...out.whatHappened.map((l) => `- ${l}`),
    "",
    "Check first",
    ...out.checkFirst.map((l, i) => `${i + 1}. ${l}`),
    ...(al.length > 1 ? ["", "Related", ...related.map((r) => `- ${r.group}: ${r.count}`)] : []),
  ].join("\n");

  out.signl4 = {
    Title: `[${verdict}] ${out.headline}`.slice(0, 250),
    Message: out.text,
    "X-S4-Service": main["X-S4-Service"],
    "X-S4-ExternalID": out.incidentId,
    "X-S4-Status": "new",
  };
  return out;
}

const incidents = [...groups.values()].map(briefFor).sort((a, b) => b.alertCount - a.alertCount);
return incidents.map((json) => ({ json }));
