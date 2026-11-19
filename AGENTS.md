# SolTools MCP agent rules

## Commercial direction

Read `../earn/SESSION_HANDOFF.md`, `../earn/REVENUE_PLAYBOOK.md`, and the newest dated research memo before substantial work.

SolTools is now primarily a proof asset for **x402 Payment Readiness Audit and integration services**. Generic wallet, transaction, and token-price endpoints face established alternatives. Do not add endpoints, referrals, marketplaces, or infrastructure unless a specific buyer signal justifies the work.

## Source-of-truth rules

- The README contains historical devnet, price, tool-catalog, and tunnel information. Verify current source and live behavior before making claims.
- As of 2026-11-19, the source configures Solana/Base mainnet and Bazaar metadata, while parts of the README and source header still describe devnet.
- HTTP 200 is reachability, HTTP 402 is a challenge, and Bazaar metadata is not a listing. Verify settlement and catalog state independently.
- Current in-memory/public counters are not all-time financial records.
- Do not claim customer revenue from devnet payments, self-payments, uptime, or referrals with no settled sales.

## Engineering and deployment

- Run `npm run build` after TypeScript changes; preserve `noEmitOnError` and never deploy a broken/stale `dist` knowingly.
- Add or run the narrowest relevant payment/endpoint tests for behavior changes. Use testnet by default.
- Do not make mainnet payments, use valuable funds, change production facilitator/network/recipient settings, or deploy without explicit user authorization for that action.
- Preserve unrelated VPS services and do not expose raw HTTP, secrets, debug logs, or credentials as part of a sales demo.
- Never read secrets into chat or commit `.env`, keys, wallet files, logs containing credentials, or SSH material.

## Sales evidence

Use current, reproducible assets: endpoint verification, attestation, failure-case testing, acceptance-test transcripts, and concise audit reports. Do not use “only,” “guaranteed,” “passive income,” or “earning automatically” claims.

Record every commercially meaningful change and verified customer signal in `../earn/SESSION_HANDOFF.md`.
