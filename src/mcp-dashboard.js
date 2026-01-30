/**
 * MCP Client Dashboard
 *
 * Serves a minimal dashboard showing:
 * - Current USDT0 balance on Plasma for the wallet
 * - Table of past MCP tool calls (tool, amount, status)
 *
 * Tool call history is stored in a JSON file written by client-mcp.js.
 */

import { config } from "dotenv";
import express from "express";
import cors from "cors";
import { readFileSync, existsSync } from "fs";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";

config();

const PORT = process.env.DASHBOARD_PORT || 4030;
const MNEMONIC = process.env.MNEMONIC;
const USDT0_ADDRESS = "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb";
const LOG_PATH = new URL("../mcp-calls.json", import.meta.url).pathname;

if (!MNEMONIC) {
  console.error("MNEMONIC environment variable is required");
  process.exit(1);
}

const walletAccount = await new WalletManagerEvm(MNEMONIC, {
  provider: "https://rpc.plasma.to",
}).getAccount();

console.log(`Dashboard wallet: ${walletAccount.address}`);

const app = express();
app.use(cors());

// ---------- API ----------

app.get("/api/balance", async (req, res) => {
  try {
    const raw = await walletAccount.getTokenBalance(USDT0_ADDRESS);
    const balance = Number(raw) / 1e6;
    res.json({ address: walletAccount.address, balance, raw: raw.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/calls", (req, res) => {
  try {
    if (!existsSync(LOG_PATH)) return res.json([]);
    const data = JSON.parse(readFileSync(LOG_PATH, "utf-8"));
    res.json(Array.isArray(data) ? data : []);
  } catch {
    res.json([]);
  }
});

// ---------- Dashboard HTML ----------

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(dashboardHTML());
});

app.listen(PORT, () => {
  console.log(`MCP Dashboard running on http://localhost:${PORT}`);
});

function dashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>MCP Client Dashboard</title>
<style>
:root {
  --bg-primary: #0a0a0f;
  --bg-secondary: #12121a;
  --bg-card: #16161f;
  --bg-tertiary: #1a1a24;
  --text-primary: #ffffff;
  --text-secondary: #a0a0b0;
  --text-muted: #606070;
  --accent-blue: #3b82f6;
  --accent-green: #22c55e;
  --accent-purple: #a855f7;
  --accent-red: #ef4444;
  --accent-yellow: #f59e0b;
  --border-color: #2a2a3a;
  --border-radius: 12px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
}

.shell {
  max-width: 960px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

header {
  margin-bottom: 2rem;
}

header h1 {
  font-size: 1.5rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

header .logo {
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
  color: white;
  padding: 0.25rem 0.75rem;
  border-radius: 6px;
  font-weight: 700;
  font-size: 1rem;
}

header .subtitle {
  color: var(--text-muted);
  font-size: 0.875rem;
  margin-top: 0.25rem;
}

/* Balance Card */
.balance-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  padding: 1.5rem;
  margin-bottom: 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}

.balance-left {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.balance-label {
  font-size: 0.875rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.balance-value {
  font-size: 2rem;
  font-weight: 700;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.balance-value .currency {
  font-size: 1rem;
  color: var(--text-secondary);
  font-weight: 500;
  margin-left: 0.5rem;
}

.wallet-addr {
  font-size: 0.75rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--text-muted);
  margin-top: 0.25rem;
}

.balance-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
}

.chain-badge {
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  background: rgba(168, 85, 247, 0.15);
  color: var(--accent-purple);
}

.refresh-btn {
  padding: 0.4rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 150ms ease;
}

.refresh-btn:hover {
  background: var(--bg-card);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

/* Summary row */
.summary-row {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.summary-stat {
  flex: 1;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  padding: 1rem 1.25rem;
}

.summary-stat .stat-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.summary-stat .stat-value {
  font-size: 1.25rem;
  font-weight: 600;
  margin-top: 0.25rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.stat-value.green { color: var(--accent-green); }
.stat-value.red { color: var(--accent-red); }
.stat-value.blue { color: var(--accent-blue); }

/* Table */
.table-section {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  overflow: hidden;
}

.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
}

.table-header h2 {
  font-size: 1rem;
  font-weight: 600;
}

table {
  width: 100%;
  border-collapse: collapse;
}

thead th {
  text-align: left;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-tertiary);
}

tbody td {
  padding: 0.75rem 1.25rem;
  font-size: 0.875rem;
  border-bottom: 1px solid var(--border-color);
}

tbody tr:last-child td {
  border-bottom: none;
}

tbody tr:hover {
  background: var(--bg-tertiary);
}

.td-tool {
  font-weight: 600;
}

.td-amount {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--accent-yellow);
}

.td-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0.2rem 0.6rem;
  border-radius: 20px;
}

.td-status.success {
  background: rgba(34, 197, 94, 0.15);
  color: var(--accent-green);
}

.td-status.failed {
  background: rgba(239, 68, 68, 0.15);
  color: var(--accent-red);
}

.td-time {
  font-size: 0.8rem;
  color: var(--text-muted);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.empty-state {
  padding: 3rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.loading {
  opacity: 0.5;
}

@media (max-width: 640px) {
  .balance-card { flex-direction: column; align-items: flex-start; }
  .balance-right { align-items: flex-start; }
  .summary-row { flex-direction: column; }
}
</style>
</head>
<body>
<div class="shell">
  <header>
    <h1><span class="logo">x402</span> MCP Client Dashboard</h1>
    <p class="subtitle">USDT0 on Plasma &middot; Tool call history</p>
  </header>

  <div class="balance-card">
    <div class="balance-left">
      <span class="balance-label">USDT0 Balance</span>
      <div class="balance-value" id="balance"><span class="loading">--</span></div>
      <div class="wallet-addr" id="addr">loading...</div>
    </div>
    <div class="balance-right">
      <span class="chain-badge">Plasma &middot; 9745</span>
      <button class="refresh-btn" onclick="load()">Refresh</button>
    </div>
  </div>

  <div class="summary-row">
    <div class="summary-stat">
      <div class="stat-label">Total Calls</div>
      <div class="stat-value blue" id="total-calls">--</div>
    </div>
    <div class="summary-stat">
      <div class="stat-label">Successful</div>
      <div class="stat-value green" id="success-calls">--</div>
    </div>
    <div class="summary-stat">
      <div class="stat-label">Failed</div>
      <div class="stat-value red" id="failed-calls">--</div>
    </div>
    <div class="summary-stat">
      <div class="stat-label">Total Spent</div>
      <div class="stat-value" id="total-spent" style="color:var(--accent-yellow)">--</div>
    </div>
  </div>

  <div class="table-section">
    <div class="table-header">
      <h2>Tool Call History</h2>
    </div>
    <table>
      <thead>
        <tr>
          <th>Tool</th>
          <th>Amount</th>
          <th>Status</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody id="calls-body">
        <tr><td colspan="4" class="empty-state">Loading...</td></tr>
      </tbody>
    </table>
  </div>
</div>

<script>
async function load() {
  try {
    const [balRes, callsRes] = await Promise.all([
      fetch('/api/balance'), fetch('/api/calls')
    ]);
    const bal = await balRes.json();
    const calls = await callsRes.json();

    document.getElementById('balance').innerHTML =
      bal.balance.toFixed(6) + '<span class="currency">USDT0</span>';
    document.getElementById('addr').textContent = bal.address;

    const ok = calls.filter(c => c.status === 'success').length;
    const fail = calls.filter(c => c.status === 'failed').length;
    const spent = calls
      .filter(c => c.status === 'success')
      .reduce((s, c) => s + (c.amount || 0), 0);

    document.getElementById('total-calls').textContent = calls.length;
    document.getElementById('success-calls').textContent = ok;
    document.getElementById('failed-calls').textContent = fail;
    document.getElementById('total-spent').textContent = spent.toFixed(6) + ' USDT0';

    const tbody = document.getElementById('calls-body');
    if (!calls.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No tool calls yet. Run client:mcp to see data here.</td></tr>';
      return;
    }
    tbody.innerHTML = calls.slice().reverse().map(c => {
      const statusClass = c.status === 'success' ? 'success' : 'failed';
      const dot = c.status === 'success' ? '\\u2713' : '\\u2717';
      const time = new Date(c.timestamp).toLocaleString();
      const amount = c.amount != null ? c.amount.toFixed(6) : '--';
      return '<tr>'
        + '<td class="td-tool">' + esc(c.tool) + '</td>'
        + '<td class="td-amount">' + amount + ' USDT0</td>'
        + '<td><span class="td-status ' + statusClass + '">' + dot + ' ' + c.status + '</span></td>'
        + '<td class="td-time">' + time + '</td>'
        + '</tr>';
    }).join('');
  } catch (e) {
    console.error(e);
  }
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

load();
setInterval(load, 5000);
</script>
</body>
</html>`;
}
