/**
 * Payout attestation: verify a claimed payment tx on-chain and return a
 * structured verdict. Solana (USDC SPL) and Base (USDC ERC-20) supported.
 * No custody, no signing keys — the verdict is deterministic from chain data.
 */

const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BASE_RPC = "https://mainnet.base.org";

export interface Transfer {
  asset: string;
  amountRaw: string;
  amountUsd: number;
  from: string | null;
  to: string | null;
}

export interface Attestation {
  issuer: string;
  issuedAt: string;
  chain: string;
  tx: string;
  found: boolean;
  confirmed: boolean;
  verdict: "settled" | "failed" | "not_found" | "no_relevant_transfer";
  blockTime: string | null;
  transfers: Transfer[];
  explorer: string;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function solanaUrls(): string[] {
  const urls = [
    process.env.SOLANA_RPC_URL,
    ...(process.env.SOLANA_RPC_URLS ?? "").split(","),
    "https://api.mainnet-beta.solana.com",
    "https://api.mainnet.solana.com",
  ].filter((u): u is string => !!u && u.startsWith("http"));
  return [...new Set(urls)];
}

async function solanaRpc(method: string, params: unknown[]): Promise<any> {
  let lastErr = "unreachable";
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of solanaUrls()) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        if (res.status === 429 || res.status >= 500 || !res.ok) {
          lastErr = "solana RPC " + res.status;
          continue;
        }
        const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
        if (j.error) {
          lastErr = j.error.message ?? "RPC error";
          continue;
        }
        return j.result;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    await sleep(500 * Math.pow(2, attempt));
  }
  throw new Error("solana RPC failed: " + lastErr);
}

async function evmRpc(method: string, params: unknown[]): Promise<any> {
  const url = process.env.BASE_RPC_URL || BASE_RPC;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (res.status === 429 || res.status >= 500) {
      await sleep(400 * Math.pow(2, attempt));
      continue;
    }
    if (!res.ok) throw new Error("evm RPC " + res.status);
    const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (j.error) throw new Error(j.error.message ?? "RPC error");
    return j.result;
  }
  throw new Error("evm RPC rate limited after retries");
}

function padAddr(topic: string): string {
  return "0x" + topic.slice(26).toLowerCase();
}

async function attestSolana(tx: string): Promise<Attestation> {
  const base: Attestation = {
    issuer: "soltools-mcp attest/1",
    issuedAt: new Date().toISOString(),
    chain: "solana",
    tx,
    found: false,
    confirmed: false,
    verdict: "not_found",
    blockTime: null,
    transfers: [],
    explorer: "https://solscan.io/tx/" + tx,
  };
  const res = await solanaRpc("getTransaction", [tx, { encoding: "jsonParsed", maxSupportedTransactionVersion: 127 }]);
  if (!res) return base;
  base.found = true;
  const meta = res.meta;
  base.blockTime = res.blockTime ? new Date(res.blockTime * 1000).toISOString() : null;
  if (meta?.err) {
    base.verdict = "failed";
    return base;
  }
  base.confirmed = true;

  // USDC received = positive delta between pre/post token balances per account;
  // sender = the account(s) with the matching negative delta.
  const pre = new Map<number, { amount: number; owner?: string }>();
  for (const b of meta?.preTokenBalances ?? []) {
    if (b.mint === SOL_USDC) pre.set(b.accountIndex, { amount: Number(b.uiTokenAmount?.uiAmount ?? 0), owner: b.owner });
  }
  const senders: string[] = [];
  const postSeen = new Set<number>();
  for (const b of meta?.postTokenBalances ?? []) {
    if (b.mint !== SOL_USDC) continue;
    postSeen.add(b.accountIndex);
    const post = Number(b.uiTokenAmount?.uiAmount ?? 0);
    const delta = post - (pre.get(b.accountIndex)?.amount ?? 0);
    if (delta < 0 && b.owner) senders.push(b.owner);
    if (delta > 0) {
      base.transfers.push({
        asset: SOL_USDC,
        amountRaw: String(Math.round(delta * 1e6)),
        amountUsd: delta,
        from: null,
        to: b.owner ?? null,
      });
    }
  }
  // Accounts whose token balance closed (present in pre, absent in post) are also senders.
  for (const [idx, p] of pre) {
    if (!postSeen.has(idx) && p.amount > 0 && p.owner) senders.push(p.owner);
  }
  for (const t of base.transfers) t.from = senders[0] ?? null;
  base.verdict = base.transfers.length > 0 ? "settled" : "no_relevant_transfer";
  return base;
}

async function attestBase(tx: string): Promise<Attestation> {
  const base: Attestation = {
    issuer: "soltools-mcp attest/1",
    issuedAt: new Date().toISOString(),
    chain: "base",
    tx,
    found: false,
    confirmed: false,
    verdict: "not_found",
    blockTime: null,
    transfers: [],
    explorer: "https://basescan.org/tx/" + tx,
  };
  const [receipt] = await Promise.all([evmRpc("eth_getTransactionReceipt", [tx])]);
  if (!receipt) return base;
  base.found = true;
  if (receipt.status !== "0x1") {
    base.verdict = "failed";
    return base;
  }
  base.confirmed = true;
  const block = await evmRpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
  if (block?.timestamp) base.blockTime = new Date(parseInt(block.timestamp, 16) * 1000).toISOString();

  for (const log of receipt.logs ?? []) {
    if ((log.address as string).toLowerCase() !== BASE_USDC) continue;
    if ((log.topics?.[0] as string)?.toLowerCase() !== TRANSFER_TOPIC) continue;
    const amountRaw = BigInt(log.data);
    base.transfers.push({
      asset: BASE_USDC,
      amountRaw: amountRaw.toString(),
      amountUsd: Number(amountRaw) / 1e6,
      from: log.topics[1] ? padAddr(log.topics[1]) : null,
      to: log.topics[2] ? padAddr(log.topics[2]) : null,
    });
  }
  base.verdict = base.transfers.length > 0 ? "settled" : "no_relevant_transfer";
  return base;
}

export async function attestTx(chain: string, tx: string): Promise<Attestation> {
  const c = chain.toLowerCase();
  if (c === "solana" || c === "sol") return attestSolana(tx);
  if (c === "base" || c === "eip155:8453") return attestBase(tx);
  return {
    issuer: "soltools-mcp attest/1",
    issuedAt: new Date().toISOString(),
    chain,
    tx,
    found: false,
    confirmed: false,
    verdict: "not_found",
    blockTime: null,
    transfers: [],
    explorer: "",
    error: "unsupported chain — use solana or base",
  };
}
