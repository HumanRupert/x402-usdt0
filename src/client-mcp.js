/**
 * MCP Server with x402 Payment Integration
 *
 * Creates an MCP server that exposes a tool for fetching data from an
 * x402-protected weather endpoint on Plasma chain using USDT0.
 *
 * Tool calls are logged to mcp-calls.json for the dashboard.
 *
 * Required environment variables:
 * - MNEMONIC: BIP-39 mnemonic seed phrase (derived account must have USDT0 balance)
 * - RESOURCE_SERVER_URL: The base URL of the resource server (default: http://localhost:4021)
 * - ENDPOINT_PATH: The endpoint path (default: /weather)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "dotenv";
import { readFileSync, writeFileSync } from "fs";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";

config();

const mnemonic = process.env.MNEMONIC;
const baseURL = process.env.RESOURCE_SERVER_URL || "http://localhost:4021";
const endpointPath = process.env.ENDPOINT_PATH || "/weather";
const PRICE_USDT0 = 0.0001; // 100 units / 1e6

const LOG_PATH = new URL("../mcp-calls.json", import.meta.url).pathname;

if (!mnemonic) {
  throw new Error("MNEMONIC environment variable is required");
}

// ---------- Call logging ----------

function logCall(entry) {
  let calls = [];
  try {
    calls = JSON.parse(readFileSync(LOG_PATH, "utf-8"));
    if (!Array.isArray(calls)) calls = [];
  } catch {}
  calls.push(entry);
  writeFileSync(LOG_PATH, JSON.stringify(calls, null, 2));
}

// ---------- x402 client ----------

async function createClient() {
  const evmSigner = await new WalletManagerEvm(mnemonic, {
    provider: "https://rpc.plasma.to",
  }).getAccount();

  const client = new x402Client();
  registerExactEvmScheme(client, { signer: evmSigner });

  return wrapFetchWithPayment(fetch, client);
}

// ---------- MCP server ----------

async function main() {
  const fetchWithPayment = await createClient();

  const server = new McpServer({
    name: "x402 Weather Client",
    version: "1.0.0",
  });

  server.tool(
    "get-weather",
    "Get weather data from the x402-protected weather endpoint",
    {},
    async () => {
      const entry = {
        tool: "get-weather",
        amount: PRICE_USDT0,
        timestamp: new Date().toISOString(),
        status: "failed",
      };

      try {
        const res = await fetchWithPayment(`${baseURL}${endpointPath}`);
        const data = await res.json();

        if (res.ok) {
          entry.status = "success";
        }

        logCall(entry);

        return {
          content: [{ type: "text", text: JSON.stringify(data) }],
        };
      } catch (err) {
        entry.error = err.message;
        logCall(entry);
        throw err;
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
