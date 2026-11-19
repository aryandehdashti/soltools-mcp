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
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createPaymentWrapper, x402ResourceServer } from "@x402/mcp";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { HTTPFacilitatorClient } from "@x402/core/server";
import express from "express";
import { z } from "zod";
import { SOLANA_MAINNET, rpc, dexscreener, formatUsd, shortAddr } from "./solana.js";
import { verifyEndpoint } from "./verify.js";
import { venueIndex } from "./venues.js";
import { attestTx } from "./attest.js";
import { scanToken } from "./safetoken.js";
import { trustScore } from "./trust.js";
import { inspectContract } from "./contract.js";
import { validRef, recordRefSale, refStats, publicLog, REF_PAYOUT_PCT } from "./ref.js";
import { markChallenge, markSettled, statsSnapshot } from "./stats.js";
import { buildChain, CHAIN_USAGE } from "./chain.js";

config();

const payToEnv = process.env.SOLANA_PAY_TO_ADDRESS;
if (!payToEnv) {
  console.error("SOLANA_PAY_TO_ADDRESS env var is required (Solana address receiving payments)");
  process.exit(1);
}
const payTo: string = payToEnv;

const BASE_MAINNET = "eip155:8453";
const evmPayTo = process.env.EVM_PAY_TO_ADDRESS;

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

async function buildAccepts(resourceServer: x402ResourceServer, price: string) {
  const solAccepts = await resourceServer.buildPaymentRequirements({
    scheme: "exact",
    network: SOLANA_MAINNET,
    payTo,
    price,
  });
  if (!evmPayTo) return solAccepts;
  const baseAccepts = await resourceServer.buildPaymentRequirements({
    scheme: "exact",
    network: BASE_MAINNET,
    payTo: evmPayTo,
    price,
  });
  return [...baseAccepts, ...solAccepts];
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

async function buildMcpServer(resourceServer: x402ResourceServer): Promise<McpServer> {
  const mcpServer = new McpServer({ name: "soltools-mcp", version: "1.0.0" });

  const paid = async (price: string, toolName: string, description: string, inputSchema: Record<string, unknown>) => {
    const accepts = await buildAccepts(resourceServer, price);
    // Blockhash hints baked at startup expire within ~90s; drop them so the
    // client resolves a fresh blockhash per payment (resolveBlockhash fallback).
    for (const req of accepts) {
      if (req.extra) {
        delete req.extra.recentBlockhash;
        delete req.extra.lastValidBlockHeight;
      }
    }
    return createPaymentWrapper(resourceServer, {
      accepts,
      extensions: declareDiscoveryExtension({ toolName, description, inputSchema }),
    });
  };

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
          free: ["ping", "list_tools", "sol_token_info"],
          paid: {
            sol_balance: "$0.01 - SOL + SPL token balances for any address",
            sol_token_price: "$0.01 - price/mcap/liquidity for a token mint",
            sol_wallet_analysis: "$0.02 - full portfolio with USD valuation",
            sol_tx_lookup: "$0.01 - transaction details by signature",
          },
          network: SOLANA_MAINNET,
          asset: "USDC",
        }, null, 2),
      }],
    }),
  );

  mcpServer.tool(
    "sol_token_info",
    "Free: token mint metadata — name, symbol, supply, decimals, mint/freeze authority flags.",
    { mint: z.string().describe("Token mint address (base58)") },
    async (args: { mint: string }) => {
      const supply = await rpc("getTokenSupply", [args.mint]);
      const acc = await rpc("getAccountInfo", [args.mint, { encoding: "jsonParsed" }]);
      const info = acc?.value?.data?.parsed?.info ?? {};
      const meta = await getTokenMeta(args.mint);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            mint: args.mint,
            symbol: meta.symbol ?? null,
            decimals: supply?.value?.decimals ?? null,
            supply: supply?.value?.uiAmount ?? null,
            mintAuthority: info.mintAuthority ?? null,
            freezeAuthority: info.freezeAuthority ?? null,
            authoritiesRevoked: !info.mintAuthority && !info.freezeAuthority,
          }, null, 2),
        }],
      };
    },
  );

  // ---- Paid tools ----
  mcpServer.tool(
    "sol_balance",
    "Get SOL and SPL token balances for any address. Paid: $0.01 USDC.",
    { address: z.string().describe("Solana address (base58)") },
    (await paid("$0.01", "sol_balance", "Get SOL and SPL token balances for any address", { properties: { address: { type: "string" } }, required: ["address"] }))(async (args: { address: string }) => {
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
    "Get price, market cap and liquidity for a token mint. Paid: $0.01 USDC.",
    { mint: z.string().describe("Token mint address (base58)") },
    (await paid("$0.01", "sol_token_price", "Get price, market cap and liquidity for a token mint", { properties: { mint: { type: "string" } }, required: ["mint"] }))(async (args: { mint: string }) => {
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
    "Full portfolio analysis: every holding priced in USD, sorted by value. Paid: $0.02 USDC.",
    { address: z.string().describe("Solana address (base58)") },
    (await paid("$0.02", "sol_wallet_analysis", "Full portfolio with USD valuation, sorted by value", { properties: { address: { type: "string" } }, required: ["address"] }))(async (args: { address: string }) => {
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
    "Look up a transaction by signature: status, fee, block, accounts. Paid: $0.01 USDC.",
    { signature: z.string().describe("Transaction signature (base58)") },
    (await paid("$0.01", "sol_tx_lookup", "Transaction details by signature", { properties: { signature: { type: "string" } }, required: ["signature"] }))(async (args: { signature: string }) => {
      const tx = await rpc("getTransaction", [args.signature, { encoding: "json", maxSupportedTransactionVersion: 127 }]);
      if (!tx) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ found: false }) }] };
      }
      const v = tx;
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

  return mcpServer;
}

export async function main(): Promise<void> {
  const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitatorClient);
  resourceServer.register(SOLANA_MAINNET, new ExactSvmScheme({ rpcUrl: process.env.SOLANA_RPC_URL }));
  if (evmPayTo) {
    resourceServer.register(BASE_MAINNET, new ExactEvmScheme());
  }
  await resourceServer.initialize();
  startExpressServer(() => buildMcpServer(resourceServer), resourceServer, port);
}

function startExpressServer(buildMcpServer: () => Promise<McpServer>, resourceServer: x402ResourceServer, port: number): void {
  const app = express();
  const transports = new Map<string, SSEServerTransport>();
  const httpSessions = new Map<string, StreamableHTTPServerTransport>();

  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.on("finish", () => { if (res.statusCode === 402) markChallenge(req.path); });
    next();
  });

  app.all("/mcp", express.json(), async (req: express.Request, res: express.Response) => {
    const sid = req.headers["mcp-session-id"] as string | undefined;
    let transport = sid ? httpSessions.get(sid) : undefined;
    if (!transport) {
      const msgs = Array.isArray(req.body) ? req.body : [req.body];
      const isInit = !sid && msgs.some((m: { method?: string }) => m?.method === "initialize");
      if (!isInit) {
        res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: no valid session" }, id: null });
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id: string) => { httpSessions.set(id, transport as StreamableHTTPServerTransport); },
      });
      transport.onclose = () => { const id = (transport as StreamableHTTPServerTransport).sessionId; if (id) httpSessions.delete(id); };
      const server = await buildMcpServer();
      await server.connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/sse", async (_req: express.Request, res: express.Response) => {
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = crypto.randomUUID();
    transports.set(sessionId, transport);
    res.on("close", () => transports.delete(sessionId));
    const server = await buildMcpServer();
    await server.connect(transport);
  });

  app.post("/messages", express.json(), async (req: express.Request, res: express.Response) => {
    const transport = Array.from(transports.values())[0];
    if (!transport) {
      res.status(400).json({ error: "No active SSE connection" });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });


  // ---- x402-paid REST endpoints (same tools, HTTP transport) ----
  const paidHttp = (price: string, description: string, discovery?: Record<string, unknown>): express.RequestHandler =>
    async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try {
        const accepts = await buildAccepts(resourceServer, price);
        const resourceInfo = { url: req.originalUrl, description, mimeType: "application/json" };
        const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
        const prFor = (err?: string) =>
          resourceServer.createPaymentRequiredResponse(accepts, resourceInfo, err, discovery);

        const sig = req.header("PAYMENT-SIGNATURE") ?? req.header("X-PAYMENT");
        if (!sig) {
          const pr = await prFor();
          res.status(402).setHeader("PAYMENT-REQUIRED", b64(pr)).json(pr);
          return;
        }

        const paymentPayload = JSON.parse(Buffer.from(sig, "base64").toString("utf8"));
        const pr2 = await prFor();
        const matched = resourceServer.findMatchingRequirements(pr2.accepts, paymentPayload);
        if (!matched) {
          res.status(402).setHeader("PAYMENT-REQUIRED", b64(pr2)).json(pr2);
          return;
        }

        const verify = await resourceServer.verifyPayment(paymentPayload, matched);
        if (!verify.isValid) {
          const pr3 = await prFor(verify.invalidReason ?? "verification failed");
          res.status(402).setHeader("PAYMENT-REQUIRED", b64(pr3)).json(pr3);
          return;
        }

        const settle = await resourceServer.settlePayment(paymentPayload, matched);
        if (!settle.success) {
          const pr4 = await prFor(settle.errorReason ?? "settlement failed");
          res.status(402).setHeader("PAYMENT-REQUIRED", b64(pr4)).json(pr4);
          return;
        }

        res.setHeader("PAYMENT-RESPONSE", b64(settle));
        const ref = validRef(req.query.ref);
        if (ref) {
          const usd = parseFloat(price.replace(/[^0-9.]/g, "")) || 0;
          recordRefSale(ref, req.path, (matched as { network?: string }).network ?? "unknown", usd);
        }
        markSettled(req.path, ref);
        next();
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "internal server error" });
      }
    };

  // A paid call must never answer an HTML 500 — buyer already settled.
  const safe = (h: express.RequestHandler): express.RequestHandler =>
    async (req: express.Request, res: express.Response) => {
      try {
        await h(req, res, () => {});
      } catch (e) {
        console.error(e);
        if (!res.headersSent) res.status(502).json({ error: "upstream data source failed" });
      }
    };

  app.get("/api/balance", paidHttp("$0.25", "SOL + SPL token balances for an address", declareDiscoveryExtension({
    input: { address: "DZdTYcN6qKDi9exBmF8XaBjKapR1pBUsakxzXEnWmihX" },
    inputSchema: { properties: { address: { type: "string", description: "Solana address (base58)" } }, required: ["address"] },
    output: { example: { address: "DZdT…mihX", sol: 1.5, tokenCount: 3, tokens: [] } },
  }) as Record<string, unknown>), safe(async (req: express.Request, res: express.Response) => {
    const address = String(req.query.address ?? "");
    const b = await getBalances(address);
    res.json({ address, sol: b.sol, tokenCount: b.tokens.length, tokens: b.tokens.slice(0, 20) });
  }));

  app.get("/api/token", paidHttp("$0.25", "Price / mcap / liquidity for a token mint", declareDiscoveryExtension({
    input: { mint: "So11111111111111111111111111111111111111112" },
    inputSchema: { properties: { mint: { type: "string", description: "Token mint address (base58)" } }, required: ["mint"] },
    output: { example: { mint: "So11…1112", symbol: "SOL", priceUsd: 150.2, marketCapUsd: 70000000000, liquidityUsd: 5000000, volume24hUsd: 3000000000 } },
  }) as Record<string, unknown>), safe(async (req: express.Request, res: express.Response) => {
    const mint = String(req.query.mint ?? "");
    const meta = await getTokenMeta(mint);
    const d = await dexscreener("tokens/" + mint);
    const pair = (d?.pairs ?? []).find((p: { chainId: string }) => p.chainId === "solana");
    res.json({ mint, symbol: meta.symbol, priceUsd: meta.priceUsd, marketCapUsd: pair?.marketCap ?? pair?.fdv ?? null, liquidityUsd: pair?.liquidity?.usd ?? null, volume24hUsd: pair?.volume?.h24 ?? null });
  }));

  app.get("/api/tx", paidHttp("$0.25", "Transaction details by signature", declareDiscoveryExtension({
    input: { signature: "5VERv8NM…" },
    inputSchema: { properties: { signature: { type: "string", description: "Transaction signature (base58)" } }, required: ["signature"] },
    output: { example: { found: true, status: "success", feeSol: 0.000005, slot: 250000000, blockTime: "2026-01-01T00:00:00.000Z" } },
  }) as Record<string, unknown>), safe(async (req: express.Request, res: express.Response) => {
    const signature = String(req.query.signature ?? "");
    const tx = await rpc("getTransaction", [signature, { encoding: "json", maxSupportedTransactionVersion: 127 }]);
    if (!tx) { res.json({ found: false }); return; }
    const v = tx;
    res.json({ found: true, status: v.meta?.err ? "failed" : "success", feeSol: (v.meta?.fee ?? 0) / 1e9, slot: v.slot, blockTime: v.blockTime ? new Date(v.blockTime * 1000).toISOString() : null });
  }));

  app.get("/api/verify", paidHttp("$0.25", "Cold-probe an x402 endpoint: 402 parse, requirements validity, defect list", declareDiscoveryExtension({
    input: { url: "https://example.com/api/paid" },
    inputSchema: { properties: { url: { type: "string", description: "Endpoint URL to cold-probe (public http/https only)" } }, required: ["url"] },
    output: { example: { url: "https://example.com/api/paid", payability: "payable", defects: [], probes: [{ method: "GET", status: 402, latency_ms: 210 }] } },
  }) as Record<string, unknown>), safe(async (req: express.Request, res: express.Response) => {
    const url = String(req.query.url ?? "");
    if (!url) { res.json({ error: "url query param required" }); return; }
    const result = await verifyEndpoint(url);
    res.json(result);
  }));

  app.get("/api/venues", paidHttp("$0.25", "Verified agent-economy venue index: who pays, how much, what proof", declareDiscoveryExtension({
    output: { example: { version: 1, count: 12, venues: [{ id: "aibtc", payerType: "treasury", proofClass: "platform_receipt", status: "alive" }] } },
  }) as Record<string, unknown>), (_req: express.Request, res: express.Response) => {
    res.json(venueIndex());
  });

  app.get("/api/attest", paidHttp("$0.25", "On-chain payout attestation: verify a claimed USDC transfer on Solana or Base", declareDiscoveryExtension({
    input: { chain: "base", tx: "0x…" },
    inputSchema: {
      properties: {
        chain: { type: "string", description: "solana | base" },
        tx: { type: "string", description: "Transaction hash/signature" },
      },
      required: ["chain", "tx"],
    },
    output: { example: { verdict: "settled", confirmed: true, chain: "base", transfers: [{ asset: "0x833589…913", amountUsd: 0.25, to: "0xa659…3E96" }] } },
  }) as Record<string, unknown>), safe(async (req: express.Request, res: express.Response) => {
    const chain = String(req.query.chain ?? "");
    const tx = String(req.query.tx ?? "");
    if (!chain || !tx) { res.json({ error: "chain and tx query params required" }); return; }
    const result = await attestTx(chain, tx);
    res.json(result);
  }));

  app.get("/api/safetoken", paidHttp("$0.25", "Token safety scan: mint/freeze authorities, holder concentration, liquidity, sell pressure", declareDiscoveryExtension({
    input: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    inputSchema: { properties: { mint: { type: "string", description: "Solana token mint address (base58)" } }, required: ["mint"] },
    output: { example: { found: true, verdict: "caution", flags: [{ code: "concentrated_supply", severity: "medium" }] } },
  }) as Record<string, unknown>), safe(async (req: express.Request, res: express.Response) => {
    const mint = String(req.query.mint ?? "");
    if (!mint) { res.json({ error: "mint query param required" }); return; }
    res.json(await scanToken(mint));
  }));

  app.get("/api/trust", paidHttp("$0.25", "Agent reputation score: moltbook presence + on-chain activity, with verifiable breakdown", declareDiscoveryExtension({
    input: { handle: "devin-forge", address: "DZdTYcN6qKDi9exBmF8XaBjKapR1pBUsakxzXEnWmihX" },
    inputSchema: {
      properties: {
        handle: { type: "string", description: "Agent handle (moltbook name)" },
        address: { type: "string", description: "Solana address (base58)" },
      },
    },
    output: { example: { score: 42, verdict: "some_history", breakdown: [{ signal: "moltbook_karma", points: 8 }] } },
  }) as Record<string, unknown>), safe(async (req: express.Request, res: express.Response) => {
    const handle = req.query.handle ? String(req.query.handle) : null;
    const address = req.query.address ? String(req.query.address) : null;
    if (!handle && !address) { res.json({ error: "handle and/or address query param required" }); return; }
    res.json(await trustScore(handle, address));
  }));

  app.get("/api/bulkverify", paidHttp("$0.25", "Batch cold-probe up to 10 x402 endpoints — defect list per URL", declareDiscoveryExtension({
    input: { urls: "https://a.com/x,https://b.com/y" },
    inputSchema: { properties: { urls: { type: "string", description: "Comma-separated URLs, max 10" } }, required: ["urls"] },
    output: { example: { count: 2, results: [{ url: "https://a.com/x", payability: "payable", defects: [] }] } },
  }) as Record<string, unknown>), safe(async (req: express.Request, res: express.Response) => {
    const urls = String(req.query.urls ?? "").split(",").map((u) => u.trim()).filter(Boolean).slice(0, 10);
    if (!urls.length) { res.json({ error: "urls query param required (comma-separated, max 10)" }); return; }
    const results = await Promise.all(urls.map((u) => verifyEndpoint(u)));
    res.json({ count: results.length, results });
  }));

  app.get("/api/contract", paidHttp("$0.25", "EVM contract quick-check: bytecode, ERC-20 surface, proxy, owner", declareDiscoveryExtension({
    input: { chain: "base", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    inputSchema: {
      properties: {
        chain: { type: "string", description: "base | ethereum | arbitrum" },
        address: { type: "string", description: "Contract address (0x…)" },
      },
      required: ["chain", "address"],
    },
    output: { example: { isContract: true, erc20: { symbol: "USDC", decimals: 6 }, proxy: null, flags: [] } },
  }) as Record<string, unknown>), safe(async (req: express.Request, res: express.Response) => {
    const chain = String(req.query.chain ?? "");
    const address = String(req.query.address ?? "");
    if (!chain || !address) { res.json({ error: "chain and address query params required" }); return; }
    res.json(await inspectContract(chain, address));
  }));

  // x402 discovery doc — crawlers and directories index from this.
  app.get("/.well-known/x402", (_req: express.Request, res: express.Response) => {
    const b = "https://soltools.arideh.info";
    const routes = [
      ["/api/safetoken?mint=<solana-mint>", "Token rug-check: mint/freeze authorities, top-10 concentration, liquidity, sell pressure"],
      ["/api/trust?handle=<agent>", "Agent trust score: moltbook presence + on-chain activity, verifiable breakdown"],
      ["/api/verify?url=<endpoint>", "Cold-probe an x402 endpoint: 402 parse, requirements validation, numbered defect list"],
      ["/api/attest?chain=solana|base&tx=<sig>", "On-chain payout attestation: verify a claimed USDC transfer"],
      ["/api/contract?chain=base&address=<addr>", "EVM contract quick-check: bytecode, ERC-20 surface, proxy, owner"],
      ["/api/bulkverify?urls=<csv>", "Batch cold-probe up to 10 x402 endpoints"],
      ["/api/venues", "Verified agent-economy venue index: who pays, how much, what proof"],
      ["/api/balance?address=<sol>", "SOL + SPL token balances"],
      ["/api/token?mint=<solana-mint>", "Token price/mcap/liquidity"],
      ["/api/tx?sig=<solana-sig>", "Transaction details"],
    ] as const;
    res.json({
      x402Version: 2,
      name: "SolTools — agent verification APIs",
      operator: "devin-forge (moltbook)",
      networks: evmPayTo ? [SOLANA_MAINNET, BASE_MAINNET] : [SOLANA_MAINNET],
      resources: routes.map(([url, description]) => ({
        url: b + url, method: "GET", priceUsd: 0.25, asset: "USDC", description,
      })),
      free: { stats: b + "/api/stats", reflog: b + "/api/reflog", promokit: b + "/api/promokit?handle=<your-handle>" },
      referrals: "append &ref=<handle> to any resource URL — 20% attributed sales weekly, public ledger",
    });
  });

  // Free referral endpoints — transparency is the product.
  app.get("/api/stats", (_req: express.Request, res: express.Response) => {
    res.json(statsSnapshot());
  });

  app.get("/api/refstats", (req: express.Request, res: express.Response) => {
    const code = validRef(req.query.code);
    if (!code) { res.json({ error: "code query param required ([a-z0-9_-])" }); return; }
    res.json(refStats(code));
  });

  app.get("/api/reflog", (_req: express.Request, res: express.Response) => {
    res.json(publicLog());
  });

  // Free: everything an agent needs to start promoting — links + copy.
  app.get("/api/promokit", (req: express.Request, res: express.Response) => {
    const code = validRef(req.query.handle);
    if (!code) { res.json({ error: "handle query param required ([a-z0-9_-]) — your public handle becomes your ref code" }); return; }
    const b = "https://soltools.arideh.info";
    const r = `?ref=${code}`;
    res.json({
      yourCode: code,
      payout: `${REF_PAYOUT_PCT}% of attributed sales, weekly via Lightning/USDC — public ledger: ${b}/api/reflog`,
      yourStats: `${b}/api/refstats?code=${code}`,
      links: {
        safetoken: `${b}/api/safetoken?mint=<solana-mint>&ref=${code}`,
        trust: `${b}/api/trust?handle=<agent>&ref=${code}`,
        verify: `${b}/api/verify?url=<x402-endpoint>&ref=${code}`,
        attest: `${b}/api/attest?chain=solana|base&tx=<sig>&ref=${code}`,
        contract: `${b}/api/contract?chain=base&address=<addr>&ref=${code}`,
        bulkverify: `${b}/api/bulkverify?urls=<u1,u2,...>&ref=${code}`,
        venues: `${b}/api/venues${r}`,
        balance: `${b}/api/balance?address=<sol>&ref=${code}`,
      },
      copy: {
        x_post: `Agent tooling that pays for itself: soltools.arideh.info — token rug-checks, x402 endpoint audits, agent trust scores, on-chain payout proofs. 0.25 USDC/call, Base or Solana. Built by @devinforge — my ref code: ${code}`,
        moltbook: `Useful paid API set for agents — soltools.arideh.info: /api/safetoken (rug-check), /api/verify (x402 probe), /api/trust (agent reputation), /api/attest (payout proof). 0.25 USDC, Base+Solana. ref=${code}`,
        colony: `soltools.arideh.info — 9 paid routes for agent verification work (token safety, endpoint audits, trust scores, payout attestations). 0.25 USDC/call, USDC on Base or Solana. ref=${code}`,
      },
      howItWorks: "Share any link with ?ref=<your-handle>. When a buyer settles through it, the sale is attributed to your code — visible in /api/refstats and /api/reflog. Payouts weekly to your Lightning address or wallet; tell us where by posting in m/verifiedearn or replying to any soltools post.",
      note: "No signup needed — the code IS your handle. Every sale is publicly logged.",
    });
  });

  // Free: hash-chained acceptance-test transcripts (chaincheck-link-v1).
  // Pure compute, no chain I/O — kept free so any two parties can produce the
  // same root; anchoring that root on-chain is what /api/attest is for.
  const chainHandler = (raw: unknown, res: express.Response) => {
    const r = buildChain(raw);
    if (!r.ok) { res.status(400).json({ error: r.error, usage: CHAIN_USAGE }); return; }
    res.json({ ...r, anchor: "commit this root on-chain, then prove it via /api/attest?chain&tx" });
  };
  app.get("/api/chain", (req: express.Request, res: express.Response) => {
    const b64 = req.query.steps;
    if (typeof b64 !== "string" || !b64) { res.json(CHAIN_USAGE); return; }
    try {
      const raw = JSON.parse(Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
      chainHandler(raw, res);
    } catch { res.status(400).json({ error: "steps must be base64url-encoded JSON array", usage: CHAIN_USAGE }); }
  });
  app.post("/api/chain", express.json({ limit: "300kb" }) as express.RequestHandler, (req: express.Request, res: express.Response) => chainHandler(req.body, res));

  app.get("/health", (_req: express.Request, res: express.Response) => {
    res.json({
      status: "ok",
      networks: evmPayTo ? [SOLANA_MAINNET, BASE_MAINNET] : [SOLANA_MAINNET],
      payment: "x402 exact / USDC",
      tools: { free: ["ping", "list_tools"], paid: ["sol_balance $0.01", "sol_token_price $0.01", "sol_wallet_analysis $0.02", "sol_tx_lookup $0.01"] },
      rest: { free: ["GET /health", "GET /api/refstats", "GET /api/reflog"], paid: ["GET /api/balance $0.25", "GET /api/token $0.25", "GET /api/tx $0.25", "GET /api/verify?url=… $0.25", "GET /api/venues $0.25", "GET /api/attest?chain&tx $0.25", "GET /api/safetoken?mint=… $0.25", "GET /api/trust?handle|address $0.25", "GET /api/bulkverify?urls=… $0.25", "GET /api/contract?chain&address $0.25"] },
      referrals: "?ref=<handle> on any paid route — " + REF_PAYOUT_PCT + "% of attributed sales paid weekly (see /api/reflog)",
    });
  });

  app.listen(port, () => {
    console.log("SolTools MCP running on http://localhost:" + port);
    console.log("Network: " + SOLANA_MAINNET + " | PayTo: " + payTo);
    console.log("Tools: ping, list_tools (free) | sol_balance, sol_token_price, sol_wallet_analysis, sol_tx_lookup (paid)");
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
