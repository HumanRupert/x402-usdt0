import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const cwd = process.cwd();

const httpInstructions = `
  HTTP Demo Setup
  ===============

  1. Copy and fill in your environment variables:
     cp .env.example .env

  2. Start the x402 server (terminal 1):
     npm run server

  3. Start the demo UI (terminal 2):
     npm run demo:http

  4. Open http://localhost:5173
`;

const mcpInstructions = `
  MCP Demo Setup
  ==============

  1. Copy and fill in your environment variables:
     cp .env.example .env

  2. Start the x402 server (terminal 1):
     npm run server

  3. Start the MCP dashboard (terminal 2):
     npm run dashboard

  4. Add to your Claude Desktop config at:
     ~/Library/Application Support/Claude/claude_desktop_config.json

     {
       "mcpServers": {
         "x402-weather": {
           "command": "node",
           "args": ["${cwd}/demo/mcp/server.js"],
           "env": {
             "MNEMONIC": "<your mnemonic>",
             "RESOURCE_SERVER_URL": "http://localhost:4021"
           }
         }
       }
     }

  5. Restart Claude Desktop

  6. Open http://localhost:5174 for the dashboard
     (or npm run dashboard:ui for dev mode)
`;

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });

  console.log(`
  x402 USDT0 Demo Setup
  =====================

  1) HTTP  - Payment flow visualization in the browser
  2) MCP   - Connect Claude Desktop to a paid weather tool
  `);

  const choice = await rl.question("  Choice (1 or 2): ");
  rl.close();

  if (choice.trim() === "1") {
    console.log(httpInstructions);
  } else if (choice.trim() === "2") {
    console.log(mcpInstructions);
  } else {
    console.log("\n  Invalid choice. Run again and pick 1 or 2.\n");
  }
}

main();
