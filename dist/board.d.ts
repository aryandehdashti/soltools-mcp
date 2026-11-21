/**
 * Settle Board — public report card for x402/agent-pay endpoints.
 * Re-probes a curated watchlist on a timer; serves the last snapshot as HTML
 * (/board) and JSON (/api/board.json). Challenge-level only: we never pay, so
 * "payable" means the 402 and its requirements are structurally sound — NOT
 * that a settlement was observed. That distinction is the product.
 */
import { type Defect } from "./verify.js";
import { type KertivoRow } from "./kertivo.js";
export interface WatchEntry {
    id: string;
    name: string;
    url: string;
    note?: string;
}
export declare const WATCHLIST: WatchEntry[];
export type BoardVerdict = "payable" | "payable-conditional" | "documented" | "free" | "broken" | "throttled" | "error" | "unreachable";
export interface BoardRow {
    id: string;
    name: string;
    url: string;
    note?: string;
    verdict: BoardVerdict;
    prevVerdict: BoardVerdict | null;
    verdictChangedAt: string | null;
    defects: Defect[];
    probes: {
        method: string;
        status: number | null;
        latency_ms: number;
    }[];
    price: string | null;
    network: string | null;
    networks: string[];
    asset: string | null;
    probedAt: string;
    kertivo: KertivoRow | null;
    missStreak: number;
}
export interface BoardSnapshot {
    generatedAt: string;
    probeSeconds: number;
    methodology: string;
    summary: Record<BoardVerdict, number>;
    rows: BoardRow[];
}
export declare function refreshBoard(): Promise<BoardSnapshot>;
export declare function getBoard(): BoardSnapshot | null;
export declare function startBoardLoop(): void;
export declare function renderBoard(b: BoardSnapshot): string;
