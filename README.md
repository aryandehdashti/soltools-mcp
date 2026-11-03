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
| `sol_token_price` | $0.001 | price / market cap / liquidity for a token mint |
| `sol_wallet_analysis` | $0.005 | full portfolio with USD valuation, sorted by value |
| `sol_tx_lookup` | $0.002 | transaction details by signature |

## Quick start

```bash
npm install
cp .env.example .env   # set SOLANA_PAY_TO_ADDRESS + FACILITATOR_URL
npm run build
npm start
```

Server listens on `http://localhost:4022/sse` (MCP over SSE).

## How payments work (x402 v2)

1. Agent calls a paid tool → server returns `402` with `PAYMENT-REQUIRED` header
2. Agent signs an exact USDC transfer (SPL) via the `@x402/svm` client scheme
3. Agent retries with `PAYMENT-SIGNATURE` header
4. Facilitator verifies + settles on Solana devnet
5. Server returns the data + `PAYMENT-RESPONSE` receipt

Network: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (devnet)
Asset: USDC devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

## Built for the Solana x402 Hackathon

Track: **Best MCP Server** — Model Context Protocol servers connecting AI agents to payments.

## License

Apache-2.0
