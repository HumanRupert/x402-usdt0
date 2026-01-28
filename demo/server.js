/**
 * Demo server for visualizing the x402 payment flow
 *
 * This server provides:
 * 1. SSE endpoint for real-time event streaming
 * 2. Demo flow endpoint that simulates the complete payment flow
 * 3. Status endpoints for server health
 */

import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.DEMO_PORT || 4020;

// Store connected SSE clients
const clients = new Set();

// Event types for the payment flow
const EventType = {
  // Server status
  SERVER_STARTED: "server_started",
  FACILITATOR_STARTED: "facilitator_started",

  // Flow steps
  REQUEST_INITIATED: "request_initiated",
  PAYMENT_REQUIRED: "payment_required",
  PAYMENT_SIGNING: "payment_signing",
  PAYMENT_SIGNED: "payment_signed",
  REQUEST_WITH_PAYMENT: "request_with_payment",
  VERIFY_STARTED: "verify_started",
  VERIFY_COMPLETED: "verify_completed",
  SETTLE_STARTED: "settle_started",
  SETTLE_COMPLETED: "settle_completed",
  RESPONSE_RECEIVED: "response_received",

  // Error events
  FLOW_ERROR: "flow_error",

  // Reset
  FLOW_RESET: "flow_reset"
};

/**
 * Broadcast event to all connected SSE clients
 */
function broadcastEvent(type, data = {}) {
  const event = {
    type,
    timestamp: Date.now(),
    ...data
  };

  const message = `data: ${JSON.stringify(event)}\n\n`;

  clients.forEach(client => {
    client.write(message);
  });

  console.log(`[SSE] Broadcast: ${type}`, data);
}

/**
 * SSE endpoint for real-time event streaming
 */
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: "connected", timestamp: Date.now() })}\n\n`);

  clients.add(res);
  console.log(`[SSE] Client connected. Total clients: ${clients.size}`);

  req.on("close", () => {
    clients.delete(res);
    console.log(`[SSE] Client disconnected. Total clients: ${clients.size}`);
  });
});

/**
 * Simulated data for the demo
 */
const demoData = {
  weatherServer: {
    url: "http://localhost:4021",
    payTo: "0x742d35Cc6634C0532925a3b844Bc9e7595f8276a",
    price: "0.0001 USDT0",
    priceRaw: "100",
    asset: "USDT0",
    network: "Plasma (eip155:9745)"
  },
  facilitator: {
    url: "http://localhost:4022",
    address: "0x8Ba1f109551bD432803012645Ac136ddd64DBA72"
  },
  client: {
    address: "0xF977814e90dA44bFA03b6295A0616a897441aceC"
  }
};

/**
 * Demo flow endpoint - simulates the complete x402 payment flow with realistic timing
 */
app.post("/demo/start-flow", async (req, res) => {
  // Reset any previous flow
  broadcastEvent(EventType.FLOW_RESET);

  try {
    // Step 1: Client initiates request
    await sleep(500);
    broadcastEvent(EventType.REQUEST_INITIATED, {
      step: 1,
      title: "Request Initiated",
      description: "Client sends GET request to /weather endpoint",
      details: {
        method: "GET",
        url: `${demoData.weatherServer.url}/weather`,
        headers: { "Accept": "application/json" }
      },
      actor: "client",
      target: "server"
    });

    // Step 2: Server returns 402 Payment Required
    await sleep(800);
    broadcastEvent(EventType.PAYMENT_REQUIRED, {
      step: 2,
      title: "402 Payment Required",
      description: "Server responds with payment requirements",
      details: {
        status: 402,
        statusText: "Payment Required",
        headers: {
          "x402-payment-required": "true"
        },
        paymentRequirements: {
          scheme: "exact",
          network: demoData.weatherServer.network,
          price: demoData.weatherServer.price,
          asset: demoData.weatherServer.asset,
          payTo: demoData.weatherServer.payTo
        }
      },
      actor: "server",
      target: "client"
    });

    // Step 3: Client signing payment
    await sleep(600);
    broadcastEvent(EventType.PAYMENT_SIGNING, {
      step: 3,
      title: "Signing Payment Authorization",
      description: "Client creates EIP-3009 TransferWithAuthorization signature",
      details: {
        signer: demoData.client.address,
        to: demoData.weatherServer.payTo,
        value: demoData.weatherServer.priceRaw,
        validAfter: Math.floor(Date.now() / 1000) - 60,
        validBefore: Math.floor(Date.now() / 1000) + 3600,
        nonce: `0x${Math.random().toString(16).slice(2, 66)}`
      },
      actor: "client"
    });

    // Step 4: Payment signed
    await sleep(700);
    const signature = `0x${Array(130).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;
    broadcastEvent(EventType.PAYMENT_SIGNED, {
      step: 4,
      title: "Payment Signed",
      description: "EIP-712 typed data signature created successfully",
      details: {
        signaturePreview: `${signature.slice(0, 20)}...${signature.slice(-10)}`,
        signatureLength: signature.length
      },
      actor: "client"
    });

    // Step 5: Retry request with payment
    await sleep(500);
    broadcastEvent(EventType.REQUEST_WITH_PAYMENT, {
      step: 5,
      title: "Request with Payment Payload",
      description: "Client retries request with signed payment attached",
      details: {
        method: "GET",
        url: `${demoData.weatherServer.url}/weather`,
        headers: {
          "x402-payment": "<base64-encoded-payment-payload>"
        }
      },
      actor: "client",
      target: "server"
    });

    // Step 6: Facilitator verification starts
    await sleep(600);
    broadcastEvent(EventType.VERIFY_STARTED, {
      step: 6,
      title: "Payment Verification Started",
      description: "Server forwards payment to facilitator for verification",
      details: {
        facilitator: demoData.facilitator.url,
        endpoint: "POST /verify",
        checks: [
          "Signature validity",
          "Signer balance",
          "Nonce uniqueness",
          "Valid time window"
        ]
      },
      actor: "server",
      target: "facilitator"
    });

    // Step 7: Verification completed
    await sleep(800);
    broadcastEvent(EventType.VERIFY_COMPLETED, {
      step: 7,
      title: "Payment Verified",
      description: "Facilitator confirms payment is valid and can be settled",
      details: {
        isValid: true,
        from: demoData.client.address,
        to: demoData.weatherServer.payTo,
        amount: demoData.weatherServer.price,
        network: demoData.weatherServer.network
      },
      actor: "facilitator",
      target: "server"
    });

    // Step 8: Settlement starts
    await sleep(500);
    broadcastEvent(EventType.SETTLE_STARTED, {
      step: 8,
      title: "On-Chain Settlement Started",
      description: "Facilitator broadcasts receiveWithAuthorization to blockchain",
      details: {
        contract: "USDT0 (0xB8CE...5ebb)",
        method: "receiveWithAuthorization",
        chain: "Plasma (chainId: 9745)",
        gasEstimate: "~50,000"
      },
      actor: "facilitator",
      target: "blockchain"
    });

    // Step 9: Settlement completed
    await sleep(1200);
    const txHash = `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;
    broadcastEvent(EventType.SETTLE_COMPLETED, {
      step: 9,
      title: "Settlement Confirmed",
      description: "Transaction confirmed on Plasma blockchain",
      details: {
        success: true,
        transactionHash: txHash,
        blockNumber: 12847593 + Math.floor(Math.random() * 100),
        gasUsed: 47832,
        explorerUrl: `https://explorer.plasma.to/tx/${txHash}`
      },
      actor: "blockchain",
      target: "facilitator"
    });

    // Step 10: Response received
    await sleep(600);
    broadcastEvent(EventType.RESPONSE_RECEIVED, {
      step: 10,
      title: "Weather Data Received",
      description: "Client receives protected resource after successful payment",
      details: {
        status: 200,
        headers: {
          "x402-payment-response": "<settlement-receipt>"
        },
        body: {
          report: {
            weather: "sunny",
            temperature: 70
          }
        }
      },
      actor: "server",
      target: "client"
    });

    res.json({ success: true, message: "Demo flow completed" });
  } catch (error) {
    broadcastEvent(EventType.FLOW_ERROR, {
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get current status of demo servers
 */
app.get("/demo/status", (req, res) => {
  res.json({
    demoServer: {
      status: "running",
      port: PORT,
      connectedClients: clients.size
    },
    weatherServer: {
      ...demoData.weatherServer,
      status: "simulated"
    },
    facilitator: {
      ...demoData.facilitator,
      status: "simulated"
    }
  });
});

/**
 * Reset the flow visualization
 */
app.post("/demo/reset", (req, res) => {
  broadcastEvent(EventType.FLOW_RESET);
  res.json({ success: true });
});

/**
 * Health check
 */
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════════════════════╗`);
  console.log(`║         x402 Payment Flow Demo Server                 ║`);
  console.log(`╠═══════════════════════════════════════════════════════╣`);
  console.log(`║  Demo Server:  http://localhost:${PORT}                  ║`);
  console.log(`║  SSE Events:   http://localhost:${PORT}/events            ║`);
  console.log(`║  Start Flow:   POST http://localhost:${PORT}/demo/start-flow ║`);
  console.log(`╚═══════════════════════════════════════════════════════╝\n`);
});
