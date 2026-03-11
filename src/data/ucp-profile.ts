export const ucpProfile = {
  ucp: {
    version: "2026-01-11",
    services: {
      checkout: {
        url: "/checkout-sessions",
        transport: "rest",
      },
    },
    capabilities: {
      "dev.ucp.shopping.checkout": [
        {
          version: "2026-01-11",
          spec: "https://ucp.dev/specification/checkout",
          schema: "https://ucp.dev/schemas/shopping/checkout.json",
        },
      ],
      "dev.ucp.shopping.fulfillment": [
        {
          version: "2026-01-11",
          spec: "https://ucp.dev/specification/fulfillment",
          schema: "https://ucp.dev/schemas/shopping/fulfillment.json",
          extends: "dev.ucp.shopping.checkout",
        },
      ],
      "dev.ucp.shopping.order": [
        {
          version: "2026-01-11",
          spec: "https://ucp.dev/specification/order",
          schema: "https://ucp.dev/schemas/shopping/order.json",
        },
      ],
      "dev.ucp.shopping.ancillaries": [
        {
          version: "2026-01-11",
          spec: "https://ucp.dev/specification/ancillaries",
          schema: "https://ucp.dev/schemas/shopping/ancillaries.json",
        },
      ],
    },
    payment_handlers: {
      "com.vippsmobilepay.ucp.payment_handler": [
        {
          id: "vippsmobilepay_wallet_handler",
          version: "2026-01-23",
          spec:
            "https://ucp.vippsmobilepay.com/ucp/2026-01-23/payment_handlers/vipps_mp_payment_handler",
          config_schema:
            "https://ucp.vippsmobilepay.com/ucp/2026-01-23/schemas/wallet_payment_handler.json",
          instrument_schemas: [
            "https://ucp.vippsmobilepay.com/ucp/2026-01-23/schemas/wallet_payment_instrument.json",
          ],
          config: {
            merchant_serial_number: "168850",
            environment: "TEST",
          },
        },
      ],
    },
  },
  signing_keys: [
    {
      kty: "EC",
      crv: "P-256",
      x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
      y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
      kid: "dev-signing-key-1",
      alg: "ES256",
      use: "sig",
    },
  ],
};
