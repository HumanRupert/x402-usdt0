import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import WalletAccountEvmFacilitator from "@semanticpay/wdk-x402-evm";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const PORT = process.env.PORT || "4022";

if (!process.env.MNEMONIC) {
  console.error("❌ MNEMONIC environment variable is required");
  process.exit(1);
}

const walletAccount = await new WalletManagerEvm(process.env.MNEMONIC, {
  provider: "https://rpc.plasma.to",
}).getAccount();
console.info(`Facilitator account: ${walletAccount.address}`);

const evmSigner = new WalletAccountEvmFacilitator(walletAccount);

const facilitator = new x402Facilitator()
  .onBeforeVerify(async (context) => {
    console.log("Before verify:", context.requirements?.network);
  })
  .onAfterVerify(async (context) => {
    console.log("After verify - valid:", context.result?.isValid);
  })
  .onVerifyFailure(async (context) => {
    console.log("Verify failure:", context.error);
  })
  .onBeforeSettle(async (context) => {
    console.log("Before settle:", context.requirements?.network);
  })
  .onAfterSettle(async (context) => {
    console.log("After settle - success:", context.result?.success);
    if (context.result?.transaction) {
      console.log("Transaction:", context.result.transaction);
    }
  })
  .onSettleFailure(async (context) => {
    console.log("Settle failure:", context.error);
  });
registerExactEvmScheme(facilitator, {
  signer: evmSigner,
  networks: "eip155:9745",
});

const app = express();
app.use(express.json());

/**
 * POST /verify
 * Verify a payment against requirements
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response = await facilitator.verify(
      paymentPayload,
      paymentRequirements
    );

    res.json(response);
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /settle
 * Settle a payment on-chain (calls receiveWithAuthorization on USDT0)
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response = await facilitator.settle(
      paymentPayload,
      paymentRequirements
    );

    res.json(response);
  } catch (error) {
    console.error("Settle error:", error);

    if (
      error instanceof Error &&
      error.message.includes("Settlement aborted:")
    ) {
      return res.json({
        success: false,
        errorReason: error.message.replace("Settlement aborted: ", ""),
        network: req.body?.paymentPayload?.network || "unknown",
      });
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /supported
 * Get supported payment kinds and extensions
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
app.get("/supported", async (req, res) => {
  try {
    const response = facilitator.getSupported();
    res.json(response);
  } catch (error) {
    console.error("Supported error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    chain: "plasma",
    chainId: 9745,
    facilitator: walletAccount.address,
  });
});

app.listen(parseInt(PORT), () => {
  console.log(`Plasma USDT0 Facilitator listening on port ${PORT}`);
  console.log(`Network: eip155:9745 (Plasma)`);
  console.log(`USDT0: 0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb`);
});
