# UCP Business Service Demo

A demonstration of the [Unified Checkout Protocol (UCP)](https://ucp.dev)
specification, integrated with [Vipps MobilePay](https://vippsmobilepay.com/)
for payments.

This project implements a UCP-compliant business service that can be used as a
reference for building checkout experiences with wallet payments.

## Overview

This service demonstrates:

- **UCP Checkout Protocol** - Session-based checkout flow with line items,
  fulfillment options, and totals
- **UCP Fulfillment Extension** - Shipping and pickup options with dynamic
  pricing
- **UCP Ancillaries Extension** - Related products, upsells, and required
  add-ons
- **Vipps MobilePay Integration** - Wallet payments via ePayment API with
  PUSH_MESSAGE flow
- **UCP Headers** - Structured fields for agent identification, capabilities,
  and request context

## Quick Start

### Prerequisites

- [Deno](https://deno.land/)
- Vipps MobilePay test credentials (optional, for payment testing)

### Running the Service

```bash
# Development mode with auto-reload
deno task dev

# Production mode
deno task start
```

The service starts on `http://localhost:8081`.

### Verify it's running

```bash
curl http://localhost:8081/
```

## API Endpoints

| Endpoint                          | Method | Description                             |
| --------------------------------- | ------ | --------------------------------------- |
| `/`                               | GET    | Health check                            |
| `/.well-known/ucp`                | GET    | UCP profile discovery                   |
| `/products`                       | GET    | List available products                 |
| `/products/:sku`                  | GET    | Get product details                     |
| `/checkout_sessions`              | POST   | Create a checkout session               |
| `/checkout_sessions/:id`          | GET    | Retrieve a session                      |
| `/checkout_sessions/:id`          | PUT    | Update session (fulfillment, addresses) |
| `/checkout_sessions/:id/complete` | POST   | Complete checkout with payment          |
| `/checkout_sessions/:id/cancel`   | POST   | Cancel a checkout session               |
| `/api/vipps/callback`             | POST   | Vipps payment webhook                   |

## Usage Examples

### Create a Checkout Session

```bash
curl -X POST http://localhost:8081/checkout_sessions \
  -H "Content-Type: application/json" \
  -d '{
    "line_items": [
      { "sku": "DEMO-001", "quantity": 1 },
      { "sku": "DEMO-002", "quantity": 2 }
    ]
  }'
```

### Complete Checkout with Vipps Payment

```bash
curl -X POST http://localhost:8081/checkout_sessions/{session_id}/complete \
  -H "Content-Type: application/json" \
  -d '{
    "payment": {
      "instruments": [{
        "handler_id": "vippsmobilepay_wallet_handler",
        "type": "WALLET",
        "credential": {
          "type": "MSISDN",
          "value": "4712345678"
        }
      }]
    }
  }'
```

### Create Checkout with Ancillaries

Products can have relationships that generate ancillary suggestions. For
example, DEMO-006 (Washing Machine) has a required Drip Tray and suggested
Insurance:

```bash
curl -X POST http://localhost:8081/checkout_sessions \
  -H "Content-Type: application/json" \
  -d '{
    "line_items": [
      { "sku": "DEMO-006", "quantity": 1 }
    ]
  }'
```

The response includes:

- **Required ancillaries** - Automatically added to line items (e.g., Drip Tray)
- **Suggested ancillaries** - Returned in `ancillaries.suggested` array

### Add a Suggested Ancillary

```bash
curl -X PUT http://localhost:8081/checkout_sessions/{session_id} \
  -H "Content-Type: application/json" \
  -d '{
    "ancillaries": {
      "items": [{
        "item": { "id": "DEMO-007" },
        "quantity": 1,
        "for": "li_1"
      }]
    }
  }'
```

## Configuration

### Environment Variables

Copy `.env_example` to `.env` and configure:

```bash
# Vipps API Credentials (required for payments)
VIPPS_CLIENT_ID=your_client_id
VIPPS_CLIENT_SECRET=your_client_secret
VIPPS_SUBSCRIPTION_KEY=your_subscription_key
VIPPS_MERCHANT_SERIAL_NUMBER=your_msn

# Optional: API environment (defaults to test)
VIPPS_API_BASE_URL=https://apitest.vipps.no

# Optional: Callback URLs (for production)
VIPPS_CALLBACK_URL=https://your-domain.com/api/vipps/callback
VIPPS_RETURN_URL=https://your-domain.com/checkout/complete

# Optional: Enable embedded Vipps Checkout
VIPPS_EMBEDDED_CHECKOUT=false
```

### Getting Vipps Test Credentials

1. Sign up at the
   [Vipps Developer Portal](https://developer.vippsmobilepay.com/)
2. Create a test sales unit
3. Copy credentials to your `.env` file

## Project Structure

```
src/
├── main.ts                          # Entry point & HTTP router
├── types/
│   ├── merchant.ts                  # Demo merchant types (Product, etc.)
│   ├── ucp/
│   │   ├── checkout.ts              # UCP Checkout types
│   │   ├── fulfillment.ts           # UCP Fulfillment Extension types
│   │   ├── payment.ts               # UCP Payment Handler types
│   │   └── ancillaries.ts           # UCP Ancillaries Extension types
│   └── vipps/
│       ├── checkout.ts              # Vipps Checkout API v3 types
│       ├── epayment.ts              # Vipps ePayment API types
│       └── auth.ts                  # Vipps Access Token API types
├── routes/
│   ├── checkout.ts                  # Checkout session handlers
│   ├── products.ts                  # Product catalog handlers
│   └── ucp.ts                       # UCP profile endpoint
├── services/
│   ├── checkout-service.ts          # Session management & business logic
│   ├── payment-service.ts           # Payment processing & callbacks
│   └── ancillaries-service.ts       # Ancillary suggestions & processing
├── infrastructure/
│   ├── fulfillment.ts               # Fulfillment options builder
│   ├── ucp_profile.ts               # UCP profile utilities
│   ├── vipps_epayment_client.ts     # Vipps ePayment API client
│   ├── vipps-checkout-mapper.ts     # UCP to Vipps mapping
│   ├── ucp_headers.ts               # UCP header parsing/serialization
│   ├── ucp-messages.ts              # UCP message utilities
│   ├── structured_fields.ts         # RFC 8941 structured fields
│   └── canonicalize.ts              # Canonicalization utilities
├── data/
│   ├── products.json                # Product catalog
│   └── fulfillment-options.json     # Shipping & pickup options
├── well-known/
│   └── profile.json                 # UCP profile discovery
└── schema/
    └── *.json                       # JSON schemas
```

### Type Organization

Types are organized into domain-specific modules:

| Module                     | Description                                        |
| -------------------------- | -------------------------------------------------- |
| `types/ucp/checkout.ts`    | Core checkout types (Session, LineItem, Totals)    |
| `types/ucp/fulfillment.ts` | Fulfillment extension types (Shipping, Pickup)     |
| `types/ucp/payment.ts`     | Payment handler types (Wallet, Credentials)        |
| `types/ucp/ancillaries.ts` | Ancillaries extension types (Suggestions, Applied) |
| `types/vipps/checkout.ts`  | Vipps Checkout API v3 types                        |
| `types/vipps/epayment.ts`  | Vipps ePayment API types                           |
| `types/vipps/auth.ts`      | Vipps Access Token API types                       |
| `types/merchant.ts`        | Demo merchant types (Product, ProductsStore)       |

Import types from their specific modules:

```typescript
import type {
  CheckoutSession,
  LineItemResponse,
} from "./types/ucp/checkout.ts";
import type { AncillarySuggestion } from "./types/ucp/ancillaries.ts";
import type { Product } from "./types/merchant.ts";
```

## UCP Specification

This service implements:

- [UCP Checkout](https://ucp.dev/specification/checkout-rest/) - Core checkout
  flow
- [UCP Fulfillment](https://ucp.dev/specification/fulfillment/) - Shipping and
  pickup options
- [UCP Ancillaries](https://ucp.dev/specification/ancillaries/) - Related
  products and upsells
- [Vipps MobilePay Payment Handler](https://ucp.vippsmobilepay.com/ucp/2026-01-23/payment_handers/vipps_mp_payment_handler.md) -
  Wallet payments

### UCP Headers

The service uses UCP structured field headers:

- `UCP-Agent` - Identifies the calling agent/platform
- `UCP-Capabilities` - Advertises supported capabilities
- `UCP-API-Version` - Protocol version
- `UCP-Request-Context` - Request tracking metadata

## Testing with Postman

Import the collection from
`postman/UCP_Business_Service.postman_collection.json` for a complete set of API
requests.

## Development

### Running Tests

```bash
deno test
```

### Type Checking

```bash
deno check src/main.ts
```

### Formatting

```bash
deno fmt
```

### Linting

```bash
deno lint
```

## Payment Flow

The service implements the Vipps PUSH_MESSAGE payment flow:

1. **Create Session** - Platform creates checkout session
2. **Update Session** - User selects fulfillment options or ancillaries
3. **Complete Checkout** - Platform submits payment with MSISDN
4. **Push Notification** - Vipps sends push to user's phone
5. **User Approves** - User opens Vipps app and approves payment
6. **Callback/Polling** - Service receives payment status via webhook or polling
7. **Order Created** - Session transitions to `completed` with order info

## Security Considerations

This is a **demonstration service**. For production use:

- Implement proper authentication/authorization
- Use a production database (not JSON files)
- Validate webhook signatures
- Implement rate limiting
- Use HTTPS with proper certificates
- Secure environment variables

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

See [LICENSE](LICENSE) file for details.

## Resources

- [UCP Specification](https://ucp.dev)
- [Vipps Developer Portal](https://developer.vippsmobilepay.com/)
- [Vipps ePayment API](https://developer.vippsmobilepay.com/api/epayment/)
- [Deno Documentation](https://deno.land/manual)
