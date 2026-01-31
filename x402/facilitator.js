import { config } from "dotenv";
import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import WalletAccountEvmX402Facilitator from "@semanticpay/wdk-wallet-evm-x402-facilitator";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { USDT0_ADDRESS, PLASMA_RPC, PLASMA_NETWORK } from "./config.js";

config();

const PORT = process.env.PORT || 4022;
const MNEMONIC = process.env.MNEMONIC;

if (!MNEMONIC) {
  console.error("MNEMONIC environment variable is required");
  process.exit(1);
}

const walletAccount = await new WalletManagerEvm(MNEMONIC, {
  provider: PLASMA_RPC,
}).getAccount();

const evmSigner = new WalletAccountEvmX402Facilitator(walletAccount);

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
  networks: PLASMA_NETWORK,
});

const app = express();
app.use(express.json());

app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const response = await facilitator.verify(paymentPayload, paymentRequirements);
    res.json(response);
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const response = await facilitator.settle(paymentPayload, paymentRequirements);
    res.json(response);
  } catch (error) {
    console.error("Settle error:", error);
    if (error instanceof Error && error.message.includes("Settlement aborted:")) {
      return res.json({
        success: false,
        errorReason: error.message.replace("Settlement aborted: ", ""),
        network: req.body?.paymentPayload?.network || "unknown",
      });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/supported", async (req, res) => {
  try {
    const response = facilitator.getSupported();
    res.json(response);
  } catch (error) {
    console.error("Supported error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    chain: "plasma",
    chainId: 9745,
    facilitator: walletAccount.address,
  });
});

app.listen(parseInt(PORT), () => {
  console.log(`x402 facilitator running on http://localhost:${PORT}`);
  console.log(`Network: ${PLASMA_NETWORK}`);
  console.log(`USDT0: ${USDT0_ADDRESS}`);
  console.log(`Account: ${walletAccount.address}`);
});
