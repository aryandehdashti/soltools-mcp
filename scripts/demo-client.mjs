/**
 * End-to-end x402 payment demo client for soltools-mcp.
 *
 * Demonstrates the complete MCP + x402 payment flow on Solana devnet:
 *   1. Connect to the MCP server over SSE
 *   2. Call a free tool (ping)
 *   3. Call a paid tool without payment -> receive HTTP-402-style
 *      payment requirements (devnet USDC)
 *   4. Build & sign the payment payload client-side (ExactSvmScheme)
 *   5. Retry the tool call with _meta["x402/payment"] -> server verifies
 *      and settles via the x402 facilitator
 *
 * For settlement to succeed the payer needs devnet USDC (mint
 * 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU) - claimable at
 * https://faucet.circle.com (select Solana Devnet). A fresh keypair is
 * generated per run; export DEMO_PAYER_SECRET (base58, 64-byte) to reuse
 * a funded one.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const SERVER = process.env.SERVER_URL ?? "http://localhost:4022";
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const TARGET_WALLET = process.env.DEMO_TARGET ?? "DZdTYcN6qKDi9exBmF8XaBjKapR1pBUsakxzXEnWmihX";

const log = (step, msg) => console.log(`\n\x1b[36m[${step}]\x1b[0m ${msg}`);

// ---- 1. Payer keypair ----------------------------------------------------
const payerKp = process.env.DEMO_PAYER_SECRET
  ? Keypair.fromSecretKey(bs58.decode(process.env.DEMO_PAYER_SECRET))
  : Keypair.generate();
const payer = await createKeyPairSignerFromBytes(payerKp.secretKey);
log("payer", `address: ${payer.address}  (devnet)`);

// ---- 2. Connect to the MCP server ---------------------------------------
const mcp = new Client({ name: "soltools-demo-agent", version: "1.0.0" }, { capabilities: {} });
await mcp.connect(new SSEClientTransport(new URL(`${SERVER}/sse`)));
log("connect", `connected to ${SERVER}/sse`);

const { tools } = await mcp.listTools();
log("tools", tools.map((t) => t.name).join(", "));

// ---- 3. Free tool --------------------------------------------------------
const ping = await mcp.callTool({ name: "ping", arguments: {} });
log("free call", `ping -> ${ping.content[0].text}`);

// ---- 4. Paid tool without payment -> 402 ---------------------------------
const unpaid = await mcp.callTool({
  name: "sol_balance",
  arguments: { address: TARGET_WALLET },
});
log("unpaid call", `isError=${unpaid.isError} text="${unpaid.content[0].text}"`);

const paymentRequired = unpaid.structuredContent;
if (!paymentRequired?.accepts?.length) {
  console.error("No payment requirements in response:", JSON.stringify(unpaid).slice(0, 800));
  process.exit(1);
}
const req = paymentRequired.accepts[0];
log("402 requirements", JSON.stringify({
  scheme: req.scheme,
  network: req.network,
  asset: req.asset,
  amount: `${req.amount} atomic units (USDC, 6 decimals)`,
  payTo: req.payTo,
}, null, 2));

// ---- 5. Sign the payment payload ----------------------------------------
const paymentClient = new x402Client().register(DEVNET, new ExactSvmScheme(payer));
const payload = await paymentClient.createPaymentPayload(paymentRequired);
const txBytes = Buffer.from(payload.payload.transaction, "base64");
log("signed payload", `x402Version=${payload.x402Version} scheme=${payload.accepted.scheme} tx=${txBytes.length}B (partially signed by payer)`);

// ---- 6. Paid retry --------------------------------------------------------
const paid = await mcp.callTool({
  name: "sol_balance",
  arguments: { address: TARGET_WALLET },
  _meta: { "x402/payment": payload },
});
log("paid call", `isError=${paid.isError ?? false}`);
console.log(JSON.stringify(paid.structuredContent ?? paid.content, null, 2).slice(0, 1200));

await mcp.close();
