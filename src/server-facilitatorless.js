import { config } from "dotenv";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme as ServerEvmScheme } from "@x402/evm/exact/server";
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import WalletAccountEvmFacilitator from "@semanticpay/wdk-x402-evm";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";

config();

/** @type {`0x${string}`} */
const payTo = /** @type {`0x${string}`} */ (process.env.PAY_TO_ADDRESS);
const mnemonic = process.env.MNEMONIC;

if (!payTo) {
  console.error("❌ PAY_TO_ADDRESS environment variable is required");
  process.exit(1);
}

if (!mnemonic) {
  console.error("❌ MNEMONIC environment variable is required");
  process.exit(1);
}

const walletAccount = await new WalletManagerEvm(mnemonic, {
  provider: "https://rpc.plasma.to",
}).getAccount();

const evmSigner = new WalletAccountEvmFacilitator(walletAccount);

// Create facilitator in-process (no HTTP calls to external facilitator)
const facilitator = new x402Facilitator();
registerExactEvmScheme(facilitator, {
  signer: evmSigner,
  networks: "eip155:9745",
});

const resourceServer = new x402ResourceServer(facilitator)
  .register("eip155:9745", new ServerEvmScheme());

const app = express();

app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: [
          {
            scheme: "exact",
            network: "eip155:9745",
            price: {
              amount: "100",
              asset: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
              extra: {
                name: "USDT0",
                version: "1",
                decimals: 6,
              },
            },
            payTo,
          },
        ],
        description: "Weather data",
        mimeType: "application/json",
      },
    },
    resourceServer
  )
);

/**
 * GET /weather
 * Protected endpoint requiring USDT0 payment on Plasma
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
app.get("/weather", (req, res) => {
  res.send({
    report: {
      weather: "sunny",
      temperature: 70,
    },
  });
});

/**
 * GET /health
 * Health check endpoint (unpaid)
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    chain: "plasma",
    chainId: 9745,
    facilitator: walletAccount.address,
    payTo,
  });
});

const PORT = process.env.PORT || 4021;

app.listen(PORT, () => {
  console.log(`Plasma USDT0 Server (facilitatorless) listening at http://localhost:${PORT}`);
  console.log(`Network: eip155:9745 (Plasma)`);
  console.log(`USDT0: 0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb`);
  console.log(`Facilitator: in-process (${walletAccount.address})`);
  console.log(`Pay to: ${payTo}`);
});
