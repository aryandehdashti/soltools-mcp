/** Solana RPC + DexScreener helpers with small caches. */

export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const DEFAULT_DEX = "https://api.dexscreener.com/latest/dex";

const cache = new Map<string, { v: unknown; exp: number }>();

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.v as T;
  const v = await fn();
  cache.set(key, { v, exp: Date.now() + ttlMs });
  return v;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rpcUrls(): string[] {
  const urls = [
    process.env.SOLANA_RPC_URL,
    ...(process.env.SOLANA_RPC_URLS ?? "").split(","),
    DEFAULT_RPC,
    "https://api.mainnet.solana.com",
  ].filter((u): u is string => !!u && u.startsWith("http"));
  return [...new Set(urls)];
}

export async function rpc(method: string, params: unknown[]): Promise<any> {
  const urls = rpcUrls();
  let lastErr = "unreachable";
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = method + " " + res.status + " @ " + new URL(url).host;
          continue;
        }
        if (!res.ok) {
          lastErr = method + " " + res.status + " @ " + new URL(url).host;
          continue;
        }
        const j = (await res.json()) as { result?: unknown; error?: unknown };
        if (j.error) {
          lastErr = "RPC error: " + JSON.stringify(j.error);
          continue;
        }
        return j.result;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    await sleep(500 * Math.pow(2, attempt));
  }
  throw new Error("RPC " + method + " failed: " + lastErr);
}

export async function dexscreener(path: string): Promise<any> {
  return cached("dex:" + path, 20_000, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(DEFAULT_DEX + "/" + path);
      if (res.status === 429 || res.status >= 500) {
        await sleep(400 * Math.pow(2, attempt));
        continue;
      }
      if (!res.ok) throw new Error("DexScreener failed: " + res.status);
      return res.json();
    }
    throw new Error("DexScreener rate limited after retries");
  });
}

export function formatUsd(n: number): string {
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

export function shortAddr(a: string): string {
  return a.length > 12 ? a.slice(0, 5) + "..." + a.slice(-4) : a;
}
