/**
 * Agent reputation primitives: public Moltbook presence + on-chain activity.
 * Returns raw signals and a composed 0-100 score with the breakdown shown —
 * callers can verify every input, which is the point.
 */
import { rpc } from "./solana.js";
async function moltbookSignal(handle) {
    try {
        const res = await fetch("https://www.moltbook.com/api/v1/search?q=" + encodeURIComponent(handle), {
            headers: { "User-Agent": "soltools-trust/1.0" },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok)
            return { found: false, error: "moltbook " + res.status };
        const d = (await res.json());
        const hit = (d.results ?? []).find((r) => r.type === "agent" && r.title.toLowerCase() === handle.toLowerCase());
        if (!hit)
            return { found: false };
        return {
            found: true,
            handle: hit.title,
            ageDays: Math.floor((Date.now() - new Date(hit.created_at).getTime()) / 86400000),
            netUpvotes: (hit.upvotes ?? 0) - (hit.downvotes ?? 0),
            bioSnippet: (hit.content ?? "").slice(0, 160),
        };
    }
    catch (e) {
        return { found: false, error: e instanceof Error ? e.message : "fetch failed" };
    }
}
async function solanaSignal(address) {
    try {
        const [bal, tokens, sigs] = await Promise.all([
            rpc("getBalance", [address]),
            rpc("getTokenAccountsByOwner", [address, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }]).catch(() => null),
            rpc("getSignaturesForAddress", [address, { limit: 25 }]).catch(() => null),
        ]);
        return {
            checked: true,
            solBalance: (bal?.value ?? 0) / 1e9,
            tokenAccountCount: Array.isArray(tokens?.value) ? tokens.value.length : undefined,
            recentTxCount: Array.isArray(sigs) ? sigs.length : undefined,
        };
    }
    catch (e) {
        return { checked: false, error: e instanceof Error ? e.message : "rpc failed" };
    }
}
export async function trustScore(handle, address) {
    const signals = {};
    let score = 0;
    const breakdown = [];
    if (handle) {
        const m = await moltbookSignal(handle);
        signals.moltbook = m;
        if (m.found) {
            const agePts = Math.min(30, (m.ageDays ?? 0) * 3);
            const karmaPts = Math.max(-10, Math.min(40, (m.netUpvotes ?? 0) * 4));
            breakdown.push({ signal: "moltbook_account_age", points: agePts, detail: `${m.ageDays} days old` });
            breakdown.push({ signal: "moltbook_karma", points: karmaPts, detail: `${m.netUpvotes} net upvotes` });
            score += agePts + karmaPts;
        }
    }
    if (address) {
        const s = await solanaSignal(address);
        signals.solana = s;
        if (s.checked) {
            const txPts = Math.min(30, (s.recentTxCount ?? 0));
            const heldPts = Math.min(10, (s.tokenAccountCount ?? 0));
            breakdown.push({ signal: "onchain_activity", points: txPts, detail: `${s.recentTxCount} recent transactions` });
            breakdown.push({ signal: "token_holdings", points: heldPts, detail: `${s.tokenAccountCount} token accounts` });
            score += txPts + heldPts;
        }
    }
    return {
        issuer: "soltools-trust/1",
        queriedAt: new Date().toISOString(),
        handle,
        address,
        score: Math.max(0, Math.min(100, score)),
        scoreMax: 100,
        verdict: score >= 60 ? "established" : score >= 30 ? "some_history" : score >= 10 ? "thin" : "unknown",
        breakdown,
        signals,
        caveat: "Reputation primitives only — presence and activity, not endorsement. Verify receipts independently.",
    };
}
