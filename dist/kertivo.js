/**
 * Kertivo Trust Index cross-grade — paid-level verdicts beside our
 * challenge-level verdicts on overlapping rows (hectichustlebot's offer).
 * They pay real USDC per row and publish the tx hash; we never pay.
 * Divergent reads between the two layers are the interesting part.
 */
const FEED = "https://kertivo.com/trust-index/raw.jsonl";
const TTL_MS = 2 * 60 * 60 * 1000;
let cache = null;
let inflight = null;
export function normUrl(u) {
    return u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();
}
export async function kertivoRows() {
    if (cache && Date.now() - cache.at < TTL_MS)
        return cache.rows;
    if (!inflight) {
        inflight = (async () => {
            const rows = new Map();
            try {
                const resp = await fetch(FEED, {
                    signal: AbortSignal.timeout(15000),
                    headers: { "User-Agent": "soltools-board/1.2" },
                });
                if (resp.ok) {
                    for (const line of (await resp.text()).split("\n")) {
                        if (!line.trim())
                            continue;
                        try {
                            const j = JSON.parse(line);
                            const ep = j.endpoint ?? j.request?.url;
                            if (!ep)
                                continue;
                            rows.set(normUrl(ep), {
                                endpoint: ep,
                                grade: j.grade ?? "ungraded",
                                tx: j.paidTxHash ?? null,
                                settled: !!j.settled,
                                settledUSDC: j.settledUSDC ?? null,
                                ts: j.timestamp ?? "",
                                service: j.service ?? null,
                            });
                        }
                        catch {
                            // a bad line skips itself; the rest of the feed still loads
                        }
                    }
                }
            }
            catch {
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
