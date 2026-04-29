import { config } from "dotenv";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
config();

// SKALE Base — gasless EVM chains. Configurable via env so the same starter
// drives Sepolia testnet for dev and mainnet for production.
//   • SKALE Base Sepolia Testnet: chainId 324705682   (default — safe to demo)
//   • SKALE Base Mainnet:         chainId 1187947933  (production)
// Reference: https://docs.skale.space/get-started/quick-start/skale-on-base
const SKALE_CHAIN_ID = Number(process.env.SKALE_CHAIN_ID || 324705682);
const SKALE_NETWORK = `eip155:${SKALE_CHAIN_ID}` as const;

// SKALE Base Sepolia bridged USDC, 6 decimals. Override via PAYMENT_TOKEN_ADDRESS.
// Mainnet token addresses are not yet published in SKALE's public docs — set
// PAYMENT_TOKEN_ADDRESS explicitly when running on mainnet (chain 1187947933).
const DEFAULT_PAYMENT_TOKEN = "0x2e08028E3C4c2356572E096d8EF835cD5C6030bD";

// DirtRoad runs the x402 facilitator for SKALE. Override via FACILITATOR_URL.
const DEFAULT_FACILITATOR_URL = "https://facilitator.dirtroad.dev";

const receivingAddress = process.env.RECEIVING_ADDRESS as `0x${string}` | undefined;
if (!receivingAddress) {
  console.error("Missing RECEIVING_ADDRESS — set an Ethereum-format address to receive SKALE payments.");
  process.exit(1);
}

const paymentToken = (process.env.PAYMENT_TOKEN_ADDRESS || DEFAULT_PAYMENT_TOKEN) as `0x${string}`;
const facilitatorUrl = process.env.FACILITATOR_URL || DEFAULT_FACILITATOR_URL;

// AgentTax — tax compliance recording on every settled transaction.
const agentTaxKey = process.env.AGENTTAX_API_KEY;
const agentTaxDefaultState = process.env.AGENTTAX_DEFAULT_STATE || "TX";
if (!agentTaxKey) {
  console.error(
    "Missing AGENTTAX_API_KEY — get a free key (100 calls/mo) at https://agenttax.io/pricing",
  );
  process.exit(1);
}

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });

const app = new Hono();

app.use(
  paymentMiddleware(
    {
      "GET /paid": {
        accepts: [
          {
            scheme: "exact",
            network: SKALE_NETWORK,
            payTo: receivingAddress,
            price: {
              amount: "10000", // 0.01 USDC in atomic units (6 decimals)
              asset: paymentToken,
            },
          },
        ],
        description: "Paid resource — settled gasless on SKALE, tax-recorded on AgentTax.",
        mimeType: "application/json",
      },
    },
    new x402ResourceServer(facilitatorClient)
      .register(SKALE_NETWORK, new ExactEvmScheme()),
  ),
);

type AgentTaxResponse = {
  transaction_id?: string;
  sales_tax?: {
    amount?: number;
    combined_rate?: number;
    buyer_state?: string;
  };
  confidence?: { score?: number; level?: string };
};

// Record a settled SKALE transaction to AgentTax. Runs after settlement completes.
async function recordTax(params: {
  amount: number;
  buyerState: string;
  buyerZip?: string;
  counterpartyId?: string;
}): Promise<AgentTaxResponse> {
  const res = await fetch("https://agenttax.io/api/v1/calculate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${agentTaxKey}`,
    },
    body: JSON.stringify({
      role: "seller",
      amount: params.amount,
      buyer_state: params.buyerState,
      buyer_zip: params.buyerZip,
      transaction_type: "compute",
      counterparty_id: params.counterpartyId || "anonymous",
    }),
  });
  if (!res.ok) throw new Error(`AgentTax ${res.status}: ${await res.text()}`);
  return res.json() as Promise<AgentTaxResponse>;
}

app.get("/paid", async c => {
  const buyerState = c.req.query("buyer_state") || agentTaxDefaultState;
  const buyerZip = c.req.query("buyer_zip") || undefined;
  const counterpartyId = c.req.header("x-payer-address") || undefined;

  let agenttax: Record<string, unknown>;
  try {
    const tax = await recordTax({
      amount: 0.01, // must match the price above in decimal units
      buyerState,
      buyerZip,
      counterpartyId,
    });
    agenttax = {
      transaction_id: tax.transaction_id,
      tax_amount: tax.sales_tax?.amount,
      tax_rate: tax.sales_tax?.combined_rate,
      jurisdiction: tax.sales_tax?.buyer_state,
    };
  } catch (err) {
    // Payment already settled — don't fail the response. Log for reconciliation.
    console.error("[agenttax] record failed:", err);
    agenttax = { error: "record_failed", message: String(err) };
  }

  return c.json({
    data: {
      message: "Paid resource accessed — gasless on SKALE.",
      chain_id: SKALE_CHAIN_ID,
    },
    agenttax,
  });
});

serve({ fetch: app.fetch, port: 4021 });

console.log(`Server listening at http://localhost:4021`);
console.log(`SKALE network: ${SKALE_NETWORK} (gasless)`);
console.log(`Facilitator: ${facilitatorUrl}`);
console.log(`Tax compliance: AgentTax (${agentTaxKey?.slice(0, 10)}…, default state ${agentTaxDefaultState})`);
