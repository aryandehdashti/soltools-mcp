# SolTools MCP

Paid verification + analytics tools for AI agents, monetized with [x402](https://x402.org) micropayments — **mainnet USDC on Base (`eip155:8453`) and Solana**.

Agents connect over MCP (Model Context Protocol) or plain HTTP and pay per call — no accounts, no API keys, no sessions. The server returns `402 Payment Required`, the client signs a payment, retries, and gets the answer.

## Live service

**`https://soltools.arideh.info`** — Cloudflare → nginx :443 → node.

- `GET /health` — status + route catalog
- `GET /.well-known/x402` — machine-readable discovery doc (routes, prices, networks)
- `GET /sse`, `POST /messages` — MCP transports (SSE + streamable HTTP)

## REST API (x402-gated, $0.25 USDC/call)

Every paid route issues a proper 402 challenge (requirements in the `PAYMENT-REQUIRED` header, v2 format), settles through the facilitator, and only then runs the handler. Base and Solana are both advertised — Base first, since most auto-buyers settle there.

| Route | What it does |
|---|---|
| `GET /api/balance?address=` | SOL + SPL token balances |
| `GET /api/token?mint=` | Price / mcap / liquidity for a Solana mint (DexScreener) |
| `GET /api/tx?signature=` | Transaction details by signature |
| `GET /api/verify?url=` | Cold-probe an x402 endpoint — payable/free/broken + defect list |
| `GET /api/venues` | Verified agent-economy venue index (who pays, how much, what proof) |
| `GET /api/attest?chain&tx` | On-chain payout attestation — did a claimed transfer really settle |
| `GET /api/safetoken?mint=` | Token safety scan — mint/freeze authorities, top-holder concentration, liquidity, sell pressure |
| `GET /api/trust?handle=\|address` | Agent reputation score — moltbook + on-chain signals, auditable breakdown |
| `GET /api/bulkverify?urls=` | Batch cold-probe up to 10 endpoints |
| `GET /api/contract?chain&address` | EVM contract quick-check — bytecode, ERC-20 surface, proxy, owner |

**Free routes** (no payment): `/api/stats` (live probe/settle counters), `/api/refstats`, `/api/reflog` (public sales ledger), `/api/promokit?handle=` (referral onboarding), `/api/chain` (chaincheck-link-v1 — hash-chained acceptance-test transcripts, GET + POST).

**Referrals:** append `&ref=<handle>` to any paid route — settled sales attribute 20% to that handle, paid weekly, publicly logged.

## MCP tools

- Free: `ping`, `list_tools`, `sol_token_info`
- Paid: `sol_balance`, `sol_token_price`, `sol_wallet_analysis`, `sol_tx_lookup` — prices listed by `list_tools`

## Local run

```bash
npm install
cp .env.example .env   # SOLANA_PAY_TO_ADDRESS, EVM_PAY_TO_ADDRESS, FACILITATOR_URL, SOLANA_RPC_URL(S)
npm run build          # strict tsc, noEmitOnError
npm start              # listens on PORT (default 4022)
```

## Payments architecture (x402 v2)

1. Client calls a paid route/tool → `402` + requirements (header + body)
2. Client signs an exact-scheme payment (SPL USDC on Solana or ERC-3009 USDC on Base — fee payer = facilitator)
3. Client retries with `PAYMENT-SIGNATURE` (HTTP) or `_meta["x402/payment"]` (MCP)
4. `x402ResourceServer` verifies **and settles** via the facilitator — paid handlers run only after settlement succeeds; failures return a fresh 402
5. Response carries `PAYMENT-RESPONSE` receipt

- Networks: `eip155:8453` (Base), `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (Solana mainnet)
- Asset: USDC — Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, Solana `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Facilitator: `https://facilitator.payai.network` (configurable)

## Source layout

- `src/index.ts` — Express + McpServer, x402 middleware, all routes
- `src/solana.ts` — RPC + DexScreener providers (fallback RPC chain with backoff)
- `src/verify.ts` — x402 cold-probe (manual redirect following, SSRF-guarded)
- `src/attest.ts` — on-chain transfer verification (Solana + Base)
- `src/safetoken.ts` / `trust.ts` / `contract.ts` / `venues.ts` — route logic
- `src/ref.ts` — referral attribution + public ledger (file-persistent)
- `src/stats.ts` — probe vs settled counters
- `src/chain.ts` — chaincheck-link-v1 transcript hashing

## License

Apache-2.0
