/**
 * EVM contract quick-check: is it a contract, what standard surface does it
 * expose, is it a proxy. Works on any chain we have an RPC for.
 */

const EIP1967_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CHAIN_URLS: Record<string, string[]> = {
  base: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://1rpc.io/base"],
  ethereum: ["https://eth.llamarpc.com", "https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth"],
  arbitrum: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
};

function evmUrls(chain: string): string[] {
  const urls = [
    ...(chain === "base" ? [process.env.BASE_RPC_URL] : []),
    ...(CHAIN_URLS[chain] ?? []),
  ].filter((u): u is string => !!u);
  return [...new Set(urls)];
}

async function evmRpc(chain: string, method: string, params: unknown[]): Promise<any> {
  let lastErr = "unreachable";
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of evmUrls(chain)) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        if (!res.ok) { lastErr = "RPC " + res.status; continue; }
        const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
        if (j.error) { lastErr = j.error.message ?? "rpc error"; continue; }
        return j.result;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    await sleep(400 * Math.pow(2, attempt));
  }
  throw new Error("evm RPC failed: " + lastErr);
}

async function call(chain: string, to: string, data: string): Promise<string | null> {
  try {
    const r = await evmRpc(chain, "eth_call", [{ to, data }, "latest"]);
    return typeof r === "string" ? r : null;
  } catch {
    return null;
  }
}

function decodeString(hex: string): string | null {
  try {
    const buf = Buffer.from(hex.slice(2), "hex");
    if (buf.length >= 64) {
      const len = Number(BigInt("0x" + buf.subarray(32, 64).toString("hex")));
      if (len >= 0 && len < 256 && buf.length >= 64 + len) {
        return buf.subarray(64, 64 + len).toString("utf8").replace(/[^\x20-\x7E]/g, "") || null;
      }
    }
    const s = buf.toString("utf8").replace(/[^\x20-\x7E]/g, "").trim();
    return s || null;
  } catch {
    return null;
  }
}

function decodeAddr(hex: string): string | null {
  try {
    return "0x" + hex.slice(-40).toLowerCase();
  } catch {
    return null;
  }
}

function decodeUint(hex: string): string | null {
  try {
    return BigInt(hex).toString();
  } catch {
    return null;
  }
}

export async function inspectContract(chain: string, address: string) {
  chain = chain.toLowerCase();
  if (!CHAIN_URLS[chain]) {
    return { error: "unsupported chain — use base, ethereum, arbitrum", chain, address };
  }
  const code = await evmRpc(chain, "eth_getCode", [address, "latest"]);
  const isContract = typeof code === "string" && code !== "0x";
  if (!isContract) {
    return { chain, address, isContract: false, note: "EOA or empty — nothing to inspect" };
  }
  const bytecodeBytes = (code.length - 2) / 2;

  const [implSlot, nameH, symH, decH, supH, ownH] = await Promise.all([
    evmRpc(chain, "eth_getStorageAt", [address, EIP1967_IMPL, "latest"]).catch(() => null),
    call(chain, address, "0x06fdde03"),
    call(chain, address, "0x95d89b41"),
    call(chain, address, "0x313ce567"),
    call(chain, address, "0x18160ddd"),
    call(chain, address, "0x8da5cb5b"),
  ]);

  const impl = implSlot && implSlot !== "0x" + "0".repeat(64) ? decodeAddr(implSlot) : null;
  const flags: { code: string; severity: string; detail: string }[] = [];
  if (impl) flags.push({ code: "proxy", severity: "info", detail: "EIP-1967 proxy — logic can be upgraded by the admin" });
  const owner = ownH ? decodeAddr(ownH) : null;
  if (owner && owner !== "0x0000000000000000000000000000000000000000") {
    flags.push({ code: "has_owner", severity: "medium", detail: "owner() returns a live address — privileged functions may exist" });
  }

  return {
    chain,
    address,
    isContract: true,
    bytecodeBytes,
    proxy: impl ? { type: "eip1967", implementation: impl } : null,
    erc20: {
      name: nameH ? decodeString(nameH) : null,
      symbol: symH ? decodeString(symH) : null,
      decimals: decH ? Number(BigInt(decH)) : null,
      totalSupply: supH ? decodeUint(supH) : null,
    },
    owner,
    flags,
  };
}
