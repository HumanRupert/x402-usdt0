import { ExpressAdapter } from "@x402/express";

export function verifyFirstMiddleware(httpServer, initPromiseHolder) {
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

    if (initPromiseHolder.promise) {
      await initPromiseHolder.promise;
      initPromiseHolder.promise = null;
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
