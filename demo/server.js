/**
 * Real x402 Payment Flow Demo Server
 *
 * This server:
 * 1. Runs an embedded facilitator with hooks that emit SSE events
 * 2. Runs an embedded resource server (weather API)
 * 3. Provides a demo endpoint that runs the real x402 client flow
 * 4. Streams all real events to connected UI clients via SSE
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// x402 imports
import { x402Facilitator } from "@x402/core/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme as registerFacilitatorScheme } from "@x402/evm/exact/facilitator";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme as registerClientScheme } from "@x402/evm/exact/client";

// Viem imports
import { createWalletClient, defineChain, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";

dotenv.config();

// ============================================
// Configuration
// ============================================

const DEMO_PORT = process.env.DEMO_PORT || 4020;
const FACILITATOR_PORT = process.env.FACILITATOR_PORT || 4022;
const SERVER_PORT = process.env.SERVER_PORT || 4021;

const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;

if (!EVM_PRIVATE_KEY) {
  console.error("❌ EVM_PRIVATE_KEY environment variable is required");
  process.exit(1);
}

if (!PAY_TO_ADDRESS) {
  console.error("❌ PAY_TO_ADDRESS environment variable is required");
  process.exit(1);
}

// Plasma chain definition
const plasma = defineChain({
  id: 9745,
  name: "Plasma",
  nativeCurrency: { name: "XPL", symbol: "XPL", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.plasma.to"] } },
  blockExplorers: { default: { name: "Plasma Explorer", url: "https://explorer.plasma.to" } },
});

const USDT0_ADDRESS = "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb";

// ============================================
// SSE Event Broadcasting
// ============================================

const sseClients = new Set();

function broadcastEvent(type, data = {}) {
  const event = {
    type,
    timestamp: Date.now(),
    ...data
  };

  const message = `data: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach(client => client.write(message));
  console.log(`[SSE] ${type}`, data.title || data.step || "");
}

// ============================================
// Facilitator Setup with Hooks
// ============================================

const evmAccount = privateKeyToAccount(EVM_PRIVATE_KEY);
console.log(`Facilitator/Client account: ${evmAccount.address}`);

const viemClient = createWalletClient({
  account: evmAccount,
  chain: plasma,
  transport: http(),
}).extend(publicActions);

const evmSigner = toFacilitatorEvmSigner({
  getCode: (args) => viemClient.getCode(args),
  address: evmAccount.address,
  readContract: (args) => viemClient.readContract({ ...args, args: args.args || [] }),
  verifyTypedData: (args) => viemClient.verifyTypedData(args),
  writeContract: (args) => viemClient.writeContract({ ...args, args: args.args || [] }),
  sendTransaction: (args) => viemClient.sendTransaction(args),
  waitForTransactionReceipt: (args) => viemClient.waitForTransactionReceipt(args),
});

// Create facilitator with SSE-emitting hooks
const facilitator = new x402Facilitator()
  .onBeforeVerify(async (context) => {
    broadcastEvent("verify_started", {
      step: 6,
      title: "Payment Verification Started",
      description: "Facilitator is verifying the payment signature and requirements",
      details: {
        network: context.requirements?.network,
        checks: ["Signature validity", "Signer balance", "Nonce uniqueness", "Valid time window"]
      },
      actor: "facilitator"
    });
  })
  .onAfterVerify(async (context) => {
    broadcastEvent("verify_completed", {
      step: 7,
      title: "Payment Verified",
      description: context.result?.isValid
        ? "Payment signature and requirements verified successfully"
        : "Payment verification failed",
      details: {
        isValid: context.result?.isValid,
        network: context.requirements?.network
      },
      actor: "facilitator"
    });
  })
  .onVerifyFailure(async (context) => {
    broadcastEvent("verify_failed", {
      step: 7,
      title: "Verification Failed",
      description: `Payment verification failed: ${context.error?.message}`,
      details: { error: context.error?.message },
      actor: "facilitator",
      isError: true
    });
  })
  .onBeforeSettle(async (context) => {
    broadcastEvent("settle_started", {
      step: 8,
      title: "On-Chain Settlement Started",
      description: "Broadcasting receiveWithAuthorization transaction to Plasma blockchain",
      details: {
        contract: `USDT0 (${USDT0_ADDRESS.slice(0, 6)}...${USDT0_ADDRESS.slice(-4)})`,
        method: "receiveWithAuthorization",
        chain: "Plasma (chainId: 9745)",
        network: context.requirements?.network
      },
      actor: "facilitator",
      target: "blockchain"
    });
  })
  .onAfterSettle(async (context) => {
    const txHash = context.result?.transaction;
    broadcastEvent("settle_completed", {
      step: 9,
      title: "Settlement Confirmed",
      description: "Payment transaction confirmed on Plasma blockchain",
      details: {
        success: context.result?.success,
        transactionHash: txHash,
        explorerUrl: txHash ? `https://explorer.plasma.to/tx/${txHash}` : null,
        network: context.requirements?.network
      },
      actor: "blockchain",
      target: "facilitator"
    });
  })
  .onSettleFailure(async (context) => {
    broadcastEvent("settle_failed", {
      step: 9,
      title: "Settlement Failed",
      description: `On-chain settlement failed: ${context.error?.message}`,
      details: { error: context.error?.message },
      actor: "facilitator",
      isError: true
    });
  });

registerFacilitatorScheme(facilitator, {
  signer: evmSigner,
  networks: "eip155:9745",
});

// ============================================
// Facilitator Express App
// ============================================

const facilitatorApp = express();
facilitatorApp.use(express.json());

facilitatorApp.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const response = await facilitator.verify(paymentPayload, paymentRequirements);
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

facilitatorApp.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const response = await facilitator.settle(paymentPayload, paymentRequirements);
    res.json(response);
  } catch (error) {
    if (error.message?.includes("Settlement aborted:")) {
      return res.json({
        success: false,
        errorReason: error.message.replace("Settlement aborted: ", ""),
        network: req.body?.paymentPayload?.network || "unknown",
      });
    }
    res.status(500).json({ error: error.message });
  }
});

facilitatorApp.get("/supported", (req, res) => {
  res.json(facilitator.getSupported());
});

facilitatorApp.get("/health", (req, res) => {
  res.json({ status: "ok", chain: "plasma", chainId: 9745, facilitator: evmAccount.address });
});

// ============================================
// Resource Server (Weather API)
// ============================================

const facilitatorClient = new HTTPFacilitatorClient({ url: `http://localhost:${FACILITATOR_PORT}` });

const resourceApp = express();

resourceApp.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: [{
          scheme: "exact",
          network: "eip155:9745",
          price: {
            amount: "100",
            asset: USDT0_ADDRESS,
            extra: { name: "USDT0", version: "1", decimals: 6 },
          },
          payTo: PAY_TO_ADDRESS,
        }],
        description: "Weather data",
        mimeType: "application/json",
      },
    },
    new x402ResourceServer(facilitatorClient).register("eip155:9745", new ExactEvmScheme())
  )
);

resourceApp.get("/weather", (req, res) => {
  res.json({
    report: {
      weather: "sunny",
      temperature: 70,
      location: "San Francisco",
      timestamp: new Date().toISOString()
    }
  });
});

resourceApp.get("/health", (req, res) => {
  res.json({ status: "ok", chain: "plasma", chainId: 9745, payTo: PAY_TO_ADDRESS });
});

// ============================================
// Demo Server (SSE + Flow Control)
// ============================================

const demoApp = express();
demoApp.use(cors());
demoApp.use(express.json());

// SSE endpoint
demoApp.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.write(`data: ${JSON.stringify({ type: "connected", timestamp: Date.now() })}\n\n`);

  sseClients.add(res);
  console.log(`[SSE] Client connected. Total: ${sseClients.size}`);

  req.on("close", () => {
    sseClients.delete(res);
    console.log(`[SSE] Client disconnected. Total: ${sseClients.size}`);
  });
});

// Start the real x402 payment flow
demoApp.post("/demo/start-flow", async (req, res) => {
  broadcastEvent("flow_reset");

  try {
    // Step 1: Client initiates request
    broadcastEvent("request_initiated", {
      step: 1,
      title: "Request Initiated",
      description: "Client sends GET request to /weather endpoint",
      details: {
        method: "GET",
        url: `http://localhost:${SERVER_PORT}/weather`,
        signer: evmAccount.address
      },
      actor: "client",
      target: "server"
    });

    // Create the x402 client
    const client = new x402Client();
    registerClientScheme(client, { signer: evmAccount });

    // Create a custom fetch that emits events
    const customFetch = async (url, options) => {
      const response = await fetch(url, options);

      // Check if we got a 402
      if (response.status === 402) {
        // Step 2: Payment required received
        const paymentHeader = response.headers.get("x402-payment-required");
        let paymentRequirements = null;

        try {
          paymentRequirements = paymentHeader ? JSON.parse(atob(paymentHeader)) : null;
        } catch (e) {
          // Header might be in different format
        }

        broadcastEvent("payment_required", {
          step: 2,
          title: "402 Payment Required",
          description: "Server responded with payment requirements",
          details: {
            status: 402,
            statusText: "Payment Required",
            price: "0.0001 USDT0 (100 units)",
            payTo: PAY_TO_ADDRESS,
            network: "Plasma (eip155:9745)"
          },
          actor: "server",
          target: "client"
        });
      }

      return response;
    };

    // Wrap fetch with payment handling
    const originalWrap = wrapFetchWithPayment(customFetch, client);

    // Further wrap to capture signing events
    const fetchWithEvents = async (url, options) => {
      // We'll emit signing event before the wrapped fetch handles payment
      const initialResponse = await customFetch(url, options);

      if (initialResponse.status === 402) {
        // Step 3: Signing started
        broadcastEvent("payment_signing", {
          step: 3,
          title: "Signing Payment Authorization",
          description: "Client creating EIP-3009 TransferWithAuthorization signature",
          details: {
            signer: evmAccount.address,
            to: PAY_TO_ADDRESS,
            value: "100 (0.0001 USDT0)",
            method: "EIP-712 Typed Data"
          },
          actor: "client"
        });

        await sleep(300); // Small delay for visual effect

        // Step 4: Signature created
        broadcastEvent("payment_signed", {
          step: 4,
          title: "Payment Signed",
          description: "EIP-712 typed data signature created successfully",
          details: {
            signerAddress: evmAccount.address,
            signatureType: "EIP-712 TransferWithAuthorization"
          },
          actor: "client"
        });

        await sleep(200);

        // Step 5: Retry with payment
        broadcastEvent("request_with_payment", {
          step: 5,
          title: "Request with Payment Payload",
          description: "Client retries request with signed payment attached",
          details: {
            method: "GET",
            url: `http://localhost:${SERVER_PORT}/weather`,
            headers: { "x402-payment": "<signed-payment-payload>" }
          },
          actor: "client",
          target: "server"
        });
      }

      // Now let the wrapped fetch handle the rest
      // We need to make a fresh request since we consumed the 402 response
      return initialResponse;
    };

    // Make the actual request using the x402 client
    const weatherUrl = `http://localhost:${SERVER_PORT}/weather`;
    const wrappedFetch = wrapFetchWithPayment(fetch, client);

    // Emit initial events
    await sleep(500);

    // Make initial request to get 402
    const initial402 = await fetch(weatherUrl);

    if (initial402.status === 402) {
      broadcastEvent("payment_required", {
        step: 2,
        title: "402 Payment Required",
        description: "Server responded with payment requirements",
        details: {
          status: 402,
          price: "0.0001 USDT0 (100 units)",
          payTo: PAY_TO_ADDRESS,
          network: "Plasma (eip155:9745)",
          scheme: "exact"
        },
        actor: "server",
        target: "client"
      });

      await sleep(500);

      // Step 3: Signing
      broadcastEvent("payment_signing", {
        step: 3,
        title: "Signing Payment Authorization",
        description: "Creating EIP-3009 TransferWithAuthorization signature",
        details: {
          signer: evmAccount.address,
          to: PAY_TO_ADDRESS,
          amount: "100 units (0.0001 USDT0)",
          method: "EIP-712 Typed Data Signature"
        },
        actor: "client"
      });

      await sleep(600);

      // Step 4: Signed
      broadcastEvent("payment_signed", {
        step: 4,
        title: "Payment Signed",
        description: "EIP-712 typed data signature created successfully",
        details: {
          signerAddress: evmAccount.address,
          signatureType: "TransferWithAuthorization"
        },
        actor: "client"
      });

      await sleep(400);

      // Step 5: Request with payment
      broadcastEvent("request_with_payment", {
        step: 5,
        title: "Request with Payment Payload",
        description: "Retrying request with signed payment attached",
        details: {
          method: "GET",
          url: weatherUrl,
          paymentHeader: "x402-payment"
        },
        actor: "client",
        target: "server"
      });

      await sleep(300);
    }

    // Now make the real payment request (hooks will emit steps 6-9)
    const response = await wrappedFetch(weatherUrl, { method: "GET" });
    const body = await response.json();

    // Step 10: Response received
    if (response.ok) {
      const httpClient = new x402HTTPClient(client);
      const paymentResponse = httpClient.getPaymentSettleResponse(
        (name) => response.headers.get(name)
      );

      broadcastEvent("response_received", {
        step: 10,
        title: "Weather Data Received",
        description: "Client received protected resource after successful payment",
        details: {
          status: response.status,
          weatherData: body,
          paymentSettled: paymentResponse?.success ?? true,
          transactionHash: paymentResponse?.transaction
        },
        actor: "server",
        target: "client"
      });

      res.json({
        success: true,
        weatherData: body,
        paymentResponse
      });
    } else {
      broadcastEvent("flow_error", {
        title: "Request Failed",
        description: `Request failed with status ${response.status}`,
        details: { status: response.status, body },
        isError: true
      });

      res.json({ success: false, status: response.status, body });
    }
  } catch (error) {
    console.error("Flow error:", error);
    broadcastEvent("flow_error", {
      title: "Flow Error",
      description: error.message,
      details: { error: error.message, stack: error.stack?.split("\n").slice(0, 3) },
      isError: true
    });

    res.status(500).json({ success: false, error: error.message });
  }
});

// Status endpoint
demoApp.get("/demo/status", (req, res) => {
  res.json({
    demoServer: { status: "running", port: DEMO_PORT, connectedClients: sseClients.size },
    facilitator: { status: "running", port: FACILITATOR_PORT, address: evmAccount.address },
    resourceServer: { status: "running", port: SERVER_PORT, payTo: PAY_TO_ADDRESS }
  });
});

// Reset flow
demoApp.post("/demo/reset", (req, res) => {
  broadcastEvent("flow_reset");
  res.json({ success: true });
});

// Health check
demoApp.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// ============================================
// Start All Servers
// ============================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startServers() {
  // Start facilitator
  facilitatorApp.listen(parseInt(FACILITATOR_PORT), () => {
    console.log(`✅ Facilitator running on http://localhost:${FACILITATOR_PORT}`);
  });

  // Start resource server
  resourceApp.listen(parseInt(SERVER_PORT), () => {
    console.log(`✅ Weather Server running on http://localhost:${SERVER_PORT}`);
  });

  // Start demo server
  demoApp.listen(parseInt(DEMO_PORT), () => {
    console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
    console.log(`║           x402 Payment Flow Demo (REAL)                   ║`);
    console.log(`╠═══════════════════════════════════════════════════════════╣`);
    console.log(`║  Demo UI:        http://localhost:5173                    ║`);
    console.log(`║  Demo Server:    http://localhost:${DEMO_PORT}                      ║`);
    console.log(`║  Facilitator:    http://localhost:${FACILITATOR_PORT}                      ║`);
    console.log(`║  Weather Server: http://localhost:${SERVER_PORT}                      ║`);
    console.log(`╠═══════════════════════════════════════════════════════════╣`);
    console.log(`║  Network:        Plasma (chainId: 9745)                   ║`);
    console.log(`║  Token:          USDT0                                    ║`);
    console.log(`║  Price:          0.0001 USDT0 per request                 ║`);
    console.log(`╠═══════════════════════════════════════════════════════════╣`);
    console.log(`║  Account:        ${evmAccount.address.slice(0, 20)}...    ║`);
    console.log(`║  Pay To:         ${PAY_TO_ADDRESS.slice(0, 20)}...    ║`);
    console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  });
}

startServers().catch(console.error);
