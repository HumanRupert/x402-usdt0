import { config } from "dotenv";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

config();

/** @type {`0x${string}`} */
const payTo = /** @type {`0x${string}`} */ (process.env.PAY_TO_ADDRESS);

if (!payTo) {
  console.error("❌ PAY_TO_ADDRESS environment variable is required");
  process.exit(1);
}

const facilitatorUrl = process.env.FACILITATOR_URL;

if (!facilitatorUrl) {
  console.error("❌ FACILITATOR_URL environment variable is required");
  process.exit(1);
}

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });

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
    new x402ResourceServer(facilitatorClient).register(
      "eip155:9745",
      new ExactEvmScheme()
    )
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
    payTo,
  });
});

const PORT = process.env.PORT || 4021;

app.listen(PORT, () => {
  console.log(`Plasma USDT0 Server listening at http://localhost:${PORT}`);
  console.log(`Network: eip155:9745 (Plasma)`);
  console.log(`USDT0: 0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb`);
  console.log(`Pay to: ${payTo}`);
});