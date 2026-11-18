/**
 * Token safety scan for Solana mints: authorities, holder concentration,
 * market microstructure. Flags, not scores — buyers judge severity.
 */
import { rpc, dexscreener } from "./solana.js";

export interface TokenFlag {
  code: string;
  severity: "high" | "medium" | "info";
  detail: string;
}

export async function scanToken(mint: string) {
  const flags: TokenFlag[] = [];
  const [supply, accInfo, largest, dex] = await Promise.all([
    rpc("getTokenSupply", [mint]).catch(() => null),
    rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]).catch(() => null),
    rpc("getTokenLargestAccounts", [mint]).catch(() => null),
    dexscreener("tokens/" + mint).catch(() => null),
  ]);

  if (!supply && !accInfo) {
    return { mint, found: false, flags: [{ code: "not_a_mint", severity: "high", detail: "no mint data returned — bad address or not an SPL token" }] };
  }

  const info = accInfo?.value?.data?.parsed?.info ?? {};
  const supplyUi = Number(supply?.value?.uiAmount ?? 0);

  if (info.mintAuthority) {
    flags.push({ code: "mint_authority_active", severity: "high", detail: "supply can be inflated at will by " + info.mintAuthority });
  }
  if (info.freezeAuthority) {
    flags.push({ code: "freeze_authority_active", severity: "high", detail: "holder accounts can be frozen by " + info.freezeAuthority });
  }
  if (!info.mintAuthority && !info.freezeAuthority) {
    flags.push({ code: "authorities_revoked", severity: "info", detail: "mint + freeze authorities both revoked — supply is fixed" });
  }

  const accounts = (largest?.value ?? []) as { uiAmount?: number; address?: string }[];
  const top10 = accounts.slice(0, 10).reduce((s, a) => s + (a.uiAmount ?? 0), 0);
  const top10Pct = supplyUi > 0 ? (top10 / supplyUi) * 100 : null;
  const top1Pct = supplyUi > 0 && accounts[0] ? ((accounts[0].uiAmount ?? 0) / supplyUi) * 100 : null;
  if (top10Pct != null && top10Pct > 50) {
    flags.push({ code: "concentrated_supply", severity: "high", detail: `top 10 holders own ${top10Pct.toFixed(1)}% of supply` });
  } else if (top10Pct != null && top10Pct > 30) {
    flags.push({ code: "concentrated_supply", severity: "medium", detail: `top 10 holders own ${top10Pct.toFixed(1)}% of supply` });
  }

  const pair = (dex?.pairs ?? []).filter((p: { chainId: string }) => p.chainId === "solana")
    .sort((a: { liquidity?: { usd?: number } }, b: { liquidity?: { usd?: number } }) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  const liq = pair?.liquidity?.usd ?? null;
  if (liq == null) {
    flags.push({ code: "no_dex_market", severity: "high", detail: "no DexScreener pair — token cannot be sold" });
  } else if (liq < 10_000) {
    flags.push({ code: "thin_liquidity", severity: "high", detail: `only $${Math.round(liq).toLocaleString()} liquidity — large sells will fail or nuke price` });
  } else if (liq < 50_000) {
    flags.push({ code: "thin_liquidity", severity: "medium", detail: `$${Math.round(liq).toLocaleString()} liquidity` });
  }

  const tx = pair?.txns?.h24;
  let sellRatio: number | null = null;
  if (tx && tx.buys + tx.sells > 0) sellRatio = tx.sells / (tx.buys + tx.sells);
  if (sellRatio != null && sellRatio > 0.7 && (tx.sells + tx.buys) > 20) {
    flags.push({ code: "sell_pressure", severity: "medium", detail: `${(sellRatio * 100).toFixed(0)}% of 24h txns are sells` });
  }

  const high = flags.filter((f) => f.severity === "high").length;
  return {
    mint,
    found: true,
    symbol: pair?.baseToken?.symbol ?? null,
    supply: supplyUi || null,
    decimals: supply?.value?.decimals ?? null,
    authorities: {
      mint: info.mintAuthority ?? null,
      freeze: info.freezeAuthority ?? null,
      revoked: !info.mintAuthority && !info.freezeAuthority,
    },
    concentration: { top1Pct, top10Pct, topHolders: accounts.slice(0, 5).map((a) => a.address) },
    market: {
      priceUsd: pair?.priceUsd ? Number(pair.priceUsd) : null,
      liquidityUsd: liq,
      marketCapUsd: pair?.marketCap ?? pair?.fdv ?? null,
      volume24hUsd: pair?.volume?.h24 ?? null,
      buys24h: tx?.buys ?? null,
      sells24h: tx?.sells ?? null,
      sellRatio,
      pairAddress: pair?.pairAddress ?? null,
      dex: pair?.dexId ?? null,
    },
    flags,
    verdict: high >= 2 ? "risky" : high === 1 ? "caution" : "clean",
  };
}
