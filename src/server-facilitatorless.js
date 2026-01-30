import { config } from "dotenv";
import express from "express";
import cors from "cors";

// x402 core
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme as registerFacilitatorScheme } from "@x402/evm/exact/facilitator";
import {
  x402ResourceServer,
  x402HTTPResourceServer,
  ExpressAdapter,
} from "@x402/express";
import { ExactEvmScheme as ServerEvmScheme } from "@x402/evm/exact/server";

// x402 client
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme as registerClientScheme } from "@x402/evm/exact/client";

// WDK
import WalletAccountEvmFacilitator from "@semanticpay/wdk-x402-evm";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";

config();

// ============================================
// Configuration
// ============================================

const PORT = process.env.PORT || 4021;
const MNEMONIC = process.env.MNEMONIC;

/** @type {`0x${string}`} */
const PAY_TO_ADDRESS = /** @type {`0x${string}`} */ (
  process.env.PAY_TO_ADDRESS
);

if (!MNEMONIC) {
  console.error("MNEMONIC environment variable is required");
  process.exit(1);
}

if (!PAY_TO_ADDRESS) {
  console.error("PAY_TO_ADDRESS environment variable is required");
  process.exit(1);
}

const USDT0_ADDRESS = "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb";

// ============================================
// SSE Event Broadcasting
// ============================================

const sseClients = new Set();

function broadcastEvent(type, data = {}) {
  const event = { type, timestamp: Date.now(), ...data };
  const message = `data: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach((client) => client.write(message));
  console.log(`[SSE] ${type}`, data.title || data.step || "");
}

// ============================================
// Wallet + Facilitator with SSE hooks
// ============================================

const walletAccount = await new WalletManagerEvm(MNEMONIC, {
  provider: "https://rpc.plasma.to",
}).getAccount();

console.log(`Account: ${walletAccount.address}`);

const evmSigner = new WalletAccountEvmFacilitator(walletAccount);

const facilitator = new x402Facilitator()
  .onBeforeVerify(async (context) => {
    broadcastEvent("verify_started", {
      step: 6,
      title: "Payment Verification Started",
      description:
        "Facilitator is verifying the payment signature and requirements",
      details: {
        network: context.requirements?.network,
        checks: [
          "Signature validity",
          "Signer balance",
          "Nonce uniqueness",
          "Valid time window",
        ],
      },
      actor: "facilitator",
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
        network: context.requirements?.network,
      },
      actor: "facilitator",
    });
  })
  .onVerifyFailure(async (context) => {
    broadcastEvent("verify_failed", {
      step: 7,
      title: "Verification Failed",
      description: `Payment verification failed: ${context.error?.message}`,
      details: { error: context.error?.message },
      actor: "facilitator",
      isError: true,
    });
  })
  .onBeforeSettle(async (context) => {
    broadcastEvent("settle_started", {
      step: 9,
      title: "On-Chain Settlement Started",
      description:
        "Broadcasting receiveWithAuthorization transaction to Plasma blockchain",
      details: {
        contract: `USDT0 (${USDT0_ADDRESS.slice(0, 6)}...${USDT0_ADDRESS.slice(-4)})`,
        method: "receiveWithAuthorization",
        chain: "Plasma (chainId: 9745)",
        network: context.requirements?.network,
      },
      actor: "facilitator",
      target: "blockchain",
    });
  })
  .onAfterSettle(async (context) => {
    const txHash = context.result?.transaction;
    broadcastEvent("settle_completed", {
      step: 10,
      title: "Settlement Confirmed",
      description: "Payment transaction confirmed on Plasma blockchain",
      details: {
        success: context.result?.success,
        transactionHash: txHash,
        explorerUrl: txHash
          ? `https://explorer.plasma.to/tx/${txHash}`
          : null,
        network: context.requirements?.network,
      },
      actor: "blockchain",
      target: "facilitator",
    });
  })
  .onSettleFailure(async (context) => {
    broadcastEvent("settle_failed", {
      step: 10,
      title: "Settlement Failed",
      description: `On-chain settlement failed: ${context.error?.message}`,
      details: { error: context.error?.message },
      actor: "facilitator",
      isError: true,
    });
  });

registerFacilitatorScheme(facilitator, {
  signer: evmSigner,
  networks: "eip155:9745",
});

// ============================================
// Resource Server + Custom Verify-First Middleware
// ============================================

const resourceServer = new x402ResourceServer(facilitator).register(
  "eip155:9745",
  new ServerEvmScheme()
);

const routes = {
  "GET /weather": {
    accepts: [
      {
        scheme: "exact",
        network: "eip155:9745",
        price: {
          amount: "100",
          asset: USDT0_ADDRESS,
          extra: { name: "USDT0", version: "1", decimals: 6 },
        },
        payTo: PAY_TO_ADDRESS,
      },
    ],
    description: "Weather data",
    mimeType: "application/json",
  },
};

const httpServer = new x402HTTPResourceServer(resourceServer, routes);
let initPromise = httpServer.initialize();

/**
 * Custom payment middleware: verify → respond → settle (async).
 *
 * Unlike the standard paymentMiddleware which buffers the response and
 * settles before sending it, this middleware sends the response immediately
 * after verification and settles on-chain asynchronously afterward.
 */
function verifyFirstMiddleware() {
  return async (req, res, next) => {
    const adapter = new ExpressAdapter(req);
    const context = {
      adapter,
      path: req.path,
      method: req.method,
      paymentHeader:
        adapter.getHeader("payment-signature") ||
        adapter.getHeader("x-payment"),
    };

    if (!httpServer.requiresPayment(context)) {
      return next();
    }

    if (initPromise) {
      await initPromise;
      initPromise = null;
    }

    const result = await httpServer.processHTTPRequest(context);

    switch (result.type) {
      case "no-payment-required":
        return next();

      case "payment-error": {
        const { response } = result;
        res.status(response.status);
        Object.entries(response.headers).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
        if (response.isHtml) {
          res.send(response.body);
        } else {
          res.json(response.body || {});
        }
        return;
      }

      case "payment-verified": {
        const { paymentPayload, paymentRequirements } = result;

        // Settle AFTER the response is fully sent to the client
        res.on("finish", () => {
          httpServer
            .processSettlement(paymentPayload, paymentRequirements)
            .then((settleResult) => {
              if (!settleResult.success) {
                console.error("Settlement failed:", settleResult.errorReason);
              }
            })
            .catch((err) => console.error("Settlement error:", err));
        });

        return next();
      }
    }
  };
}

// ============================================
// Express App
// ============================================

const app = express();
app.use(cors());
app.use(verifyFirstMiddleware());

app.get("/weather", (req, res) => {
  res.json({
    report: {
      weather: "sunny",
      temperature: 70,
      location: "San Francisco",
      timestamp: new Date().toISOString(),
    },
  });
});

// ============================================
// SSE Endpoint
// ============================================

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.write(
    `data: ${JSON.stringify({ type: "connected", timestamp: Date.now() })}\n\n`
  );

  sseClients.add(res);
  console.log(`[SSE] Client connected. Total: ${sseClients.size}`);

  req.on("close", () => {
    sseClients.delete(res);
    console.log(`[SSE] Client disconnected. Total: ${sseClients.size}`);
  });
});

// ============================================
// Demo Endpoints
// ============================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.post("/demo/start-flow", async (req, res) => {
  broadcastEvent("flow_reset");

  try {
    // Step 1: Client initiates request
    broadcastEvent("request_initiated", {
      step: 1,
      title: "Request Initiated",
      description: "Client sends GET request to /weather endpoint",
      details: {
        method: "GET",
        url: `http://localhost:${PORT}/weather`,
        signer: walletAccount.address,
      },
      actor: "client",
      target: "server",
    });

    await sleep(300);

    // Make initial request to get 402
    const weatherUrl = `http://localhost:${PORT}/weather`;
    const initial402 = await fetch(weatherUrl);

    if (initial402.status === 402) {
      // Step 2: 402 received
      broadcastEvent("payment_required", {
        step: 2,
        title: "402 Payment Required",
        description: "Server responded with payment requirements",
        details: {
          status: 402,
          price: "0.0001 USDT0 (100 units)",
          payTo: PAY_TO_ADDRESS,
          network: "Plasma (eip155:9745)",
          scheme: "exact",
        },
        actor: "server",
        target: "client",
      });

      await sleep(300);

      // Step 3: Signing
      broadcastEvent("payment_signing", {
        step: 3,
        title: "Signing Payment Authorization",
        description: "Creating EIP-3009 TransferWithAuthorization signature",
        details: {
          signer: walletAccount.address,
          to: PAY_TO_ADDRESS,
          amount: "100 units (0.0001 USDT0)",
          method: "EIP-712 Typed Data Signature",
        },
        actor: "client",
      });

      await sleep(400);

      // Step 4: Signed
      broadcastEvent("payment_signed", {
        step: 4,
        title: "Payment Signed",
        description: "EIP-712 typed data signature created successfully",
        details: {
          signerAddress: walletAccount.address,
          signatureType: "TransferWithAuthorization",
        },
        actor: "client",
      });

      await sleep(200);

      // Step 5: Request with payment
      broadcastEvent("request_with_payment", {
        step: 5,
        title: "Request with Payment Payload",
        description: "Retrying request with signed payment attached",
        details: {
          method: "GET",
          url: weatherUrl,
          paymentHeader: "payment-signature",
        },
        actor: "client",
        target: "server",
      });

      await sleep(200);
    }

    // Make the real payment request
    // Facilitator hooks will emit steps 6 (verify started) and 7 (verify completed)
    // Then the response is returned immediately (verify-first middleware)
    // Then settlement hooks fire steps 9 and 10 asynchronously
    const client = new x402Client();
    registerClientScheme(client, { signer: walletAccount });
    const wrappedFetch = wrapFetchWithPayment(fetch, client);

    const response = await wrappedFetch(weatherUrl, { method: "GET" });
    const body = await response.json();

    if (response.ok) {
      // Step 8: Response received (before settlement, which is async)
      broadcastEvent("response_received", {
        step: 8,
        title: "Weather Data Received",
        description:
          "Client received protected resource after successful verification",
        details: {
          status: response.status,
          weatherData: body,
        },
        actor: "server",
        target: "client",
      });

      res.json({ success: true, weatherData: body });
    } else {
      broadcastEvent("flow_error", {
        title: "Request Failed",
        description: `Request failed with status ${response.status}`,
        details: { status: response.status, body },
        isError: true,
      });

      res.json({ success: false, status: response.status, body });
    }
  } catch (error) {
    console.error("Flow error:", error);
    broadcastEvent("flow_error", {
      title: "Flow Error",
      description: error.message,
      details: {
        error: error.message,
        stack: error.stack?.split("\n").slice(0, 3),
      },
      isError: true,
    });

    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/demo/status", (req, res) => {
  res.json({
    server: {
      status: "running",
      port: PORT,
      facilitator: "in-process",
      address: walletAccount.address,
      payTo: PAY_TO_ADDRESS,
    },
    connectedClients: sseClients.size,
  });
});

app.post("/demo/reset", (req, res) => {
  broadcastEvent("flow_reset");
  res.json({ success: true });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    chain: "plasma",
    chainId: 9745,
    facilitator: walletAccount.address,
    payTo: PAY_TO_ADDRESS,
  });
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
  console.log(`\nx402 Facilitatorless Server running on http://localhost:${PORT}`);
  console.log(`Network:     eip155:9745 (Plasma)`);
  console.log(`USDT0:       ${USDT0_ADDRESS}`);
  console.log(`Facilitator: in-process (${walletAccount.address})`);
  console.log(`Pay to:      ${PAY_TO_ADDRESS}`);
  console.log(`Demo UI:     http://localhost:5173\n`);
});
