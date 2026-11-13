// Builds alertbrief-workflow.json from the Code node scripts, then checks it.
const fs = require("fs");
const crypto = require("crypto");
const read = (f) => fs.readFileSync(`${__dirname}/${f}`, "utf8");
const id = () => crypto.randomUUID();

const nodes = [
  {
    parameters: {
      content:
        "## AlertBrief\nTurns raw alerts into a short brief before they reach the on-call engineer: is it real, what happened, what to check first, what else is firing.\n\n**Try it:** click *Test workflow* with **Try sample storm** selected. 37 synthetic alerts become 2 briefed incidents.\n\n**Use it:** point your monitoring tool at the **Alerts in** webhook. Send one alert, an array, or `{ alerts: [...], history: {...} }`.\n\n**Page with the brief:** open **Send to SIGNL4**, replace `YOUR_TEAM_SECRET`, and enable the node.\n\nNothing is configured per customer. Every name and number in a brief is checked against the alerts before it is sent.",
      height: 360,
      width: 420,
    },
    id: id(),
    name: "About AlertBrief",
    type: "n8n-nodes-base.stickyNote",
    typeVersion: 1,
    position: [-260, -300],
  },
  {
    parameters: {
      httpMethod: "POST",
      path: "alertbrief",
      responseMode: "lastNode",
      responseData: "allEntries",
      options: {},
    },
    id: id(),
    name: "Alerts in",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [200, 0],
    webhookId: id(),
  },
  {
    parameters: {},
    id: id(),
    name: "Try sample storm",
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: [200, 200],
  },
  {
    parameters: { jsCode: read("sample-storm-code-node.js") },
    id: id(),
    name: "Sample storm (synthetic)",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [420, 200],
  },
  {
    parameters: { jsCode: read("alertbrief-code-node.js") },
    id: id(),
    name: "AlertBrief",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [660, 100],
  },
  {
    parameters: {
      method: "POST",
      url: "https://connect.signl4.com/webhook/YOUR_TEAM_SECRET",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.signl4) }}",
      options: {},
    },
    id: id(),
    name: "Send to SIGNL4",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [900, 100],
    disabled: true,
    notes: "Posts each brief to your SIGNL4 team webhook. Uses the HTTP node so every X-S4 field (ExternalID for dedup, Service, Status) is passed through as-is.",
  },
];

const link = (to) => ({ main: [[{ node: to, type: "main", index: 0 }]] });
const workflow = {
  name: "AlertBrief: brief alerts before they page",
  nodes,
  connections: {
    "Alerts in": link("AlertBrief"),
    "Try sample storm": link("Sample storm (synthetic)"),
    "Sample storm (synthetic)": link("AlertBrief"),
    AlertBrief: link("Send to SIGNL4"),
  },
  pinData: {},
  settings: { executionOrder: "v1" },
  active: false,
  meta: { templateCredsSetupCompleted: true },
  tags: [],
};

// Structural checks: every connection points at a real node, names unique,
// and the embedded code is the tested code.
const names = new Set(nodes.map((n) => n.name));
if (names.size !== nodes.length) throw new Error("duplicate node names");
for (const [from, c] of Object.entries(workflow.connections)) {
  if (!names.has(from)) throw new Error(`connection from unknown node ${from}`);
  for (const branch of c.main) for (const t of branch) if (!names.has(t.node)) throw new Error(`connection to unknown node ${t.node}`);
}
for (const n of nodes.filter((n) => n.type === "n8n-nodes-base.code")) new Function("$input", n.parameters.jsCode); // parses

fs.writeFileSync(`${__dirname}/alertbrief-workflow.json`, JSON.stringify(workflow, null, 2));
console.log(`wrote alertbrief-workflow.json: ${nodes.length} nodes, ${Object.keys(workflow.connections).length} connections, ${fs.statSync(`${__dirname}/alertbrief-workflow.json`).size} bytes`);
