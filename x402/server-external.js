import { config } from "dotenv";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { USDT0_ADDRESS, PLASMA_NETWORK, PRICE_UNITS } from "./config.js";

config();

const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;
const FACILITATOR_URL = process.env.FACILITATOR_URL;

if (!PAY_TO_ADDRESS) {
  console.error("PAY_TO_ADDRESS environment variable is required");
  process.exit(1);
}

if (!FACILITATOR_URL) {
  console.error("FACILITATOR_URL environment variable is required");
  process.exit(1);
}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

const app = express();

app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: [
          {
            scheme: "exact",
            network: PLASMA_NETWORK,
            price: {
              amount: PRICE_UNITS,
              asset: USDT0_ADDRESS,
              extra: { name: "USDT0", version: "1", decimals: 6 },
            },
            payTo: PAY_TO_ADDRESS,
          },
        ],
        description: "Weather data",
        mimeType: "application/json",
      },
    },
    new x402ResourceServer(facilitatorClient).register(
      PLASMA_NETWORK,
      new ExactEvmScheme()
    )
  )
);

app.get("/weather", (req, res) => {
  res.send({
    report: {
      weather: "sunny",
      temperature: 70,
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    chain: "plasma",
    chainId: 9745,
    payTo: PAY_TO_ADDRESS,
  });
});

const PORT = process.env.PORT || 4021;

app.listen(PORT, () => {
  console.log(`x402 server (external facilitator) running on http://localhost:${PORT}`);
  console.log(`Network: ${PLASMA_NETWORK}`);
  console.log(`USDT0: ${USDT0_ADDRESS}`);
  console.log(`Pay to: ${PAY_TO_ADDRESS}`);
});
