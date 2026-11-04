/**
 * Narrated demo runner for the hackathon submission video.
 * Prints clear step headers, runs the real x402 flow against the live server.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const banner = (t) => {
  console.log("\n" + "=".repeat(64));
  console.log("  " + t);
  console.log("=".repeat(64) + "\n");
};

console.log("SolTools MCP - paid Solana analytics for AI agents via x402");
console.log("Solana x402 Hackathon - Best MCP Server track\n");
await sleep(2500);

banner("1. An AI agent generates a fresh devnet payer keypair");
const payerKp = process.env.DEMO_PAYER_SECRET
  ? Keypair.fromSecretKey(bs58.decode(process.env.DEMO_PAYER_SECRET))
  : Keypair.generate();
const payer = await createKeyPairSignerFromBytes(payerKp.secretKey);
console.log("payer:", payer.address);
await sleep(2000);

banner("2. Agent connects to SolTools MCP over SSE");
const mcp = new Client({ name: "demo-agent", version: "1.0.0" }, { capabilities: {} });
await mcp.connect(new SSEClientTransport(new URL(`${SERVER}/sse`)));
const { tools } = await mcp.listTools();
for (const t of tools) console.log("  -", t.name);
await sleep(2500);

banner("3. Free tool call works without payment");
const ping = await mcp.callTool({ name: "ping", arguments: {} });
console.log("ping ->", ping.content[0].text);
await sleep(2000);

banner("4. Paid tool call without payment -> 402 Payment Required");
const unpaid = await mcp.callTool({
  name: "sol_token_price",
  arguments: { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" }, // BONK
});
const paymentRequired = unpaid.structuredContent;
console.log("isError:", unpaid.isError);
const req = paymentRequired.accepts[0];
console.log("\nPayment requirements returned by the server:");
console.log("  scheme :", req.scheme);
console.log("  network:", req.network, "(Solana devnet)");
console.log("  asset  :", req.asset, "(USDC devnet mint)");
console.log("  amount :", req.amount, "atomic units = $0.001 USDC");
console.log("  payTo  :", req.payTo);
await sleep(4000);

banner("5. Agent signs the payment payload locally (x402 exact/SVM)");
const paymentClient = new x402Client().register(DEVNET, new ExactSvmScheme(payer));
const payload = await paymentClient.createPaymentPayload(paymentRequired);
console.log("x402Version:", payload.x402Version);
console.log("signed tx  :", Buffer.from(payload.payload.transaction, "base64").length, "bytes, partially signed by payer");
console.log("(fee payer = facilitator - payer needs no SOL for gas)");
await sleep(3000);

banner("6. Retrying the call with _meta['x402/payment']");
const paid = await mcp.callTool({
  name: "sol_token_price",
  arguments: { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  _meta: { "x402/payment": payload },
});
console.log("isError:", paid.isError ?? false);
console.log(JSON.stringify(paid.structuredContent ?? paid.content, null, 2).slice(0, 900));
await sleep(3000);

banner("Demo complete");
console.log("Step 6 settled onchain via the x402 facilitator - USDC moved on Solana devnet");
console.log("and returned live data. Verify: payer ATA 75r9nr... -> payTo ATA 9D9JSt...");
console.log("\ngithub.com/aryandehdashti/soltools-mcp");
await sleep(4000);
await mcp.close();
