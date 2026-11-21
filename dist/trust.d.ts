export declare function trustScore(handle: string | null, address: string | null): Promise<{
    issuer: string;
    queriedAt: string;
    handle: string | null;
    address: string | null;
    score: number;
    scoreMax: number;
    verdict: string;
    breakdown: {
        signal: string;
        points: number;
        detail: string;
    }[];
    signals: Record<string, unknown>;
    caveat: string;
}>;
