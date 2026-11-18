export interface QuoteInfo {
  network: string | null;
  scheme: string | null;
  asset: string | null;
  payTo: string | null;
  amount: string | null;
}

export interface ProbeResult {
  method: string;
  status: number | null;
  latency_ms: number;
  quote: QuoteInfo | null;
  error?: string;
}

export interface Defect {
  code: string;
  detail: string;
}

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?|\[?fe80|\[?f[cd]|\[?::\]?$)/i;

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST.test(hostname);
}

function parseQuote(resp: Response, body: string): QuoteInfo | null {
  const hdr = resp.headers.get("PAYMENT-REQUIRED") ?? resp.headers.get("X-PAYMENT-REQUIRED");
  let doc: unknown = null;
  if (hdr) {
    try {
      doc = JSON.parse(Buffer.from(hdr, "base64").toString("utf8"));
    } catch {
      try {
        doc = JSON.parse(hdr);
      } catch {
        return null;
      }
    }
  } else {
    try {
      doc = JSON.parse(body);
    } catch {
      return null;
    }
  }
  const accepts = (doc as { accepts?: unknown[] })?.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) return null;
  const a = accepts[0] as Record<string, unknown>;
  return {
    network: (a.network as string) ?? null,
    scheme: (a.scheme as string) ?? null,
    asset: (a.asset as string) ?? null,
    payTo: (a.payTo as string) ?? null,
    amount: (a.amount as string) ?? ((a.maxAmountRequired as string) ?? null),
  };
}

async function probeOnce(url: string, method: string): Promise<ProbeResult> {
  const start = Date.now();
  let current = url;
  // Follow redirects manually so each hop's host is re-validated.
  for (let hop = 0; hop < 4; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const resp = await fetch(current, {
        method,
        signal: ctrl.signal,
        headers: { Accept: "application/json", "User-Agent": "soltools-verify/1.0" },
        redirect: "manual",
      });
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get("location");
        if (!loc) return { method, status: resp.status, latency_ms: Date.now() - start, quote: null };
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          return { method, status: resp.status, latency_ms: Date.now() - start, quote: null, error: "bad redirect location" };
        }
        if (!/^https?:$/.test(next.protocol) || isPrivateHost(next.hostname)) {
          return { method, status: resp.status, latency_ms: Date.now() - start, quote: null, error: "redirect to disallowed host refused" };
        }
        current = next.toString();
        continue;
      }
      const body = await resp.text();
      const latency = Date.now() - start;
      const quote = resp.status === 402 ? parseQuote(resp, body.slice(0, 8192)) : null;
      return { method, status: resp.status, latency_ms: latency, quote };
    } catch (e) {
      return { method, status: null, latency_ms: Date.now() - start, quote: null, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { method, status: null, latency_ms: Date.now() - start, quote: null, error: "too many redirects" };
}

export async function verifyEndpoint(rawUrl: string): Promise<{
  url: string;
  payability: "payable" | "free" | "broken" | "unreachable";
  defects: Defect[];
  probes: ProbeResult[];
}> {
  const defects: Defect[] = [];
  let url: URL;
  try {
    url = new URL(rawUrl);
    if (!/^https?:$/.test(url.protocol)) throw new Error("scheme");
  } catch {
    defects.push({ code: "bad_url", detail: "not a valid http(s) URL" });
    return { url: rawUrl, payability: "broken", defects, probes: [] };
  }
  if (isPrivateHost(url.hostname)) {
    defects.push({ code: "refused", detail: "private/loopback addresses are not probed" });
    return { url: rawUrl, payability: "broken", defects, probes: [] };
  }

  const probes: ProbeResult[] = [];
  probes.push(await probeOnce(rawUrl, "GET"));
  const g = probes[0];
  if (g.status === null) {
    defects.push({ code: "unreachable", detail: "GET failed: " + (g.error ?? "network error") });
    return { url: rawUrl, payability: "unreachable", defects, probes };
  }

  const inspect = (p: ProbeResult) => {
    if (p.status === 402 && !p.quote)
      defects.push({ code: "malformed_402", detail: p.method + " returned 402 but no parseable payment requirements (PAYMENT-REQUIRED header or JSON body)" });
    if (p.quote) {
      if (!p.quote.network || !/^\w+:\w+/.test(p.quote.network))
        defects.push({ code: "bad_network", detail: p.method + " quote network missing or not CAIP-2 style: " + p.quote.network });
      if (!p.quote.payTo) defects.push({ code: "no_payto", detail: p.method + " quote has no payTo" });
      if (!p.quote.asset) defects.push({ code: "no_asset", detail: p.method + " quote has no asset" });
      if (!p.quote.amount || !/^\d+$/.test(p.quote.amount))
        defects.push({ code: "unpriced", detail: p.method + " quote amount missing or not base units: " + p.quote.amount });
    }
  };
  inspect(g);

  if (g.status === 402 && g.quote) {
    return { url: rawUrl, payability: defects.some((d) => ["bad_network", "no_payto", "no_asset", "unpriced"].includes(d.code)) ? "broken" : "payable", defects, probes };
  }

  probes.push(await probeOnce(rawUrl, "POST"));
  const p = probes[1];
  inspect(p);
  if (p.status === 402 && p.quote) {
    defects.push({ code: "verb_mismatch", detail: "pays on POST, not GET" });
    return { url: rawUrl, payability: "payable", defects, probes };
  }
  if (g.status === 200 || p.status === 200) {
    defects.push({ code: "no_paywall", detail: "answered " + (g.status === 200 ? "GET" : "POST") + " 200 without payment — not an x402-paid route (or paywall leak if it should be paid)" });
    return { url: rawUrl, payability: "free", defects, probes };
  }
  defects.push({ code: "not_paywalled", detail: "GET " + g.status + ", POST " + p.status + " — no 402 on either verb" });
  return { url: rawUrl, payability: "broken", defects, probes };
}
