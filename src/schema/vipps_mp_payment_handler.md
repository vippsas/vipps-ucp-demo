<!--
   Copyright 2026 UCP Authors TOOD: WHAT AR OURE LICENSE HERE?

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
-->

# Vipps Mobilepay Payment Handler

- **Status:** `DRAFT`
- **Handler Name:** `com.vippsmobilepay.pay.payment_handler`
- **Version:** `2026-01-23`

## Introduction

This payment handler supports payment creation through the
[Vipps MobilePay ePayment API](https://developer.vippsmobilepay.com/api/epayment/#tag/CreatePayments/operation/createPayment).
Two payment methods are supported:

- **WALLET** - For customers with a Vipps MobilePay wallet. Uses push
  notification flow (`userFlow: PUSH_MESSAGE`).
- **CARD** - For customers without a wallet. Uses redirect flow
  (`userFlow: WEB_REDIRECT`) where users enter card details on the Vipps
  MobilePay payment page.

### Key Benefits

- Efficient integration with Vipps MobilePay payment services.
- Seamless checkout experience for customers with or without a Vipps MobilePay
  wallet.
- Secure handling of payment credentials and transactions.

### Integration Guide

| Participant  | Integration Section                           |
| :----------- | :-------------------------------------------- |
| **Business** | [Business Integration](#business-integration) |
| **Platform** | [Platform Integration](#platform-integration) |

---

## Participants

This payment handler covers two participants: the **business** for which a
_customer_ is shopping from and the **platform** that facilitates the checkout
process (such as an agent).

- The **business** is responsible for processing payments using this handler,
- The **platform** offers the supported _payment instrument_ to the customer in
  the checkout flow.
- The **business** registers this handler and configures/implements it, and the
  **platform** discovers and utilizes the handler during checkout.
- The **business** needs to have an active merchant agreement and an ecommerce
  sales unit registered with Vipps Mobilepay
- The **platform** needs to validate that a user has a valid Vipps Mobilepay
  identity before offering this payment option. Suggestion is to utilize the
  [Vipps Login Product](https://developer.vippsmobilepay.com/docs/APIs/login-api/)
  to do so

> **Note on Terminology:** While this specification refers to the participant as
> the **"business,"** technical schema fields may retain the standard industry
> nomenclature **`merchant_*`** (e.g., `merchant_id`). Mappings are documented
> below.

| Participant  | Role                                                                                             | Prerequisites                                                                       |
| :----------- | :----------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| **Business** | Creates a payment for the defined customer in the Vipps MobilePay ecosystem                      | Needs to have an active merchant agreement and ecom sales unit with Vipps Mobilepay |
| **Platform** | Collects the customer information, along with validating that the customer has the Vipps wallet. | Needs to validate that the user has the Vipps MobilePay wallet                      |

### Payment Flow Diagram

The following diagram shows the async payment flow for this handler. The
credential can be either MSISDN (phone number) or TOKEN (customer token):

```
Platform                    Business                    Vipps                    User
   │                           │                          │                        │
   │ POST /complete            │                          │                        │
   │ (MSISDN or TOKEN)         │                          │                        │
   │──────────────────────────>│                          │                        │
   │                           │ CreatePayment            │                        │
   │                           │ (phoneNumber or          │                        │
   │                           │  customerToken)          │                        │
   │                           │─────────────────────────>│                        │
   │                           │ state: CREATED           │  Push Notification     │
   │                           │<─────────────────────────│───────────────────────>│
   │ status: complete_in_progress                         │                        │
   │<──────────────────────────│                          │                        │
   │                           │                          │                        │
   │ (tells user to check Vipps)                          │       User Approves    │
   │                           │                          │<───────────────────────│
   │                           │ Callback: AUTHORIZED     │                        │
   │                           │<─────────────────────────│                        │
   │                           │ (updates session)        │                        │
   │                           │                          │                        │
   │ GET /checkout-sessions/id │                          │                        │
   │──────────────────────────>│                          │                        │
   │ status: completed + order │                          │                        │
   │<──────────────────────────│                          │                        │
```

---

> **Note:** To create a payment, the business **MUST** create a
> [Vipps Mobilepay Access Token](https://developer.vippsmobilepay.com/docs/APIs/access-token-api/)
> using their credentials and then call the
> [Vipps Mobilepay Epayment API CreatePayments endpoint](https://developer.vippsmobilepay.com/docs/APIs/epayment-api/)
> to create a payment. The suggested payment `userFlow` is `PUSH_MESSAGE`, which
> triggers a push notification to the user's Vipps Mobilepay app to approve the
> payment.

## Business Integration

### Prerequisites

Before advertising this handler, businesses **MUST** complete:

1. Create a merchant agreement and register an Ecommerce sales unit with Vipps
   Mobilepay
2. Implement server-side logic to generate access tokens and create payments
   using the Vipps Mobilepay
   [AccessToken](https://developer.vippsmobilepay.com/docs/APIs/access-token-api/)
   and [ePayment](https://developer.vippsmobilepay.com/docs/APIs/epayment-api/)
   APIs.

**Prerequisites Output:**

| Field                           | Description                                                 |
| :------------------------------ | :---------------------------------------------------------- |
| `identity.clientId`             | The client id to call the Vipps Mobilepay APIs with         |
| `identity.clientSecret`         | The secret to call the Vipps Mobilepay APIs with            |
| `identity.subscriptionKey`      | The subscription key to call the Vipps Mobilepay APIs with. |
| `merchant.merchantSerialNumber` | The merchant identifier in the Vipps Mobilepay systems      |

### Handler Configuration

Businesses advertise support for this handler in their `/.well-known/ucp`
profile under the `payment.handlers` array.

#### Configuration Schema

**Schema URL:**
`https://vippsmobilepay.com/pay/ucp/2026-01-23/schemas/wallet_payment_handler.json`

| Field                         | Type   | Required | Description                                                                                                                                                                                    |
| :---------------------------- | :----- | :------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merchant_serial_number`      | string | **Yes**  | The merchant identifier (MSN) in the Vipps MobilePay systems. This is obtained when registering an ecommerce sales unit with Vipps MobilePay. Format varies by country (5-6 digits typically). |
| `environment`                 | enum   | No       | The Vipps MobilePay environment. One of `TEST` or `PRODUCTION`. Defaults to `PRODUCTION` if not specified. Use `TEST` for sandbox testing with test credentials.                               |
| `allowed_payment_instruments` | array  | No       | The payment instruments allowed for this handler. If not specified, all instrument types are allowed. Supported types: `WALLET` (push notification flow) and `CARD` (redirect flow).           |

#### Example Handler Declaration

```json
{
  "payment": {
    "handlers": [
      {
        "id": "vipps_mobilepay",
        "name": "com.vippsmobilepay.pay.payment_handler",
        "version": "2026-01-23",
        "spec": "https://vippsmobilepay.com/pay/ucp/2026-01-23/vipps_mp_payment_handler",
        "config_schema": "https://vippsmobilepay.com/pay/ucp/2026-01-23/schemas/wallet_payment_handler.json",
        "instrument_schemas": [
          "https://vippsmobilepay.com/pay/ucp/2026-01-23/schemas/payment_instrument.json"
        ],
        "config": {
          "merchant_serial_number": "123456",
          "environment": "PRODUCTION"
        }
      }
    ]
  }
}
```

### Instrument Schema

**Schema URL:**
`https://vippsmobilepay.com/pay/ucp/2026-01-23/schemas/payment_instrument.json`

The Vipps MobilePay payment instrument defines the structure for payments
submitted by platforms.

| Field        | Type   | Required              | Description                                                                                                  |
| :----------- | :----- | :-------------------- | :----------------------------------------------------------------------------------------------------------- |
| `type`       | enum   | **Yes**               | The payment instrument type. One of `WALLET` or `CARD`.                                                      |
| `credential` | object | **Yes** (WALLET only) | The credential information required to process WALLET payments. See [Credential Schema](#credential-schema). |
| `return_url` | string | **Yes** (CARD only)   | The URL to redirect the user back to after CARD payment. Can be a universal link or website URL.             |

#### Instrument Types

| Type     | Vipps `paymentMethod.type` | Vipps `userFlow` | Description                                                                            |
| :------- | :------------------------- | :--------------- | :------------------------------------------------------------------------------------- |
| `WALLET` | `WALLET`                   | `PUSH_MESSAGE`   | Push notification to user's Vipps app. Requires customer credential (MSISDN or TOKEN). |
| `CARD`   | `CARD`                     | `WEB_REDIRECT`   | Redirect user to Vipps payment page to enter card details. No wallet required.         |

#### Credential Schema

**Schema URL:**
`https://vippsmobilepay.com/pay/ucp/2026-01-23/schemas/wallet_payment_credential.json`

The credential object contains the buyer's Vipps MobilePay wallet identifier.
Two credential types are supported:

| Field   | Type   | Required | Description                                                              |
| :------ | :----- | :------- | :----------------------------------------------------------------------- |
| `type`  | enum   | **Yes**  | The credential type. One of `MSISDN` or `TOKEN`.                         |
| `value` | string | **Yes**  | The credential value. Format depends on the credential type (see below). |

##### MSISDN Credential (Public)

The MSISDN credential uses the customer's phone number. This maps to the
`customer.phoneNumber` field in the
[Vipps ePayment API](https://developer.vippsmobilepay.com/api/epayment/#tag/CreatePayments/operation/createPayment).

| Field   | Description                                                                                                                                                                        |
| :------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `value` | The phone number in MSISDN format: digits only with country code and subscriber number, no leading zeros or plus sign. Example: `4712345678` for Norwegian number +47 12 34 56 78. |

**Example MSISDN Instrument:**

```json
{
  "type": "WALLET",
  "credential": {
    "type": "MSISDN",
    "value": "4712345678"
  }
}
```

##### TOKEN Credential

The TOKEN credential uses an encoded customer token obtained from authenticated
user sessions. This maps to the `customer.customerToken` field in the
[Vipps ePayment API](https://developer.vippsmobilepay.com/api/epayment/#tag/CreatePayments/operation/createPayment).

| Field   | Description                                                            |
| :------ | :--------------------------------------------------------------------- |
| `value` | An encoded customer token string obtained from authenticated sessions. |

**Example TOKEN Instrument:**

```json
{
  "type": "WALLET",
  "credential": {
    "type": "TOKEN",
    "value": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### CARD Instrument (No Wallet Required)

The CARD instrument allows customers who do not have a Vipps MobilePay wallet to
pay using their card. This uses the redirect flow where the user is sent to the
Vipps MobilePay payment page to enter their card details.

| Field        | Type   | Required | Description                                                                                                                                                                   |
| :----------- | :----- | :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`       | enum   | **Yes**  | Must be `CARD`.                                                                                                                                                               |
| `return_url` | string | **Yes**  | The URL to redirect the user back to after payment. Can be a universal link (e.g., `myapp://payment-complete`) or website URL (e.g., `https://example.com/payment-complete`). |

**Example CARD Instrument:**

```json
{
  "type": "CARD",
  "return_url": "https://chat.vippsmobilepay.com/payment-complete?session_id=cs-ABC123XYZ"
}
```

**Example CARD Instrument with Universal Link:**

```json
{
  "type": "CARD",
  "return_url": "vipps-chat://payment-complete?session_id=cs-ABC123XYZ"
}
```

---

### Processing Payments

Upon receiving a call for completing a checkout with this handler, businesses
**MUST**:

1. **Validate Handler:** Confirm `instrument.handler_id` matches an advertised
   handler.
2. **Ensure Idempotency:** If the request is a retry (matches a previous
   `checkout_id` or idempotency key), return the previous result immediately
   without re-processing funds.
3. **Determine Payment Method:** Based on the instrument type:
   - `WALLET` → Use `paymentMethod: { type: "WALLET" }` and
     `userFlow: "PUSH_MESSAGE"`
   - `CARD` → Use `paymentMethod: { type: "CARD" }` and
     `userFlow: "WEB_REDIRECT"`
4. **Build Vipps API Request:** See [WALLET Payment Flow](#wallet-payment-flow)
   or [CARD Payment Flow](#card-payment-flow-redirect) below.
5. Call the
   [Vipps ePayment API CreatePayment](https://developer.vippsmobilepay.com/api/epayment/#tag/CreatePayments/operation/createPayment)
   endpoint.
6. **Return Response:** Based on instrument type:
   - `WALLET` → Return `status: complete_in_progress` with message to check
     Vipps app
   - `CARD` → Return `status: complete_in_progress` with `continue_url` for
     platform to redirect user
7. **Handle Vipps Callback and Poll:** When the user approves/rejects, Vipps
   sends a callback. Update the checkout session accordingly. As callbacks are
   not guaranteed, implement polling as a backup to check payment status. It is
   also possible to base this on webhooks if the platform supports that.
8. **Return Completed Order:** When the platform polls and payment is
   authorized, return `status: completed` with the order.

#### Vipps API `paymentMethod` Mapping

The `paymentMethod.type` field in the Vipps ePayment API **MUST** match the
instrument type:

| Instrument Type | Vipps `paymentMethod.type` | Vipps `userFlow` | Description                                   |
| :-------------- | :------------------------- | :--------------- | :-------------------------------------------- |
| `WALLET`        | `WALLET`                   | `PUSH_MESSAGE`   | Push notification to user's Vipps app         |
| `CARD`          | `CARD`                     | `WEB_REDIRECT`   | Redirect to Vipps payment page for card entry |

See the
[Vipps ePayment API documentation](https://developer.vippsmobilepay.com/api/epayment/#tag/CreatePayments/operation/createPayment)
for full details on the `paymentMethod` and `userFlow` fields.

---

### WALLET Payment Flow

The Vipps MobilePay `PUSH_MESSAGE` flow is **asynchronous** - the user must
approve the payment in their Vipps app. This can take seconds to minutes.
Businesses **MUST NOT** block the HTTP response waiting for user approval.

#### Why Async?

| Approach             | Problem                                        |
| -------------------- | ---------------------------------------------- |
| Block HTTP request   | Timeouts after 30s, user often needs more time |
| Short timeout (5s)   | User can't approve that fast                   |
| Keep connection open | Unreliable, poor scalability                   |

#### Recommended Flow

1. **Business creates payment** → Vipps returns `state: CREATED`
2. **Business returns immediately** with `status: complete_in_progress`
3. **Vipps sends push notification** to user's phone
4. **User approves** in Vipps app
5. **Vipps sends callback** to business with `state: AUTHORIZED`
6. **Business updates checkout** to `status: completed`
7. **Platform polls** and receives completed order

#### Complete Checkout Response (Pending Approval)

When the payment is created but awaiting user approval:

```json
{
  "id": "cs-ABC123XYZ",
  "status": "complete_in_progress",
  "messages": [
    {
      "type": "info",
      "code": "payment_pending_user_approval",
      "content": "A payment request has been sent to your Vipps app. Please open Vipps and approve the payment to complete your order."
    }
  ],
  "payment": {
    "state": "pending_approval",
    "expires_at": "2026-01-26T12:35:00Z"
  },
  "ucp": {
    "version": "2026-01-11",
    "capability": "dev.ucp.shopping.checkout"
  }
}
```

#### Message Codes

| Code                            | Type    | Instrument | Description                                                         |
| ------------------------------- | ------- | ---------- | ------------------------------------------------------------------- |
| `payment_pending_user_approval` | `info`  | WALLET     | Payment request sent, awaiting user approval in Vipps app           |
| `payment_redirect_required`     | `info`  | CARD       | User must be redirected to Vipps payment page to enter card details |
| `payment_approved`              | `info`  | Both       | User approved/completed the payment                                 |
| `payment_rejected`              | `error` | Both       | User rejected or cancelled the payment                              |
| `payment_expired`               | `error` | Both       | Payment request expired before user responded                       |

#### Timeout Handling

Businesses **SHOULD** implement timeout handling:

- **Default timeout:** 5 minutes from payment creation
- **On timeout:** Cancel the Vipps payment and set checkout to error state
- **Expose expiry:** Include `payment.expires_at` in responses

---

### Vipps Callback Handling

Businesses **MUST** implement a callback endpoint to receive payment status
updates from Vipps.

> **Important:** Vipps does not guarantee callback delivery. Businesses **MUST**
> also implement polling as a backup. See
> [Vipps Polling Guidelines](https://developer.vippsmobilepay.com/docs/knowledge-base/polling-guidelines/).

**Callback URL:** Configured in `VippsMerchantInfo.callbackUrl`

**Callback Payload:**

```json
{
  "reference": "cs-ABC123XYZ",
  "state": "AUTHORIZED",
  "pspReference": "1234567890"
}
```

**Callback States:**

| Vipps State  | Action                                        |
| ------------ | --------------------------------------------- |
| `AUTHORIZED` | Update checkout to `completed`, create order  |
| `ABORTED`    | Update checkout with error: user rejected     |
| `EXPIRED`    | Update checkout with error: payment expired   |
| `TERMINATED` | Update checkout with error: payment cancelled |

---

### Business-Side Polling (Backup)

Since Vipps callbacks are not guaranteed, businesses **MUST** implement polling
as a backup mechanism to check payment status.

**Vipps Polling Guidelines:**

- **Start polling:** 5 seconds after payment creation
- **Poll interval:** Every 2 seconds
- **Endpoint:** `GET /epayment/v1/payments/{reference}`

**Example Polling Logic:**

```javascript
async function pollVippsPaymentStatus(reference: string, maxAttempts = 150) {
  const POLL_INTERVAL_MS = 2000; // 2 seconds
  const INITIAL_DELAY_MS = 5000; // 5 seconds

  // Wait 5 seconds before starting
  await new Promise(resolve => setTimeout(resolve, INITIAL_DELAY_MS));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const payment = await getVippsPayment(reference);

    if (payment.state === "AUTHORIZED") {
      // Payment approved - complete the order
      return { success: true, state: "AUTHORIZED" };
    }

    if (["ABORTED", "EXPIRED", "TERMINATED"].includes(payment.state)) {
      // Payment failed - update checkout with error
      return { success: false, state: payment.state };
    }

    // Still CREATED - wait and poll again
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  // Timeout - treat as expired
  return { success: false, state: "TIMEOUT" };
}
```

> **Note:** The callback and polling mechanisms are complementary. Whichever
> receives the status update first should process it, and the other should
> recognize that processing has already occurred (idempotency).

---

### CARD Payment Flow (Redirect)

The CARD payment flow uses `WEB_REDIRECT` user flow. The user is redirected to
the Vipps MobilePay payment page to enter their card details. This flow is for
customers who do not have a Vipps MobilePay wallet.

#### CARD Flow Diagram

```
Platform                    Business                    Vipps                    User
   │                           │                          │                        │
   │ POST /complete            │                          │                        │
   │ (type: CARD, return_url)  │                          │                        │
   │──────────────────────────>│                          │                        │
   │                           │ CreatePayment            │                        │
   │                           │ (paymentMethod: CARD,    │                        │
   │                           │  userFlow: WEB_REDIRECT, │                        │
   │                           │  returnUrl)              │                        │
   │                           │─────────────────────────>│                        │
   │                           │ state: CREATED           │                        │
   │                           │ + redirectUrl            │                        │
   │                           │<─────────────────────────│                        │
   │ status: complete_in_progress                         │                        │
   │ + continue_url            │                          │                        │
   │<──────────────────────────│                          │                        │
   │                           │                          │                        │
   │ (redirects user)          │                          │                        │
   │───────────────────────────────────────────────────────────────────────────────>│
   │                           │                          │   User enters card     │
   │                           │                          │<───────────────────────│
   │                           │ Callback: AUTHORIZED     │                        │
   │                           │<─────────────────────────│                        │
   │                           │                          │  Redirect to returnUrl │
   │<───────────────────────────────────────────────────────────────────────────────│
   │                           │                          │                        │
   │ GET /checkout-sessions/id │                          │                        │
   │──────────────────────────>│                          │                        │
   │ status: completed + order │                          │                        │
   │<──────────────────────────│                          │                        │
```

#### CARD-Specific Request Fields

When creating a payment with `paymentMethod: { type: "CARD" }`, the business
**MUST** include:

| Field                | Description                                                                                   |
| :------------------- | :-------------------------------------------------------------------------------------------- |
| `paymentMethod.type` | **MUST** be `CARD`                                                                            |
| `userFlow`           | **MUST** be `WEB_REDIRECT`                                                                    |
| `returnUrl`          | The URL to redirect the user back to after payment. Use the `return_url` from the instrument. |

#### CARD Business Response

When the payment is created, Vipps returns a `redirectUrl`. The business
**MUST** return this to the platform as `continue_url` per the
[UCP Continue URL specification](https://ucp.dev/latest/specification/checkout/#continue-url).

The `continue_url` enables checkout handoff from platform to business UI,
allowing the buyer to complete the payment on the Vipps MobilePay payment page.
Per UCP, when `status` is `complete_in_progress`, the business is processing the
Complete Checkout request and may provide a `continue_url` for user interaction.

```json
{
  "id": "cs-ABC123XYZ",
  "status": "complete_in_progress",
  "continue_url": "https://api.vipps.no/checkout/v3/session/...",
  "messages": [
    {
      "type": "info",
      "code": "payment_redirect_required",
      "content": "Please complete your payment on the Vipps MobilePay payment page."
    }
  ],
  "payment": {
    "state": "pending_redirect",
    "expires_at": "2026-01-26T12:35:00Z"
  }
}
```

#### Platform Redirect Handling

When the platform receives a `complete_in_progress` response with a
`continue_url` and message code `payment_redirect_required`:

1. **Redirect the user:** Open the `continue_url` in a browser or webview to
   hand off to the Vipps payment page
2. **User completes payment:** User enters card details on the Vipps payment
   page
3. **Return redirect:** After payment, Vipps redirects user to the `returnUrl`
   provided in the instrument
4. **Poll for completion:** After redirect, poll `GET /checkout-sessions/{id}`
   to get the final status (`completed` or error)

**Return URL Formats:**

| Type           | Example                                                           | Use Case                   |
| :------------- | :---------------------------------------------------------------- | :------------------------- |
| Universal Link | `vipps-chat://payment-complete?session_id=cs-ABC123XYZ`           | Native mobile app          |
| Website URL    | `https://chat.vippsmobilepay.com/payment-complete?session_id=...` | Web-based chat or fallback |

> **Note:** The `returnUrl` should include sufficient context (e.g.,
> `session_id`) for the platform to resume the checkout flow after the user
> returns.

---

### Example Business Implementation

```javascript
const instrument: PaymentInstrument; // The payment instrument from the request
const checkout: Checkout; // The checkout with lineItems
const vippsCredentials: VippsCredentials; // Vipps Credentials
const accessToken: string; // The accessToken you received from Vipps
const idempotencyKey: string; // Your idempotency key

const url = "https://apitest.vipps.no/epayment/v1/payments"; // Replace for production

/**
 * Build the Vipps API request body based on instrument type.
 * See: https://developer.vippsmobilepay.com/api/epayment/#tag/CreatePayments/operation/createPayment
 */
function buildVippsPaymentRequest(instrument: PaymentInstrument, checkout: Checkout) {
  const baseRequest = {
    amount: {
      currency: checkout.currency,
      value: checkout.totals.amount
    },
    reference: checkout.id,
    paymentDescription: `Order ${checkout.id}`
  };

  if (instrument.type === "WALLET") {
    // WALLET: Use PUSH_MESSAGE flow with customer credential
    return {
      ...baseRequest,
      customer: buildCustomerObject(instrument.credential),
      paymentMethod: {
        type: "WALLET"  // REQUIRED for WALLET instruments
      },
      userFlow: "PUSH_MESSAGE"
    };
  } else if (instrument.type === "CARD") {
    // CARD: Use WEB_REDIRECT flow, no customer credential needed
    return {
      ...baseRequest,
      paymentMethod: {
        type: "CARD"  // REQUIRED for CARD instruments
      },
      userFlow: "WEB_REDIRECT",
      returnUrl: instrument.return_url  // Platform provides this for redirect back
    };
  }

  throw new Error(`Unsupported instrument type: ${instrument.type}`);
}

/**
 * Build the customer object for WALLET payments based on credential type.
 */
function buildCustomerObject(credential: WalletCredential): { phoneNumber?: string; customerToken?: string } {
  switch (credential.type) {
    case "MSISDN":
      return { phoneNumber: credential.value };
    case "TOKEN":
      return { customerToken: credential.value };
    default:
      throw new Error(`Unsupported credential type: ${credential.type}`);
  }
}

const body = buildVippsPaymentRequest(instrument, checkout);

const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${accessToken}`,
    "Ocp-Apim-Subscription-Key": vippsCredentials.subscriptionKey,
    "Merchant-Serial-Number": vippsCredentials.merchantSerialNumber,
    "Idempotency-Key": idempotencyKey
  },
  body: JSON.stringify(body)
});

const payment = await response.json();

if (!response.ok) {
  return mapVippsErrorToUCPResponse(response.status, payment);
}

// Build response based on instrument type
checkout.status = "complete_in_progress";
checkout.payment = {
  vipps_reference: payment.reference,
  expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
};

if (instrument.type === "WALLET") {
  // WALLET: Return message to check Vipps app
  checkout.payment.state = "pending_approval";
  checkout.messages = [{
    type: "info",
    code: "payment_pending_user_approval",
    content: "A payment request has been sent to your Vipps app. Please open Vipps and approve the payment."
  }];
} else if (instrument.type === "CARD") {
  // CARD: Return continue_url for platform to redirect user (per UCP spec)
  checkout.payment.state = "pending_redirect";
  checkout.continue_url = payment.redirectUrl;  // From Vipps response, returned as continue_url
  checkout.messages = [{
    type: "info",
    code: "payment_redirect_required",
    content: "Please complete your payment on the Vipps MobilePay payment page."
  }];
}

return checkout;
```

**TypeScript Types:**

```typescript
type InstrumentType = "WALLET" | "CARD";
type CredentialType = "MSISDN" | "TOKEN";

interface WalletCredential {
  type: CredentialType;
  value: string;
}

interface WalletInstrument {
  type: "WALLET";
  credential: WalletCredential;
}

interface CardInstrument {
  type: "CARD";
  return_url: string; // Universal link or website URL
}

type PaymentInstrument = WalletInstrument | CardInstrument;

// Example Vipps API payloads:

// WALLET with MSISDN -> paymentMethod.type: "WALLET", customer.phoneNumber
const walletMsisdnPayload = {
  paymentMethod: { type: "WALLET" },
  userFlow: "PUSH_MESSAGE",
  customer: { phoneNumber: "4712345678" },
  // ... other fields
};

// WALLET with TOKEN -> paymentMethod.type: "WALLET", customer.customerToken
const walletTokenPayload = {
  paymentMethod: { type: "WALLET" },
  userFlow: "PUSH_MESSAGE",
  customer: { customerToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
  // ... other fields
};

// CARD -> paymentMethod.type: "CARD", no customer field needed
const cardPayload = {
  paymentMethod: { type: "CARD" },
  userFlow: "WEB_REDIRECT",
  returnUrl: "vipps-chat://payment-complete?session_id=cs-ABC123XYZ",
  // ... other fields
};
```

### Error Handling

Businesses **MUST** map Vipps MobilePay API errors to UCP error format. The
following table shows the recommended mapping:

| HTTP Status | Vipps Error Context        | UCP Error Code                | UCP Severity           | User-Facing Message                                                                                            |
| :---------- | :------------------------- | :---------------------------- | :--------------------- | :------------------------------------------------------------------------------------------------------------- |
| 400         | Phone/MSISDN validation    | `invalid_phone_number`        | `recoverable`          | The provided phone number is invalid. Please verify the format.                                                |
| 400         | Customer token validation  | `invalid_customer_token`      | `recoverable`          | The provided customer token is invalid or expired. Please re-authenticate.                                     |
| 400         | Other validation errors    | `invalid_payment_data`        | `recoverable`          | The payment request contains invalid data. Please verify and try again.                                        |
| 401         | Authentication failed      | `payment_service_error`       | `recoverable`          | Payment service encountered an error. Please try again.                                                        |
| 403         | Authorization denied       | `payment_service_error`       | `recoverable`          | Payment service encountered an error. Please try again.                                                        |
| 404         | Customer/Wallet not found  | `wallet_not_found`            | `requires_buyer_input` | No wallet account found for the provided identifier. Please ensure the wallet app is installed and registered. |
| 409         | Duplicate payment/Conflict | `duplicate_payment`           | `recoverable`          | A payment request for this checkout is already being processed.                                                |
| 429         | Rate limited               | `too_many_requests`           | `recoverable`          | Too many requests. Please wait a moment and try again.                                                         |
| 5xx         | Server errors              | `payment_service_unavailable` | `recoverable`          | Payment service is temporarily unavailable. Please try again.                                                  |
| Other       | Unknown/Unhandled          | `payment_failed`              | `recoverable`          | Payment processing failed. Please try again.                                                                   |

**Important:** Error messages returned to platforms should be opaque and
user-friendly. Do not expose internal Vipps API error details to prevent
information leakage. Detailed errors should be logged server-side for debugging
purposes.

**Example UCP Error Response:**

```json
{
  "messages": [
    {
      "type": "error",
      "code": "wallet_not_found",
      "severity": "requires_buyer_input",
      "content": "No wallet account found for this phone number. Please ensure the wallet app is installed and registered.",
      "path": "$.payment.instruments[0]"
    }
  ]
}
```

---

## Platform Integration

### Prerequisites

Before using this handler, Platforms **MUST** complete:

1. If applicable: Register with merchant to allow to call their
   `checkout_sessions` endpoint. This could involve getting an access token
2. Obtain a valid customer identifier based on the credential type:
   - **MSISDN:** Capture the user's MSISDN registered with Vipps MobilePay. A
     suggestion is to implement the
     [Vipps Login Product](https://developer.vippsmobilepay.com/docs/APIs/login-api/)
     in your application.
   - **TOKEN:** Obtain a customer token from an authenticated session.

**Prerequisites Output:**

| Field                     | Description                                                              |
| :------------------------ | :----------------------------------------------------------------------- |
| `merchant.access_token`   | Access token to call merchant (if applicable)                            |
| `vippsUser.msisdn`        | Vipps user MSISDN registered on their wallet (for MSISDN credential)     |
| `vippsUser.customerToken` | Encoded customer token from authenticated session (for TOKEN credential) |

### Payment Protocol

Platforms **MUST** follow this flow to acquire a payment instrument:

#### Step 1: Discover Handler

The Platform identifies `com.vippsmobilepay.pay.payment_handler` in the
business's `payment.handlers` array.

```json
{
  "id": "vipps_mobilepay",
  "name": "com.vippsmobilepay.pay.payment_handler",
  "version": "2026-01-23",
  "config": {
    "merchant_serial_number": "123456",
    "environment": "PRODUCTION"
  }
}
```

#### Step 2: Choose Payment Method and Gather Required Data

The Platform **MUST** determine which payment method to use based on whether the
customer has a Vipps MobilePay wallet:

**Option A: WALLET (User has Vipps MobilePay wallet)**

For users with a Vipps MobilePay wallet, use the WALLET instrument. The Platform
**MUST** obtain a customer identifier:

- **MSISDN:** Prompt the user for their MSISDN registered with Vipps MobilePay.
  Use the
  [Vipps Login Product](https://developer.vippsmobilepay.com/docs/APIs/login-api/)
  to authenticate and retrieve the MSISDN.
- **TOKEN:** Use an encoded customer token obtained from an authenticated
  session.

**Option B: CARD (User does not have Vipps MobilePay wallet)**

For users without a Vipps MobilePay wallet, use the CARD instrument. The
Platform **MUST** provide:

- **return_url:** The URL to redirect the user back to after payment. This can
  be:
  - **Universal Link:** e.g., `vipps-chat://payment-complete?session_id=...`
    (for native mobile apps)
  - **Website URL:** e.g.,
    `https://chat.vippsmobilepay.com/payment-complete?session_id=...` (for
    web-based platforms)

> **Tip:** Include the checkout session ID in the return URL so the platform can
> resume the checkout flow after redirect.

#### Step 3: Complete Checkout

The Platform submits the checkout with the constructed payment instrument.

**Example with MSISDN credential:**

```json
POST /checkout-sessions/{checkout_id}/complete
Content-Type: application/json

{
  "payment_data": {
    "id": "instr_vipps_1",
    "handler_id": "vipps_mobilepay",
    "type": "WALLET",
    "credential": {
      "type": "MSISDN",
      "value": "4712345678"
    }
  },
  "risk_signals": {
    "device_id": "device_abc123",
    "session_id": "session_xyz789",
    "ip_address": "192.168.1.1",
    "user_agent": "Mozilla/5.0 ...",
    "accept_language": "nb-NO"
  }
}
```

**Example with TOKEN credential:**

```json
POST /checkout-sessions/{checkout_id}/complete
Content-Type: application/json

{
  "payment_data": {
    "id": "instr_vipps_1",
    "handler_id": "vipps_mobilepay",
    "type": "WALLET",
    "credential": {
      "type": "TOKEN",
      "value": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
}
```

**Example with CARD instrument (No wallet required):**

```json
POST /checkout-sessions/{checkout_id}/complete
Content-Type: application/json

{
  "payment_data": {
    "id": "instr_card_1",
    "handler_id": "vipps_mobilepay",
    "type": "CARD",
    "return_url": "vipps-chat://payment-complete?session_id=cs-ABC123XYZ"
  }
}
```

#### Step 4: Handle Async Response

Both WALLET and CARD flows return `status: complete_in_progress`. The Platform
**MUST** handle the response based on the message code:

**WALLET Response (pending user approval in Vipps app):**

```json
{
  "id": "cs-ABC123XYZ",
  "status": "complete_in_progress",
  "messages": [
    {
      "type": "info",
      "code": "payment_pending_user_approval",
      "content": "A payment request has been sent to your Vipps app. Please open Vipps and approve the payment to complete your order."
    }
  ],
  "payment": {
    "state": "pending_approval",
    "expires_at": "2026-01-26T12:35:00Z"
  }
}
```

**CARD Response (redirect required):**

```json
{
  "id": "cs-ABC123XYZ",
  "status": "complete_in_progress",
  "continue_url": "https://api.vipps.no/checkout/v3/session/...",
  "messages": [
    {
      "type": "info",
      "code": "payment_redirect_required",
      "content": "Please complete your payment on the Vipps MobilePay payment page."
    }
  ],
  "payment": {
    "state": "pending_redirect",
    "expires_at": "2026-01-26T12:35:00Z"
  }
}
```

**Platform behavior for WALLET (`payment_pending_user_approval`):**

1. **Inform the user:** Display the message content (e.g., "Please check your
   Vipps app to approve the payment")
2. **Poll for completion:** Call `GET /checkout-sessions/{checkout_id}` every
   2-5 seconds
3. **Check status:** Continue polling until `status` is `completed` or an error
   state
4. **Handle timeout:** If `payment.expires_at` passes, inform user the payment
   expired

**Platform behavior for CARD (`payment_redirect_required`):**

Per the
[UCP Continue URL specification](https://ucp.dev/latest/specification/checkout/#continue-url),
the `continue_url` enables checkout handoff from platform to business UI:

1. **Redirect the user:** Open the `continue_url` in a browser or webview to
   hand off to the Vipps payment page
2. **User completes payment:** User enters card details on the Vipps payment
   page
3. **Handle return:** After payment, Vipps redirects user back to the
   `return_url` provided in the instrument
4. **Resume checkout:** Extract session ID from URL and poll
   `GET /checkout-sessions/{id}` for final status (`completed` or error)

#### Step 5: Poll for Completion

```json
GET /checkout-sessions/{checkout_id}
```

**Response when payment is approved:**

```json
{
  "id": "cs-ABC123XYZ",
  "status": "completed",
  "order": {
    "id": "order-789",
    "reference": "ORD-2026-001234",
    "created_at": "2026-01-26T12:32:15Z"
  },
  "messages": [
    {
      "type": "info",
      "code": "payment_approved",
      "content": "Payment approved. Your order has been placed."
    }
  ]
}
```

**Response when user rejects:**

```json
{
  "id": "cs-ABC123XYZ",
  "status": "incomplete",
  "messages": [
    {
      "type": "error",
      "code": "payment_rejected",
      "severity": "requires_buyer_input",
      "content": "Payment was declined. Please try again or choose a different payment method."
    }
  ]
}
```

#### Polling Best Practices

| Recommendation          | Details                                         |
| ----------------------- | ----------------------------------------------- |
| **Poll interval**       | 2-5 seconds initially, increase if many retries |
| **Max duration**        | Stop after `payment.expires_at` + small buffer  |
| **Exponential backoff** | Consider increasing interval after 30 seconds   |
| **User feedback**       | Show progress indicator while polling           |

---

## Security Considerations

| Requirement           | Description                                                                                                                                                                                |
| :-------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TLS Required**      | All communication with the Vipps MobilePay API **MUST** use TLS 1.2 or higher. Connections using older TLS versions will be rejected.                                                      |
| **MSISDN Validation** | For MSISDN credentials, the value **MUST** be validated to ensure it is a valid phone number format (digits only, 7-15 digits, no leading zero) before sending to the Vipps MobilePay API. |
| **TOKEN Validation**  | For TOKEN credentials, the value **MUST** be validated to ensure it is a non-empty string. Token validity is verified by the Vipps MobilePay API.                                          |
| **Data Residency**    | All payment data is processed within the EEA (European Economic Area). PII is handled according to GDPR requirements.                                                                      |

---

## References

- **Handler Spec:**
  `https://vippsmobilepay.com/pay/ucp/2026-01-23/vipps_mp_payment_handler`
- **Config Schema:**
  `https://vippsmobilepay.com/pay/ucp/2026-01-23/schemas/wallet_payment_handler.json`
- **Instrument Schema:**
  `https://vippsmobilepay.com/pay/ucp/2026-01-23/schemas/payment_instrument.json`
- **Credential Schema:**
  `https://vippsmobilepay.com/pay/ucp/2026-01-23/schemas/wallet_payment_credential.json`
