/**
 * Referral tracking: any agent can append ?ref=<handle> to a paid call.
 * On settlement we attribute the sale to that code and pay out a cut
 * (currently 20%) on a weekly cadence — the public log is the receipt.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

export const REF_PAYOUT_PCT = 20;

const LOG_PATH = process.env.REFLOG_PATH || "reflog.json";
const CODE_RE = /^[a-z0-9_-]{1,32}$/i;

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

interface RefLog {
  sales: Sale[];
  payouts: Payout[];
}

function load(): RefLog {
  try {
    if (existsSync(LOG_PATH)) return JSON.parse(readFileSync(LOG_PATH, "utf8")) as RefLog;
  } catch {}
  return { sales: [], payouts: [] };
}

function save(log: RefLog) {
  try {
    writeFileSync(LOG_PATH, JSON.stringify(log, null, 1));
  } catch {}
}

export function validRef(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toLowerCase();
  return CODE_RE.test(c) ? c : null;
}

export function recordRefSale(code: string, endpoint: string, network: string, amountUsd: number) {
  const log = load();
  log.sales.push({ ts: new Date().toISOString(), ref: code, endpoint, network, amountUsd });
  save(log);
}

export function recordPayout(code: string, amountUsd: number, method: string, receipt: string) {
  const log = load();
  log.payouts.push({ ts: new Date().toISOString(), code, amountUsd, method, receipt });
  save(log);
}

export function refStats(code: string) {
  const log = load();
  const sales = log.sales.filter((s) => s.ref === code);
  const payouts = log.payouts.filter((p) => p.code === code);
  const attributed = sales.reduce((s, x) => s + x.amountUsd, 0);
  const paid = payouts.reduce((s, p) => s + p.amountUsd, 0);
  return {
    code,
    payoutPercent: REF_PAYOUT_PCT,
    saleCount: sales.length,
    attributedUsd: attributed,
    earnedUsd: attributed * (REF_PAYOUT_PCT / 100),
    paidUsd: paid,
    pendingUsd: attributed * (REF_PAYOUT_PCT / 100) - paid,
    sales: sales.slice(-20),
    payouts,
  };
}

export function publicLog() {
  const log = load();
  return {
    program: "ref=" + REF_PAYOUT_PCT + "% weekly",
    note: "Append ?ref=<your-handle> to any paid soltools endpoint URL. Settled sales are attributed to your code; 20% paid out weekly via Lightning/USDC. This log is the public receipt.",
    sales: log.sales.slice(-50),
    payouts: log.payouts,
  };
}
