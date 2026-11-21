/**
 * EVM contract quick-check: is it a contract, what standard surface does it
 * expose, is it a proxy. Works on any chain we have an RPC for.
 */
export declare function inspectContract(chain: string, address: string): Promise<{
    error: string;
    chain: string;
    address: string;
    isContract?: undefined;
    note?: undefined;
    bytecodeBytes?: undefined;
    proxy?: undefined;
    erc20?: undefined;
    owner?: undefined;
    flags?: undefined;
} | {
    chain: string;
    address: string;
    isContract: boolean;
    note: string;
    error?: undefined;
    bytecodeBytes?: undefined;
    proxy?: undefined;
    erc20?: undefined;
    owner?: undefined;
    flags?: undefined;
} | {
    chain: string;
    address: string;
    isContract: boolean;
    bytecodeBytes: number;
    proxy: {
        type: string;
        implementation: string;
    } | null;
    erc20: {
        name: string | null;
        symbol: string | null;
        decimals: number | null;
        totalSupply: string | null;
    };
    owner: string | null;
    flags: {
        code: string;
        severity: string;
        detail: string;
    }[];
    error?: undefined;
    note?: undefined;
}>;
