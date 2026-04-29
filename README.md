# x402-skale-starter

**Tax-compliant x402 Hono merchant for SKALE Network.** Gasless settlement + US sales-tax recording on every transaction.

> Taxes included — powered by [AgentTax](https://agenttax.io).
>
> SKALE is gasless, which makes sub-cent x402 payments economically viable. At the volumes that unlocks, US sales tax becomes a real obligation — and no existing tax API (Avalara, Stripe Tax) can afford to serve it per-call. AgentTax can. 100 calls/mo free, no credit card.
>
> Full guide: [agenttax.io/integrations/skale](https://agenttax.io/integrations/skale).

---

This starter is a fork of [`PayAINetwork/x402-hono-starter`](https://github.com/PayAINetwork/x402-hono-starter) (Apache-2.0), retargeted at SKALE Europa mainnet with DirtRoad's facilitator and AgentTax's tax-compliance recording layer.

## What it does

- Accepts x402 payments on **SKALE Europa mainnet** (`eip155:324705682`) in bridged USDC
- Settles through **DirtRoad's x402 facilitator** (`https://facilitator.dirtroad.dev`)
- After each successful settlement, records the transaction to **AgentTax** (51 US jurisdictions) so you have a 1099-DA-ready audit trail and per-state obligation data at filing time

## Prerequisites

- Node.js v18+
- A SKALE (EVM-format) receiving address
- An AgentTax API key — free at [agenttax.io/pricing](https://agenttax.io/pricing)

## Setup

1. Copy `.env-local` to `.env` and fill in:

```
RECEIVING_ADDRESS=0x...         # Your SKALE payout address
AGENTTAX_API_KEY=atx_live_...   # Free at agenttax.io/pricing
AGENTTAX_DEFAULT_STATE=TX       # Fallback buyer state (2-letter US)
```

Optional overrides (uncomment in `.env`):

```
# PAYMENT_TOKEN_ADDRESS=0x2e08028E3C4c2356572E096d8EF835cD5C6030bD   # SKALE bridged USDC (default)
# FACILITATOR_URL=https://facilitator.dirtroad.dev                   # DirtRoad facilitator (default)
```

2. Install dependencies:

```bash
npm install
```

3. Run the server:

```bash
npm run dev
```

The server fails fast at boot if `RECEIVING_ADDRESS` or `AGENTTAX_API_KEY` is missing — no silent startup with broken config.

## How the tax layer works

The `@x402/hono` middleware handles settlement. Your `/paid` route runs **after** a successful settlement — that's where this starter calls AgentTax:

- POST `https://agenttax.io/api/v1/calculate` with the amount, `role: "seller"`, buyer state, and a counterparty identifier (the payer address from the `x-payer-address` header, when available).
- AgentTax returns a `transaction_id`, the tax breakdown (`sales_tax.amount`, `sales_tax.combined_rate`, `sales_tax.buyer_state`), and a confidence score.
- The handler returns both the paid resource AND the AgentTax record so downstream clients see exactly what was logged.
- If AgentTax is unreachable, the handler still returns the resource — payment already settled — but logs `agenttax: { error: "record_failed" }` so you can reconcile later.

You've collected full payment (gasless — SKALE never charges gas). AgentTax has the obligation logged per state. At filing time, export the records via the AgentTax dashboard or the `/api/v1/transactions` endpoint.

## Why SKALE specifically

SKALE is gasless. On Base, an x402 transaction costs $0.01–$0.05 in gas per settlement — which means selling $0.0001 API calls is unprofitable. On SKALE, the gas cost is literally zero. A merchant can do 100K transactions a day at sub-cent prices and actually make money. That's the scale where per-transaction tax compliance stops being a rounding error and starts being a real obligation. AgentTax is built for it.

## Testing the server

Any x402 client that speaks the v2 protocol against `eip155:324705682` will work — see SKALE's [x402 cookbook](https://docs.skale.space/cookbook/x402/accepting-payments) for client examples. An unpaid `GET /paid` returns `402 Payment Required` with a `PAYMENT-REQUIRED` header describing the accepted payment shape.

## Network identifiers

SKALE Base runs on two chains:

| Network | Chain ID | CAIP-2 | Status |
|---|---|---|---|
| SKALE Base Sepolia Testnet | `324705682` | `eip155:324705682` | default — safe for dev / demos |
| SKALE Base Mainnet | `1187947933` | `eip155:1187947933` | production |

Flip via `SKALE_CHAIN_ID` env var. Docs: <https://docs.skale.space/get-started/quick-start/skale-on-base>.

The default payment token (`0x2e08028E3C4c2356572E096d8EF835cD5C6030bD`) is bridged USDC on Sepolia. Mainnet token addresses are not yet published in SKALE's public docs — when you flip to mainnet, set `PAYMENT_TOKEN_ADDRESS` explicitly (ask the SKALE Builders Chat for the current mainnet token list).

## License

Apache-2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE), and [CREDITS.md](CREDITS.md) for upstream attribution (Coinbase x402, PayAI Hono starter, DirtRoad facilitator). AgentTax modifications © Agentic Tax Solutions LLC.
