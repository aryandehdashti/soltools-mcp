/** Solana RPC + DexScreener helpers with small caches. */
export declare const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export declare function rpc(method: string, params: unknown[]): Promise<any>;
export declare function dexscreener(path: string): Promise<any>;
export declare function formatUsd(n: number): string;
export declare function shortAddr(a: string): string;
