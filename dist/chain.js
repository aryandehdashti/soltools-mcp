// Hash-chained acceptance-test transcripts.
// Each step commits to the previous step's hash, so a verdict provably refers
// to THIS criteria set and THIS delivered artifact — not some other negotiation.
// Spec: chaincheck-link-v1. Free to compute; anchor the root via /api/attest.
import { createHash } from "node:crypto";
const GENESIS = "0".repeat(64);
function canonical(v) {
    if (v === null || typeof v !== "object")
        return JSON.stringify(v);
    if (Array.isArray(v))
        return "[" + v.map(canonical).join(",") + "]";
    const o = v;
    return "{" + Object.keys(o).sort().map(k => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}
function sha256hex(s) {
    return createHash("sha256").update(s, "utf8").digest("hex");
}
const TYPE_RE = /^[a-z0-9_-]{1,32}$/i;
const MAX_STEPS = 64;
const MAX_BODY_BYTES = 256 * 1024;
export function buildChain(raw) {
    if (!Array.isArray(raw) || raw.length === 0)
        return { ok: false, error: "steps must be a non-empty array" };
    if (raw.length > MAX_STEPS)
        return { ok: false, error: `too many steps (max ${MAX_STEPS})` };
    const size = Buffer.byteLength(canonical(raw), "utf8");
    if (size > MAX_BODY_BYTES)
        return { ok: false, error: `transcript too large (${size} bytes, max ${MAX_BODY_BYTES})` };
    const out = [];
    let prev = GENESIS;
    for (let i = 0; i < raw.length; i++) {
        const s = raw[i];
        if (!s || typeof s !== "object" || typeof s.type !== "string" || !TYPE_RE.test(s.type)) {
            return { ok: false, error: `step ${i}: missing/invalid type (1-32 chars, [a-z0-9_-])` };
        }
        const rec = { t: s.t ?? null, type: s.type.toLowerCase(), body: s.body ?? null, prev };
        const hash = sha256hex(canonical(rec));
        out.push({ i, type: rec.type, hash, prev });
        prev = hash;
    }
    return { ok: true, spec: "chaincheck-link-v1", steps: out, root: prev };
}
export const CHAIN_USAGE = {
    spec: "chaincheck-link-v1",
    step: "{ t: iso8601|null, type: 'criteria|delivery|test|verdict|...', body: any, prev: sha256(prev_step) }",
    rule: "hash_i = sha256(canonical_json({t,type,body,prev})); step_0.prev = 64 zeros; root = last hash",
    usage: "GET /api/chain?steps=<base64url JSON array> or POST /api/chain with JSON body array",
    anchor: "pay /api/attest?chain&tx to verify the root was committed on-chain; include root in the verdict doc",
};
