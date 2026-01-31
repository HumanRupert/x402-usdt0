# x402 USDT0 Demo

x402 payment protocol demo on Plasma blockchain using USDT0. Includes an HTTP payment flow visualization and an MCP integration for Claude Desktop.

## Quick Start

```bash
npm install
npm run setup
```

The setup wizard will guide you through either the HTTP or MCP demo.

## Setup

Copy the environment file and fill in your credentials:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `MNEMONIC` | BIP-39 mnemonic (derived account must have USDT0 on Plasma) |
| `PAY_TO_ADDRESS` | Address to receive payments |

## HTTP Demo

Visualizes the full x402 payment flow in the browser with real on-chain transactions.

```bash
npm run server       # Terminal 1: x402 server on :4021
npm run demo:http    # Terminal 2: React UI on :5173
```

Open http://localhost:5173 and click "Access Weather App" to trigger a real payment.

### Architecture

```
Client → Server (facilitator in-process) → Plasma Blockchain
```

The server uses a verify-first middleware: it verifies the payment, sends the response immediately, then settles on-chain asynchronously.

## MCP Demo

Connects Claude Desktop to an x402-protected weather endpoint via MCP.

### 1. Start the server and dashboard

```bash
npm run server       # Terminal 1: x402 server on :4021
npm run dashboard    # Terminal 2: API server on :4030
npm run dashboard:ui # Terminal 3: React dashboard on :5174 (optional, for dev)
```

### 2. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "x402-weather": {
      "command": "node",
      "args": ["<absolute-path-to-repo>/demo/mcp/server.js"],
      "env": {
        "MNEMONIC": "<your mnemonic>",
        "RESOURCE_SERVER_URL": "http://localhost:4021"
      }
    }
  }
}
```

### 3. Use it

Restart Claude Desktop and ask it to "get the weather". Each tool call costs 0.0001 USDT0. View call history and balance at http://localhost:5174.

## Project Structure

```
x402/
  config.js            Shared constants (USDT0 address, RPC, network)
  middleware.js         Verify-first payment middleware
  server.js            Main server with in-process facilitator + SSE
  server-external.js   Server using external facilitator via HTTP
  facilitator.js       Standalone facilitator service
  client.js            CLI client for paid requests

demo/
  http/                Payment flow visualization (React + Vite)
  mcp/
    server.js          MCP stdio server for Claude Desktop
    dashboard.js       Express API for balance and call history
    src/               React dashboard UI

bin/
  setup.js             CLI setup wizard
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run setup` | Interactive setup wizard |
| `npm run server` | Start x402 server (in-process facilitator) |
| `npm run server:external` | Start server with external facilitator |
| `npm run facilitator` | Start standalone facilitator |
| `npm run client` | Make a paid request from CLI |
| `npm run client:mcp` | Start MCP stdio server |
| `npm run demo:http` | Start HTTP demo UI (dev) |
| `npm run dashboard` | Start MCP dashboard API |
| `npm run dashboard:ui` | Start MCP dashboard UI (dev) |

## Network

- Chain: Plasma (chainId 9745)
- RPC: https://rpc.plasma.to
- USDT0: `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb`
- Explorer: https://explorer.plasma.to
