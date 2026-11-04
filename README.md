# SolTools MCP

Paid Solana analytics tools for AI agents, monetized with [x402](https://x402.org) micropayments on Solana.

AI agents connect over MCP (Model Context Protocol) and pay per tool call with USDC on Solana devnet — no accounts, no API keys, no sessions. The server returns `402 Payment Required`, the agent signs a payment, retries, and gets the data.

## Why

AI agents doing Solana research (trading bots, portfolio agents, security analysts) need reliable on-chain data. SolTools MCP packages that data as paid MCP tools priced in fractions of a cent, settled instantly onchain via x402.

## Tools

| Tool | Price | What it does |
|------|-------|--------------|
| `ping` | free | health check |
| `list_tools` | free | list tools + prices |
| `sol_balance` | $0.001 | SOL + SPL token balances for any address |
| `sol_token_price` | $0.001 | price / market cap / liquidity for a token mint (DexScreener) |
| `sol_wallet_analysis` | $0.005 | full portfolio with USD valuation, sorted by value |
| `sol_tx_lookup` | $0.002 | transaction details by signature |

## Quick start

```bash
npm install
cp .env.example .env   # set SOLANA_PAY_TO_ADDRESS + FACILITATOR_URL
npm run build
npm start
```

Server listens on `http://localhost:4022` — MCP over SSE at `/sse`, JSON-RPC POSTs at `/messages`, `/health` for status.

## Live deployment

Public endpoint (via SSH tunnel): **https://b4b921a970357d.lhr.life**

- `GET /health` — status + tool catalog
- `GET /sse` — MCP SSE transport
- `POST /messages` — MCP JSON-RPC

Any MCP client can connect remotely; payments settle as USDC SPL transfers on Solana devnet via the x402 facilitator.

### Paid REST API (x402 HTTP)

The same tools are also exposed as x402-gated HTTP endpoints — returns `402` + `PAYMENT-REQUIRED` header, retry with `PAYMENT-SIGNATURE`:

| Endpoint | Price |
|----------|-------|
| `GET /api/balance?address=...` | $0.001 |
| `GET /api/token?mint=...` | $0.001 |
| `GET /api/tx?signature=...` | $0.002 |

```bash
curl -i "https://b4b921a970357d.lhr.life/api/balance?address=<solana-addr>"
# HTTP/1.1 402 Payment Required
# PAYMENT-REQUIRED: <base64 payment requirements>
```

## Demo

`demo.mp4` shows the complete flow: an agent connects, hits a `402` on a paid tool, signs an exact-scheme USDC payment payload locally, and retries with the payment attached.

```bash
npm start                          # terminal 1
node scripts/demo-client.mjs       # terminal 2 — full protocol walkthrough
node scripts/video-demo.mjs        # narrated version used for the video
```

For the paid retry to settle onchain, the payer needs devnet USDC (mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, claimable at https://faucet.circle.com — select Solana Devnet) and the pay-to address needs a USDC ATA. Without funds the demo still shows the full protocol path: `402` → requirements → locally-signed transaction → facilitator verification reaching onchain state checks.

## How payments work (x402 v2)

1. Agent calls a paid tool → server returns `402` with payment requirements in `structuredContent`
2. Agent signs an exact-scheme SPL USDC transfer via `@x402/svm`'s `ExactSvmScheme` (fee payer = facilitator, so the payer needs no SOL for gas)
3. Agent retries with the payload in `_meta["x402/payment"]`
4. `x402ResourceServer` verifies via the facilitator and settles on Solana devnet
5. Server returns the data + a payment receipt in `_meta["x402/payment-response"]`

- Network: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (devnet)
- Asset: USDC devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- Facilitator: `https://x402.org/facilitator` (configurable via `FACILITATOR_URL`)

## Architecture

```
agent ──MCP/SSE──> SolTools server ──402──> agent signs payment
                      │                        │
                      └── verify+settle ───────┘
                           │ x402 facilitator
                           ▼
                     Solana devnet (USDC SPL transfer)
```

- `src/index.ts` — Express + McpServer + `createPaymentWrapper` around each paid tool handler
- `src/solana.ts` — data providers: RPC balances, DexScreener prices, tx lookup
- `scripts/demo-client.mjs` — end-to-end client: connect → 402 → sign → paid retry

## Built for the Solana x402 Hackathon

Track: **Best MCP Server** — MCP servers connecting AI agents to payments.

## License

Apache-2.0
