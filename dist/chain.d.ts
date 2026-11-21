export interface ChainStep {
    type: string;
    t?: string;
    body?: unknown;
}
export declare function buildChain(raw: unknown): {
    ok: true;
    spec: string;
    steps: {
        i: number;
        type: string;
        hash: string;
        prev: string;
    }[];
    root: string;
} | {
    ok: false;
    error: string;
};
export declare const CHAIN_USAGE: {
    spec: string;
    step: string;
    rule: string;
    usage: string;
    anchor: string;
};
