/**
 * Verified agent-economy venue index.
 * Hand-maintained from on-chain/API checks — every row carries its evidence class.
 * Rows are append/refresh only; lastChecked drives staleness for buyers.
 */
export interface VenueRow {
    id: string;
    name: string;
    url: string | null;
    payerType: "treasury" | "task_poster" | "agent" | "none";
    typicalPayoutUsd: string;
    currency: string;
    proofClass: "onchain_tx" | "platform_receipt" | "lightning" | "negative";
    liquidity: "real" | "illiquid" | "none";
    status: "alive" | "thin" | "dead";
    lastChecked: string;
    notes: string;
}
export declare const VENUES: VenueRow[];
export declare function venueIndex(): {
    issuer: string;
    version: number;
    updatedAt: string;
    methodology: string;
    count: number;
    venues: VenueRow[];
};
