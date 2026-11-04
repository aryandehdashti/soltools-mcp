/**
 * SolTools MCP - paid Solana analytics tools for AI agents via x402 micropayments.
 *
 * Free tools: ping, list_tools
 * Paid tools (x402 exact scheme, USDC on Solana devnet):
 *   - sol_balance         - SOL + SPL token balances for any address
 *   - sol_token_price     - price / mcap / liquidity from DexScreener
 *   - sol_wallet_analysis - full portfolio with USD valuation
 *   - sol_tx_lookup       - transaction details by signature
 */

import { config } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { createPaymentWrapper, x402ResourceServer } from "@x402/mcp";
import { HTTPFacilitatorClient } from "@x402/core/server";
import express from "express";
import { z } from "zod";
import { SOLANA_DEVNET, rpc, dexscreener, formatUsd, shortAddr } from "./solana.js";

config();

const payToEnv = process.env.SOLANA_PAY_TO_ADDRESS;
if (!payToEnv) {
  console.error("SOLANA_PAY_TO_ADDRESS env var is required (Solana address receiving payments)");
  process.exit(1);
}
const payTo: string = payToEnv;

const facilitatorUrl = process.env.FACILITATOR_URL;
if (!facilitatorUrl) {
  console.error("FACILITATOR_URL env var is required (x402 facilitator /verify /settle endpoint)");
  process.exit(1);
}

const port = parseInt(process.env.PORT || "4022", 10);

interface TokenHolding {
  mint: string;
  symbol?: string;
  amount: number;
  decimals: number;
  priceUsd?: number;
  valueUsd?: number;
}

async function getBalances(address: string): Promise<{ sol: number; tokens: TokenHolding[] }> {
  const [lamports, parsed] = await Promise.all([
    rpc("getBalance", [address]),
    rpc("getTokenAccountsByOwner", [address, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }]),
  ]);
  const tokens: TokenHolding[] = [];
  for (const acc of parsed?.value ?? []) {
    const info = acc.account.data.parsed?.info;
    const amt = Number(info?.tokenAmount?.uiAmount ?? 0);
    if (amt > 0) {
      tokens.push({ mint: info.mint, amount: amt, decimals: info.tokenAmount.decimals });
    }
  }
  return { sol: (lamports?.value ?? 0) / 1e9, tokens };
}

async function getTokenMeta(mint: string): Promise<{ symbol?: string; priceUsd?: number }> {
  const d = await dexscreener("tokens/" + mint);
  const pair = (d?.pairs ?? []).find((p: { chainId: string }) => p.chainId === "solana");
  return {
    symbol: pair?.baseToken?.symbol,
    priceUsd: pair?.priceUsd ? Number(pair.priceUsd) : undefined,
  };
}

export async function main(): Promise<void> {
  const mcpServer = new McpServer({ name: "soltools-mcp", version: "1.0.0" });

  const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitatorClient);
  resourceServer.register(SOLANA_DEVNET, new ExactSvmScheme({ rpcUrl: process.env.SOLANA_RPC_URL }));
  await resourceServer.initialize();

  const paid = async (price: string) =>
    createPaymentWrapper(resourceServer, {
      accepts: await resourceServer.buildPaymentRequirements({
        scheme: "exact",
        network: SOLANA_DEVNET,
        payTo,
        price,
      }),
    });

  // ---- Free tools ----
  mcpServer.tool("ping", "Free health check", {}, async () => ({
    content: [{ type: "text" as const, text: "pong - SolTools MCP is up" }],
  }));

  mcpServer.tool(
    "list_tools",
    "Free: list all tools with their x402 prices",
    {},
    async () => ({
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          free: ["ping", "list_tools"],
          paid: {
            sol_balance: "$0.001 - SOL + SPL token balances for any address",
            sol_token_price: "$0.001 - price/mcap/liquidity for a token mint",
            sol_wallet_analysis: "$0.005 - full portfolio with USD valuation",
            sol_tx_lookup: "$0.002 - transaction details by signature",
          },
          network: SOLANA_DEVNET,
          asset: "USDC (devnet)",
        }, null, 2),
      }],
    }),
  );

  // ---- Paid tools ----
  mcpServer.tool(
    "sol_balance",
    "Get SOL and SPL token balances for any address. Paid: $0.001 USDC.",
    { address: z.string().describe("Solana address (base58)") },
    (await paid("$0.001"))(async (args: { address: string }) => {
      const b = await getBalances(args.address);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            address: shortAddr(args.address),
            sol: b.sol,
            tokenCount: b.tokens.length,
            tokens: b.tokens.slice(0, 20).map((t) => ({ mint: shortAddr(t.mint), amount: t.amount })),
          }, null, 2),
        }],
      };
    }),
  );

  mcpServer.tool(
    "sol_token_price",
    "Get price, market cap and liquidity for a token mint. Paid: $0.001 USDC.",
    { mint: z.string().describe("Token mint address (base58)") },
    (await paid("$0.001"))(async (args: { mint: string }) => {
      const meta = await getTokenMeta(args.mint);
      const d = await dexscreener("tokens/" + args.mint);
      const pair = (d?.pairs ?? []).find((p: { chainId: string }) => p.chainId === "solana");
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            mint: shortAddr(args.mint),
            symbol: meta.symbol,
            priceUsd: meta.priceUsd,
            marketCapUsd: pair?.marketCap ?? pair?.fdv ?? null,
            liquidityUsd: pair?.liquidity?.usd ?? null,
            volume24hUsd: pair?.volume?.h24 ?? null,
            priceChange24h: pair?.priceChange?.h24 ?? null,
          }, null, 2),
        }],
      };
    }),
  );

  mcpServer.tool(
    "sol_wallet_analysis",
    "Full portfolio analysis: every holding priced in USD, sorted by value. Paid: $0.005 USDC.",
    { address: z.string().describe("Solana address (base58)") },
    (await paid("$0.005"))(async (args: { address: string }) => {
      const b = await getBalances(args.address);
      const priced: TokenHolding[] = [];
      for (const t of b.tokens.slice(0, 30)) {
        const meta = await getTokenMeta(t.mint);
        priced.push({ ...t, symbol: meta.symbol, priceUsd: meta.priceUsd, valueUsd: meta.priceUsd ? t.amount * meta.priceUsd : undefined });
      }
      priced.sort((a, b2) => (b2.valueUsd ?? 0) - (a.valueUsd ?? 0));
      const tokensValue = priced.reduce((s, t) => s + (t.valueUsd ?? 0), 0);
      const solData = await dexscreener("tokens/So11111111111111111111111111111111111111112");
      const solPrice = solData?.pairs?.find((p: { chainId: string }) => p.chainId === "solana")?.priceUsd;
      const solValue = solPrice ? b.sol * Number(solPrice) : undefined;
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            address: shortAddr(args.address),
            sol: b.sol,
            solValueUsd: solValue,
            tokensValueUsd: tokensValue,
            totalValueUsd: (solValue ?? 0) + tokensValue,
            holdings: priced.slice(0, 15).map((t) => ({
              symbol: t.symbol ?? "?",
              amount: t.amount,
              valueUsd: t.valueUsd != null ? formatUsd(t.valueUsd) : null,
            })),
          }, null, 2),
        }],
      };
    }),
  );

  mcpServer.tool(
    "sol_tx_lookup",
    "Look up a transaction by signature: status, fee, block, accounts. Paid: $0.002 USDC.",
    { signature: z.string().describe("Transaction signature (base58)") },
    (await paid("$0.002"))(async (args: { signature: string }) => {
      const tx = await rpc("getTransaction", [args.signature, { encoding: "json", maxSupportedTransactionVersion: 0 }]);
      if (!tx?.value) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ found: false }) }] };
      }
      const v = tx.value;
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            found: true,
            status: v.meta?.err ? "failed" : "success",
            feeSol: (v.meta?.fee ?? 0) / 1e9,
            slot: v.slot,
            blockTime: v.blockTime ? new Date(v.blockTime * 1000).toISOString() : null,
            accounts: (v.transaction?.message?.accountKeys ?? []).slice(0, 8).map((k: string | { pubkey: string }) => shortAddr(typeof k === "string" ? k : k.pubkey)),
            logCount: (v.meta?.logMessages ?? []).length,
          }, null, 2),
        }],
      };
    }),
  );

  startExpressServer(mcpServer, resourceServer, port);
}

function startExpressServer(mcpServer: McpServer, resourceServer: x402ResourceServer, port: number): void {
  const app = express();
  const transports = new Map<string, SSEServerTransport>();

  app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = crypto.randomUUID();
    transports.set(sessionId, transport);
    res.on("close", () => transports.delete(sessionId));
    await mcpServer.connect(transport);
  });

  app.post("/messages", express.json(), async (req, res) => {
    const transport = Array.from(transports.values())[0];
    if (!transport) {
      res.status(400).json({ error: "No active SSE connection" });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });


  // ---- x402-paid REST endpoints (same tools, HTTP transport) ----
  const paidHttp = (price: string, description: string): express.RequestHandler =>
    async (req, res, next) => {
      try {
        const accepts = await resourceServer.buildPaymentRequirements({
          scheme: "exact",
          network: SOLANA_DEVNET,
          payTo,
          price,
        });
        const resourceInfo = { url: req.originalUrl, description, mimeType: "application/json" };
        const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

        const sig = req.header("PAYMENT-SIGNATURE") ?? req.header("X-PAYMENT");
        if (!sig) {
          const pr = await resourceServer.createPaymentRequiredResponse(accepts, resourceInfo);
          res.status(402).setHeader("PAYMENT-REQUIRED", b64(pr)).json(pr);
          return;
        }

        const paymentPayload = JSON.parse(Buffer.from(sig, "base64").toString("utf8"));
        const pr2 = await resourceServer.createPaymentRequiredResponse(accepts, resourceInfo);
        const matched = resourceServer.findMatchingRequirements(pr2.accepts, paymentPayload);
        if (!matched) {
          res.status(402).setHeader("PAYMENT-REQUIRED", b64(pr2)).json(pr2);
          return;
        }

        const verify = await resourceServer.verifyPayment(paymentPayload, matched);
        if (!verify.isValid) {
          const pr3 = await resourceServer.createPaymentRequiredResponse(accepts, resourceInfo, verify.invalidReason ?? "verification failed");
          res.status(402).setHeader("PAYMENT-REQUIRED", b64(pr3)).json(pr3);
          return;
        }

        const settle = await resourceServer.settlePayment(paymentPayload, matched);
        if (!settle.success) {
          const pr4 = await resourceServer.createPaymentRequiredResponse(accepts, resourceInfo, settle.errorReason ?? "settlement failed");
          res.status(402).setHeader("PAYMENT-REQUIRED", b64(pr4)).json(pr4);
          return;
        }

        res.setHeader("PAYMENT-RESPONSE", b64(settle));
        next();
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "internal server error" });
      }
    };

  app.get("/api/balance", paidHttp("$0.001", "SOL + SPL token balances for an address"), async (req, res) => {
    const address = String(req.query.address ?? "");
    const b = await getBalances(address);
    res.json({ address, sol: b.sol, tokenCount: b.tokens.length, tokens: b.tokens.slice(0, 20) });
  });

  app.get("/api/token", paidHttp("$0.001", "Price / mcap / liquidity for a token mint"), async (req, res) => {
    const mint = String(req.query.mint ?? "");
    const meta = await getTokenMeta(mint);
    const d = await dexscreener("tokens/" + mint);
    const pair = (d?.pairs ?? []).find((p: { chainId: string }) => p.chainId === "solana");
    res.json({ mint, symbol: meta.symbol, priceUsd: meta.priceUsd, marketCapUsd: pair?.marketCap ?? pair?.fdv ?? null, liquidityUsd: pair?.liquidity?.usd ?? null, volume24hUsd: pair?.volume?.h24 ?? null });
  });

  app.get("/api/tx", paidHttp("$0.002", "Transaction details by signature"), async (req, res) => {
    const signature = String(req.query.signature ?? "");
    const tx = await rpc("getTransaction", [signature, { encoding: "json", maxSupportedTransactionVersion: 0 }]);
    if (!tx?.value) { res.json({ found: false }); return; }
    const v = tx.value;
    res.json({ found: true, status: v.meta?.err ? "failed" : "success", feeSol: (v.meta?.fee ?? 0) / 1e9, slot: v.slot, blockTime: v.blockTime ? new Date(v.blockTime * 1000).toISOString() : null });
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      network: SOLANA_DEVNET,
      payment: "x402 exact / USDC devnet",
      tools: { free: ["ping", "list_tools"], paid: ["sol_balance $0.001", "sol_token_price $0.001", "sol_wallet_analysis $0.005", "sol_tx_lookup $0.002"] },
      rest: { free: ["GET /health"], paid: ["GET /api/balance $0.001", "GET /api/token $0.001", "GET /api/tx $0.002"] },
    });
  });

  app.listen(port, () => {
    console.log("SolTools MCP running on http://localhost:" + port);
    console.log("Network: " + SOLANA_DEVNET + " | PayTo: " + payTo);
    console.log("Tools: ping, list_tools (free) | sol_balance, sol_token_price, sol_wallet_analysis, sol_tx_lookup (paid)");
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
