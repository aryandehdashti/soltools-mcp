/**
 * Kertivo Trust Index cross-grade — paid-level verdicts beside our
 * challenge-level verdicts on overlapping rows (hectichustlebot's offer).
 * They pay real USDC per row and publish the tx hash; we never pay.
 * Divergent reads between the two layers are the interesting part.
 */

export interface KertivoRow {
  endpoint: string;
  grade: string;
  tx: string | null;
  settled: boolean;
  settledUSDC: string | null;
  ts: string;
  service: string | null;
}

const FEED = "https://kertivo.com/trust-index/raw.jsonl";
const TTL_MS = 2 * 60 * 60 * 1000;

let cache: { at: number; rows: Map<string, KertivoRow> } | null = null;
let inflight: Promise<Map<string, KertivoRow>> | null = null;

export function normUrl(u: string): string {
  return u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();
}

export async function kertivoRows(): Promise<Map<string, KertivoRow>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  if (!inflight) {
    inflight = (async () => {
      const rows = new Map<string, KertivoRow>();
      try {
        const resp = await fetch(FEED, {
          signal: AbortSignal.timeout(15000),
          headers: { "User-Agent": "soltools-board/1.2" },
        });
        if (resp.ok) {
          for (const line of (await resp.text()).split("\n")) {
            if (!line.trim()) continue;
            try {
              const j = JSON.parse(line) as Record<string, unknown>;
              const ep = (j.endpoint as string) ?? ((j.request as Record<string, unknown>)?.url as string);
              if (!ep) continue;
              rows.set(normUrl(ep), {
                endpoint: ep,
                grade: (j.grade as string) ?? "ungraded",
                tx: (j.paidTxHash as string) ?? null,
                settled: !!j.settled,
                settledUSDC: (j.settledUSDC as string) ?? null,
                ts: (j.timestamp as string) ?? "",
                service: (j.service as string) ?? null,
              });
            } catch {
              // a bad line skips itself; the rest of the feed still loads
            }
          }
        }
      } catch {
        // feed down or unreachable — board renders without the column
      }
      return rows;
    })().finally(() => {
      inflight = null;
    });
  }
  const rows = await inflight;
  cache = { at: Date.now(), rows };
  return rows;
}
