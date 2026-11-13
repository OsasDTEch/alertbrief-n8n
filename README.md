# AlertBrief for n8n

An n8n workflow that briefs alerts before they page someone. It sits between your monitoring tool and SIGNL4:

```
Monitoring tool  →  Alerts in (webhook)  →  AlertBrief  →  Send to SIGNL4
```

For every incident the engineer gets one page instead of many, with:

* **Is it real?** From the alert and its history: hard failures, how many other alerts point at the same host, and how often people acknowledged this alert before.
* **What happened**, in order, taken from the alerts.
* **Check first**: guidance for that alert type, filled only with values from the alert.
* **Related alerts**, grouped by service.

Nothing is configured per customer. Alerts are grouped only by host names and times found in the alerts. Every name and number in a brief is checked against the source data, and a line that cannot be traced is removed before the brief is sent.

## Import it

1. Start n8n (`npx n8n`, then open http://localhost:5678), or use n8n Cloud.
2. **Workflows → Import from file** and choose `alertbrief-workflow.json`.

## Try it with the sample storm

Click **Test workflow**. The **Try sample storm** trigger sends 37 synthetic alerts: a database runs out of memory and 31 alerts cascade from it, plus an unrelated certificate warning. Open the **AlertBrief** node's output to see 2 incidents, each with a `text` field (the brief as it would appear on the phone) and a `signl4` field (the payload that gets sent).

## Send it your own alerts

Click the **Alerts in** node, then **Listen for test event**, and post an alert to the test URL. From Windows PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:5678/webhook-test/alertbrief" -ContentType "application/json" -Body '{"Title":"Disk usage 94% on /var/log on search-index-02","Message":"disk_used_pct=94 threshold=90","Host":"search-index-02","Time (UTC)":"2026-11-07T02:47:31Z","X-S4-Service":"Search"}'
```

The response is the brief. The webhook accepts:

* one alert: `{ "Title": ..., "Host": ..., ... }`
* several alerts: `[ {...}, {...} ]`
* alerts with history: `{ "alerts": [...], "history": { "cpu_high|batch-worker-03": { "fired7d": 23, "acked": 0, "autoResolvedFast": 21, "fastMins": 4 } } }`

SIGNL4 field names (`Title`, `Message`, `Host`, `Time (UTC)`, `X-S4-Service`) are read first. Common lowercase names (`title`, `summary`, `alertname`, `description`, `instance`, `startsAt`) also work.

## Page with the brief

Open **Send to SIGNL4**, replace `YOUR_TEAM_SECRET` with your SIGNL4 team secret, and enable the node. Each incident becomes one SIGNL4 alert. `X-S4-ExternalID` is set per incident so repeats update the same alert instead of paging again.

## Files

| File | What it is |
|---|---|
| `alertbrief-workflow.json` | The workflow to import |
| `alertbrief-code-node.js` | The AlertBrief logic, as it runs in the Code node |
| `sample-storm-code-node.js` | The synthetic storm |
| `test.js` | Tests for the logic: `node test.js` |
| `build.js` | Rebuilds the workflow from the two code files: `node build.js` |

All sample data is synthetic. No real system is represented.

Built by Omons Wisdom (Osas) · github.com/OsasDTEch · omonswisdom.ict@gmail.com
