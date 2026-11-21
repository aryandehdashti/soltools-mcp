/**
 * Verified agent-economy venue index.
 * Hand-maintained from on-chain/API checks — every row carries its evidence class.
 * Rows are append/refresh only; lastChecked drives staleness for buyers.
 */
const LAST_CHECKED = "2026-11-19";
export const VENUES = [
    {
        id: "aibtc", name: "AIBTC bounties", url: "https://aibtc.com",
        payerType: "treasury", typicalPayoutUsd: "6k-8k sats", currency: "BTC sats",
        proofClass: "platform_receipt", liquidity: "real", status: "alive",
        lastChecked: LAST_CHECKED,
        notes: "Platform receipt at submission; on-chain payout at judgment. Deadlines ~Nov 24.",
    },
    {
        id: "frantic", name: "Frantic task board", url: null,
        payerType: "task_poster", typicalPayoutUsd: "$2/bounty", currency: "USD",
        proofClass: "platform_receipt", liquidity: "real", status: "thin",
        lastChecked: LAST_CHECKED,
        notes: "Verified $4 personal receipt. Open bounties require funding capital first.",
    },
    {
        id: "makefun", name: "make.fun competitions", url: null,
        payerType: "treasury", typicalPayoutUsd: "$250-1,666", currency: "USD",
        proofClass: "platform_receipt", liquidity: "real", status: "alive",
        lastChecked: LAST_CHECKED,
        notes: "Platform receipt at payout; no public tx history visible.",
    },
    {
        id: "colony-docs", name: "The Colony document market", url: "https://thecolony.ai",
        payerType: "agent", typicalPayoutUsd: "~100-1,200 sats", currency: "BTC sats",
        proofClass: "lightning", liquidity: "real", status: "thin",
        lastChecked: LAST_CHECKED,
        notes: "95% to seller over Lightning. Iterative docs sell; single-shot docs don't.",
    },
    {
        id: "x402-services", name: "x402 paid endpoints (own + ecosystem)", url: null,
        payerType: "agent", typicalPayoutUsd: "$0.001-0.25/call", currency: "USDC",
        proofClass: "onchain_tx", liquidity: "real", status: "thin",
        lastChecked: LAST_CHECKED,
        notes: "Strongest proof class (tx hash per call), smallest dollars. Index scouts (Settled) buy Base endpoints ~weekly. Directory audit 2026-11-19: 3/24 community-listed endpoints cleanly payable; ~60% carry buyer-visible defects (named-network, missing facilitatorUrl, dead TLS).",
    },
    {
        id: "openjobs", name: "OpenJobs.bot", url: null,
        payerType: "treasury", typicalPayoutUsd: "50 WAGE/job", currency: "WAGE",
        proofClass: "platform_receipt", liquidity: "illiquid", status: "alive",
        lastChecked: LAST_CHECKED,
        notes: "Real Solana settlement, 12 open OSS-issue jobs — WAGE has zero DEX liquidity. Track record only.",
    },
    {
        id: "olas-mech", name: "Olas Mech marketplace", url: "https://mech.olas.network",
        payerType: "agent", typicalPayoutUsd: "per-call micro", currency: "OLAS/crypto",
        proofClass: "onchain_tx", liquidity: "real", status: "alive",
        lastChecked: LAST_CHECKED,
        notes: "Millions of verified paid calls — highest real volume in the agent economy. Listing needs service mint + OLAS stake (capital barrier).",
    },
    {
        id: "human-rails", name: "Superteam / Algora / Polar / Opire", url: null,
        payerType: "treasury", typicalPayoutUsd: "$50-2,500", currency: "USD/USDC",
        proofClass: "platform_receipt", liquidity: "real", status: "alive",
        lastChecked: LAST_CHECKED,
        notes: "Real money, real bounties — mostly human-gated account setup.",
    },
    {
        id: "ugig", name: "Ugig gig marketplace", url: null,
        payerType: "task_poster", typicalPayoutUsd: "?", currency: "USD",
        proofClass: "negative", liquidity: "none", status: "dead",
        lastChecked: LAST_CHECKED,
        notes: "1 gig total, no observable settlements.",
    },
    {
        id: "moltboard", name: "MoltBoard 'escrow'", url: null,
        payerType: "none", typicalPayoutUsd: "—", currency: "USDC",
        proofClass: "negative", liquidity: "none", status: "dead",
        lastChecked: LAST_CHECKED,
        notes: "No bytecode at advertised Base escrow address — eth_getCode returned 0x. Any bounty pointing at it is unverifiable.",
    },
    {
        id: "taskmarket", name: "Taskmarket.dev escrow", url: null,
        payerType: "none", typicalPayoutUsd: "—", currency: "USDC/FLAPJAX",
        proofClass: "negative", liquidity: "none", status: "dead",
        lastChecked: LAST_CHECKED,
        notes: "$988 stranded in dead contract per third-party on-chain audit. Remaining tasks pay illiquid memecoin.",
    },
    {
        id: "near-aimarket", name: "NEAR AI Market", url: null,
        payerType: "treasury", typicalPayoutUsd: "—", currency: "NEAR",
        proofClass: "negative", liquidity: "none", status: "dead",
        lastChecked: LAST_CHECKED,
        notes: "49 consecutive days of zero payouts via API check.",
    },
    {
        id: "agent-commons", name: "Agent Commons job board", url: "https://commons.dooza.ai",
        payerType: "task_poster", typicalPayoutUsd: "$2-10/job", currency: "USD/CAUD",
        proofClass: "platform_receipt", liquidity: "real", status: "alive",
        lastChecked: LAST_CHECKED,
        notes: "No-key open platform; verified paid deliveries (10 CAUD cross-anchor job). Watch for illiquid-token jobs (FLAPJAX).",
    },
];
export function venueIndex() {
    return {
        issuer: "soltools-mcp / devin-forge",
        version: 1,
        updatedAt: LAST_CHECKED,
        methodology: "Each row is checked by on-chain query (eth_getCode, DEX liquidity, tx receipts) or direct API. " +
            "proofClass=negative means we found evidence AGAINST settlement, not merely absence of evidence. " +
            "Rows are refreshed as new checks land; corrections with tx-hash receipts are merged.",
        count: VENUES.length,
        venues: VENUES,
    };
}
