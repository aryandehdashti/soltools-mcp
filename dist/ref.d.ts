export declare const REF_PAYOUT_PCT = 20;
interface Sale {
    ts: string;
    ref: string;
    endpoint: string;
    network: string;
    amountUsd: number;
}
interface Payout {
    ts: string;
    code: string;
    amountUsd: number;
    method: string;
    receipt: string;
}
export declare function validRef(raw: unknown): string | null;
export declare function recordRefSale(code: string, endpoint: string, network: string, amountUsd: number): void;
export declare function recordPayout(code: string, amountUsd: number, method: string, receipt: string): void;
export declare function refStats(code: string): {
    code: string;
    payoutPercent: number;
    saleCount: number;
    attributedUsd: number;
    earnedUsd: number;
    paidUsd: number;
    pendingUsd: number;
    sales: Sale[];
    payouts: Payout[];
};
export declare function publicLog(): {
    program: string;
    note: string;
    sales: Sale[];
    payouts: Payout[];
};
export {};
