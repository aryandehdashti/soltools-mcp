/** Solana RPC + DexScreener helpers with small caches. */

export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

const DEFAULT_RPC = "https://api.devnet.solana.com";
const DEFAULT_DEX = "https://api.dexscreener.com/latest/dex";

const cache = new Map<string, { v: unknown; exp: number }>();

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.v as T;
  const v = await fn();
  cache.set(key, { v, exp: Date.now() + ttlMs });
  return v;
}

export async function rpc(method: string, params: unknown[]): Promise<any> {
  const url = process.env.SOLANA_RPC_URL || DEFAULT_RPC;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error("RPC " + method + " failed: " + res.status);
  const j = (await res.json()) as { result?: unknown; error?: unknown };
  if (j.error) throw new Error("RPC error: " + JSON.stringify(j.error));
  return j.result;
}

export async function dexscreener(path: string): Promise<any> {
  return cached("dex:" + path, 20_000, async () => {
    const res = await fetch(DEFAULT_DEX + "/" + path);
    if (!res.ok) throw new Error("DexScreener failed: " + res.status);
    return res.json();
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
