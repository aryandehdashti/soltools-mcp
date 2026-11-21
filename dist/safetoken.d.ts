export interface TokenFlag {
    code: string;
    severity: "high" | "medium" | "info";
    detail: string;
}
export declare function scanToken(mint: string): Promise<{
    mint: string;
    found: boolean;
    flags: {
        code: string;
        severity: string;
        detail: string;
    }[];
    symbol?: undefined;
    supply?: undefined;
    decimals?: undefined;
    authorities?: undefined;
    concentration?: undefined;
    market?: undefined;
    verdict?: undefined;
} | {
    mint: string;
    found: boolean;
    symbol: any;
    supply: number | null;
    decimals: any;
    authorities: {
        mint: any;
        freeze: any;
        revoked: boolean;
    };
    concentration: {
        top1Pct: number | null;
        top10Pct: number | null;
        topHolders: (string | undefined)[];
    };
    market: {
        priceUsd: number | null;
        liquidityUsd: any;
        marketCapUsd: any;
        volume24hUsd: any;
        buys24h: any;
        sells24h: any;
        sellRatio: number | null;
        pairAddress: any;
        dex: any;
    };
    flags: TokenFlag[];
    verdict: string;
}>;
