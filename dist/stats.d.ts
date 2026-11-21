export declare function markChallenge(path: string): void;
export declare function markSettled(path: string, ref?: string | null): void;
export declare function statsSnapshot(): {
    uptime_sec: number;
    challenges: Record<string, number>;
    settled_calls: Record<string, number>;
    settled_total: number;
    settled_log: {
        at: string;
        route: string;
        ref?: string;
    }[];
    note: string;
};
