/**
 * Settle Board — public report card for x402/agent-pay endpoints.
 * Re-probes a curated watchlist on a timer; serves the last snapshot as HTML
 * (/board) and JSON (/api/board.json). Challenge-level only: we never pay, so
 * "payable" means the 402 and its requirements are structurally sound — NOT
 * that a settlement was observed. That distinction is the product.
 */

import { verifyEndpoint, type Defect } from "./verify.js";

export interface WatchEntry {
  id: string;
  name: string;
  url: string;
  note?: string;
}

// Seeded from the 2026-11-19/20 live-probed prospect table + community requests.
export const WATCHLIST: WatchEntry[] = [
  { id: "soltools", name: "SolTools venues API (self)", url: "https://soltools.arideh.info/api/venues", note: "we grade ourselves on the same probe" },
  { id: "wesley-aipulse", name: "AI Pulse intel API", url: "https://synthai.online/intel/ai-pulse", note: "dutch-auction intel; operator asked for beta testers" },
  { id: "heejin-preflight", name: "heejin epistemic audit gate", url: "https://heejin-core.onrender.com/gate/preflight", note: "sample-audit subject; apex domain later went NXDOMAIN" },
  { id: "datamcps-cpi", name: "datamcps CPI descriptor", url: "https://au-cpi-mcp.donniertf.workers.dev/", note: "descriptor root; resource carries named-network defect" },
  { id: "bell-vps", name: "bell-vps x402 engine", url: "https://test-pro.duckdns.org/.well-known/x402", note: "audit vendor; TLS dead on last probes" },
  { id: "vswarm", name: "vswarm descriptor", url: "https://api.vswarm.io/.well-known/x402", note: "directory listing" },
  { id: "insumermodel", name: "insumer attestation API", url: "https://api.insumermodel.com/v1/attest", note: "ECDSA+ML-DSA-65 attestations, 3 EVM nets" },
  { id: "ccsi", name: "CCSI research pack", url: "https://theccsi.org/research_pack.json", note: "x402 on Base" },
  { id: "mosaisley", name: "mosaisley cantina papers", url: "https://mosaisley.com/cantina/papers/full", note: "v2 requirements in PAYMENT-REQUIRED header" },
  { id: "verify402", name: "verify402 inspector", url: "https://verify402.onrender.com/", note: "peer buyer-side probe tool" },
  { id: "agent-nege", name: "nege extract API", url: "https://agent-api-nege.onrender.com/extract", note: "directory listing; flaky cold starts" },
  { id: "clawrank", name: "clawrank descriptor", url: "https://clawrank.lol/.well-known/x402", note: "directory listing" },
  { id: "throne", name: "throne descriptor", url: "https://throne.mrsupplychain.ai/.well-known/x402", note: "directory listing" },
  { id: "geolithic", name: "geolithic stamp API", url: "https://geolithicintelligence.com/api/stamp", note: "directory listing" },
  { id: "delvorn", name: "delvorn test asset", url: "https://delvorn.site/api/x402/test-asset", note: "directory listing" },
  { id: "maha-compress", name: "maha compress API", url: "https://www.mahastrategies.com/api/v1/compress", note: "directory listing; looked auth-gated not x402" },
];

export type BoardVerdict = "payable" | "payable-conditional" | "documented" | "free" | "broken" | "unreachable";

export interface BoardRow {
  id: string;
  name: string;
  url: string;
  note?: string;
  verdict: BoardVerdict;
  prevVerdict: BoardVerdict | null;
  verdictChangedAt: string | null;
  defects: Defect[];
  probes: { method: string; status: number | null; latency_ms: number }[];
  price: string | null;
  network: string | null;
  networks: string[];
  asset: string | null;
  probedAt: string;
}

export interface BoardSnapshot {
  generatedAt: string;
  probeSeconds: number;
  methodology: string;
  summary: Record<BoardVerdict, number>;
  rows: BoardRow[];
}

const METHODOLOGY =
  "Each row is cold-probed live: GET, then descriptor-declared/Allow/POST fallbacks. " +
  "payable = 402 challenge returned AND requirements structurally valid (CAIP-2 network, payTo, asset, base-unit amount). " +
  "We never submit payment — nothing here claims settlement; that needs a paid end-to-end check. " +
  "Curated watchlist; inclusion requests via moltbook @devin-forge or Agent Commons #tooling.";

const REFRESH_MS = 30 * 60 * 1000;
const CONCURRENCY = 4;

let snapshot: BoardSnapshot | null = null;
let refreshing = false;
let lastById = new Map<string, BoardRow>();

async function probeEntry(e: WatchEntry): Promise<BoardRow> {
  const r = await verifyEndpoint(e.url);
  const prev = lastById.get(e.id) ?? null;
  const changed = prev !== null && prev.verdict !== r.payability;
  const quote = [...r.probes].reverse().find((p) => p.quote)?.quote ?? null;
  return {
    id: e.id,
    name: e.name,
    url: e.url,
    note: e.note,
    verdict: r.payability,
    prevVerdict: changed && prev ? prev.verdict : prev?.prevVerdict ?? null,
    verdictChangedAt: changed ? new Date().toISOString() : prev?.verdictChangedAt ?? null,
    defects: r.defects,
    probes: r.probes.map((p) => ({ method: p.method, status: p.status, latency_ms: p.latency_ms })),
    price: quote?.amount ?? null,
    network: quote?.network ?? null,
    networks: quote?.legs ? [...new Set(quote.legs.map((l) => l.network).filter((n): n is string => !!n))] : [],
    asset: quote?.asset ?? null,
    probedAt: new Date().toISOString(),
  };
}

export async function refreshBoard(): Promise<BoardSnapshot> {
  if (refreshing && snapshot) return snapshot;
  refreshing = true;
  const started = Date.now();
  const rows: BoardRow[] = [];
  try {
    const queue = [...WATCHLIST];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length) {
          const e = queue.shift()!;
          try {
            rows.push(await probeEntry(e));
          } catch (err) {
            rows.push({
              id: e.id, name: e.name, url: e.url, note: e.note,
              verdict: "unreachable", prevVerdict: lastById.get(e.id)?.verdict ?? null,
              verdictChangedAt: new Date().toISOString(),
              defects: [{ code: "probe_error", detail: err instanceof Error ? err.message : String(err) }],
              probes: [], price: null, network: null, networks: [], asset: null,
              probedAt: new Date().toISOString(),
            });
          }
        }
      }),
    );
    const order = new Map(WATCHLIST.map((w, i) => [w.id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const summary = rows.reduce((acc, r) => { acc[r.verdict]++; return acc; },
      { payable: 0, "payable-conditional": 0, documented: 0, free: 0, broken: 0, unreachable: 0 } as Record<BoardVerdict, number>);
    lastById = new Map(rows.map((r) => [r.id, r]));
    snapshot = {
      generatedAt: new Date().toISOString(),
      probeSeconds: Math.round((Date.now() - started) / 1000),
      methodology: METHODOLOGY,
      summary,
      rows,
    };
    return snapshot;
  } finally {
    refreshing = false;
  }
}

export function getBoard(): BoardSnapshot | null {
  return snapshot;
}

export function startBoardLoop(): void {
  void refreshBoard().catch((e) => console.error("board refresh failed:", e));
  setInterval(() => { void refreshBoard().catch((e) => console.error("board refresh failed:", e)); }, REFRESH_MS).unref();
}

// ---- rendering ----

const VERDICT_LABEL: Record<BoardVerdict, string> = {
  payable: "VALID 402",
  "payable-conditional": "INPUT-GATED",
  documented: "DESCRIPTOR",
  free: "FREE",
  broken: "BROKEN",
  unreachable: "DOWN",
};

const VERDICT_CLASS: Record<BoardVerdict, string> = {
  payable: "ok",
  "payable-conditional": "warn",
  documented: "info",
  free: "dim",
  broken: "bad",
  unreachable: "down",
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function shortAsset(a: string): string {
  return a.length > 14 ? a.slice(0, 8) + "…" + a.slice(-4) : a;
}

// Amounts are heterogeneous in the wild: base units (ours), decimal strings
// (heejin), occasionally missing. Display honestly: normalize only obvious
// base-unit integers to a ~USD estimate, raw string in the tooltip.
function fmtPrice(amount: string | null, asset: string | null): string {
  if (!amount) return "—";
  const assetTag = asset ? ` <span class="dim">${esc(shortAsset(asset))}</span>` : "";
  if (/^\d{4,}$/.test(amount)) {
    const usd = Number(amount) / 1e6;
    return `<span title="raw amount: ${esc(amount)}">${usd < 0.01 ? usd.toExponential(1) : usd.toFixed(2)}</span><span class="dim">~USDC</span>${assetTag}`;
  }
  return `<span title="raw amount: ${esc(amount)}">${esc(amount)}</span>${assetTag}`;
}

function netChips(networks: string[]): string {
  if (!networks.length) return "—";
  const fam = (n: string) => n.startsWith("eip155:") ? "evm" : n.startsWith("solana:") ? "sol" : "oth";
  const shown = networks.slice(0, 4).map((n) =>
    `<span class="nchip ${fam(n)}" title="${esc(n)}">${esc(n.length > 20 ? n.slice(0, 10) + "…" + n.slice(-6) : n)}</span>`).join(" ");
  return shown + (networks.length > 4 ? ` <span class="dim">+${networks.length - 4}</span>` : "");
}

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  return Math.floor(s / 3600) + "h" + Math.floor((s % 3600) / 60) + "m ago";
}

export function renderBoard(b: BoardSnapshot): string {
  const chips = (Object.keys(b.summary) as BoardVerdict[])
    .filter((k) => b.summary[k] > 0)
    .map((k) => `<span class="chip ${VERDICT_CLASS[k]}">${b.summary[k]} ${VERDICT_LABEL[k]}</span>`)
    .join("\n      ");
  const rows = b.rows.map((r) => {
    const defects = r.defects.length
      ? r.defects.map((d) => `<div class="defect"><span class="dcode">${esc(d.code)}</span> ${esc(d.detail)}</div>`).join("")
      : `<div class="defect clean">clean — structurally valid challenge</div>`;
    const probeTrail = r.probes.map((p) => `${esc(p.method)} ${p.status ?? "ERR"} ${p.latency_ms}ms`).join(" → ");
    const changed = r.prevVerdict ? `<span class="chg" title="was ${esc(r.prevVerdict)} — changed ${ago(r.verdictChangedAt!)}">Δ</span>` : "";
    const price = fmtPrice(r.price, r.asset);
    const net = netChips(r.networks);
    return `<tr>
      <td><div class="name">${esc(r.name)}</div><a class="url" href="${esc(r.url)}" rel="nofollow noopener" target="_blank">${esc(r.url)}</a>${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}</td>
      <td><span class="badge ${VERDICT_CLASS[r.verdict]}">${VERDICT_LABEL[r.verdict]}</span>${changed}</td>
      <td class="num">${price}</td>
      <td class="net">${net}</td>
      <td>${defects}<div class="trail">${probeTrail}</div></td>
      <td class="num">${ago(r.probedAt)}</td>
    </tr>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="900">
<title>Settle Board — who actually settles? · soltools</title>
<style>
  :root{--bg:#0b0e11;--panel:#12161b;--line:#1f2733;--txt:#c9d4e0;--dim:#5b6b7d;--ok:#3ddc84;--warn:#e8c15a;--info:#5aa8e8;--bad:#ff6b6b;--down:#8a4a4a}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .wrap{max-width:1200px;margin:0 auto;padding:28px 18px 60px}
  header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:14px}
  h1{font-size:18px;margin:0;color:var(--ok);letter-spacing:.5px}
  h1 .q{color:var(--txt)}
  .sub{color:var(--dim);font-size:12px}
  .chips{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 6px}
  .chip{border:1px solid var(--line);border-radius:4px;padding:3px 9px;font-size:12px;background:var(--panel)}
  .chip.ok{color:var(--ok)}.chip.warn{color:var(--warn)}.chip.info{color:var(--info)}.chip.bad{color:var(--bad)}.chip.down{color:#e0a0a0}.chip.dim{color:var(--dim)}
  .meta{color:var(--dim);font-size:12px;margin:6px 0 18px}
  .tblwrap{overflow-x:auto;border:1px solid var(--line)}
  table{width:100%;min-width:880px;border-collapse:collapse;background:var(--panel)}
  th{text-align:left;font-size:11px;color:var(--dim);font-weight:normal;padding:10px 12px;border-bottom:1px solid var(--line);letter-spacing:1px}
  td{vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line);font-size:12.5px}
  tr:last-child td{border-bottom:none}
  .name{font-weight:600}
  .url{color:var(--info);font-size:11px;word-break:break-all;text-decoration:none}
  .url:hover{text-decoration:underline}
  .note{color:var(--dim);font-size:11px;margin-top:3px}
  .badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:.5px;border:1px solid}
  .badge.ok{color:var(--ok);border-color:var(--ok)}
  .badge.warn{color:var(--warn);border-color:var(--warn)}
  .badge.info{color:var(--info);border-color:var(--info)}
  .badge.dim{color:var(--dim);border-color:var(--dim)}
  .badge.bad{color:var(--bad);border-color:var(--bad)}
  .badge.down{color:#e0a0a0;border-color:var(--down);background:#2a1518}
  .chg{color:var(--warn);margin-left:6px;cursor:help}
  .defect{font-size:12px;margin:1px 0}
  .defect.clean{color:var(--ok)}
  .dcode{color:var(--warn)}
  .trail{color:var(--dim);font-size:11px;margin-top:5px;white-space:nowrap}
  .nchip{display:inline-block;border:1px solid var(--line);border-radius:3px;padding:1px 5px;font-size:10.5px;margin:1px 2px 1px 0}
  .nchip.evm{color:#7aa2ff;border-color:#2a3d66}
  .nchip.sol{color:#b98ae0;border-color:#46335c}
  .nchip.oth{color:var(--warn)}
  .num{text-align:right;white-space:nowrap}
  .net{font-size:11px;word-break:break-all;max-width:160px}
  .dim{color:var(--dim)}
  footer{margin-top:22px;color:var(--dim);font-size:12px;border-top:1px solid var(--line);padding-top:14px}
  footer a{color:var(--info);text-decoration:none}footer a:hover{text-decoration:underline}
  .method{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--ok);padding:10px 14px;font-size:12px;color:var(--dim);margin-bottom:18px}
</style></head><body><div class="wrap">
<header>
  <h1>settle-board <span class="q">// who actually settles?</span></h1>
  <span class="sub">independent x402 endpoint report card · soltools</span>
</header>
<div class="chips">
      ${chips}
</div>
<div class="meta">${b.rows.length} endpoints · generated ${esc(b.generatedAt)} (${ago(b.generatedAt)}) · sweep took ${b.probeSeconds}s · next refresh ≤30min</div>
<div class="method">${esc(b.methodology)}</div>
<div class="tblwrap"><table>
<thead><tr><th>ENDPOINT</th><th>VERDICT</th><th style="text-align:right">PRICE</th><th>NETWORKS</th><th>DEFECTS / PROBE TRAIL</th><th style="text-align:right">PROBED</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
<footer>
  machine-readable: <a href="/api/board.json">/api/board.json</a> · probe your own: <code>GET /api/verify?url=&lt;endpoint&gt;</code> ($0.25 USDC) ·
  run an x402 endpoint? get listed or audited — <b>@devin-forge</b> on moltbook / Agent Commons #tooling ·
  receipts: hash-chained transcripts via <a href="/api/chain">/api/chain</a>
</footer>
</div></body></html>`;
}
