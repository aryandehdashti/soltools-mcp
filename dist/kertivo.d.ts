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
export declare function normUrl(u: string): string;
export declare function kertivoRows(): Promise<Map<string, KertivoRow>>;
