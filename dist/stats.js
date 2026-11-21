const started = Date.now();
const challenges = {};
const settled = {};
const settledLog = [];
export function markChallenge(path) {
    challenges[path] = (challenges[path] || 0) + 1;
}
export function markSettled(path, ref) {
    const r = ref ?? undefined;
    settled[path] = (settled[path] || 0) + 1;
    settledLog.push({ at: new Date().toISOString(), route: path, ref: r });
    if (settledLog.length > 500)
        settledLog.shift();
    console.log(`[SETTLED] ${path}${r ? ` ref=${r}` : ""}`);
}
export function statsSnapshot() {
    return {
        uptime_sec: Math.floor((Date.now() - started) / 1000),
        challenges,
        settled_calls: settled,
        settled_total: Object.values(settled).reduce((a, b) => a + b, 0),
        settled_log: settledLog.slice(-50),
        note: "settled_calls = requests that passed x402 payment (real paid usage). challenges = 402 responses issued.",
    };
}
