export interface QuoteLeg {
    network: string | null;
    scheme: string | null;
    asset: string | null;
    payTo: string | null;
    amount: string | null;
}
export interface QuoteInfo extends QuoteLeg {
    legs: QuoteLeg[];
}
export interface ProbeResult {
    method: string;
    status: number | null;
    latency_ms: number;
    quote: QuoteInfo | null;
    allow?: string | null;
    retryAfter?: string | null;
    hints?: string[];
    prosePay?: string[];
    error?: string;
}
export interface Defect {
    code: string;
    detail: string;
}
export declare function verifyEndpoint(rawUrl: string): Promise<{
    url: string;
    payability: "payable" | "payable-conditional" | "documented" | "free" | "broken" | "throttled" | "error" | "unreachable";
    defects: Defect[];
    probes: ProbeResult[];
}>;
