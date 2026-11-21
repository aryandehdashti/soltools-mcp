/**
 * Payout attestation: verify a claimed payment tx on-chain and return a
 * structured verdict. Solana (USDC SPL) and Base (USDC ERC-20) supported.
 * No custody, no signing keys — the verdict is deterministic from chain data.
 */
export interface Transfer {
    asset: string;
    amountRaw: string;
    amountUsd: number;
    from: string | null;
    to: string | null;
}
export interface Attestation {
    issuer: string;
    issuedAt: string;
    chain: string;
    tx: string;
    found: boolean;
    confirmed: boolean;
    verdict: "settled" | "failed" | "not_found" | "no_relevant_transfer";
    blockTime: string | null;
    transfers: Transfer[];
    explorer: string;
    error?: string;
}
export declare function attestTx(chain: string, tx: string): Promise<Attestation>;
