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
  allow?: string | null;
  hints?: string[];
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

// Heuristics for "the gate exists but input was missing" — the
// bare-path-400-masking-a-402 class (community tooling taxonomy).
const INPUT_GATED = /required property|missing required|ROUTE_INPUT|field.*required|required.*field|must have required|input.*invalid|INVALID_INPUT/i;

function inputGated(body: string, status: number | null): string | null {
  if (status !== 400 && status !== 422) return null;
  const m = body.slice(0, 4096).match(INPUT_GATED);
  return m ? m[0] : null;
}

// Heuristics for a resource-server descriptor (discovery doc, not a priced route).
function descriptorHints(body: string): string[] {
  const hints: string[] = [];
  try {
    const d = JSON.parse(body.slice(0, 65536)) as Record<string, unknown>;
    if (d.x402Version) hints.push("x402Version:" + String(d.x402Version));
    if (typeof d.service === "string") hints.push("service:" + d.service.slice(0, 60));
    if (typeof d.name === "string") hints.push("name:" + d.name.slice(0, 60));
    if (typeof d.method_required === "string") hints.push("method_required:" + d.method_required);
    if (Array.isArray(d.resources)) {
      for (const r of d.resources.slice(0, 3)) {
        const ro = r as Record<string, unknown>;
        const ru = ro?.resource ?? ro?.url ?? ro?.endpoint;
        const rm = typeof ro?.method === "string" && /^[A-Z]+$/.test(ro.method.toUpperCase()) ? ro.method.toUpperCase() + "|" : "";
        if (typeof ru === "string") hints.push((/^https?:\/\//.test(ru) ? "resource:" : "rel_resource:") + rm + ru);
      }
    }
    if (typeof d.endpoint === "string") hints.push((/^https?:\/\//.test(d.endpoint) ? "endpoint:" : "rel_resource:") + d.endpoint);
    if (Array.isArray(d.endpoints)) {
      for (const e of d.endpoints.slice(0, 3)) if (typeof e === "string") hints.push((/^https?:\/\//.test(e) ? "resource:" : "route:") + e);
    }
  } catch {
    // A body that looks like a descriptor but fails to parse is its own
    // probe-log entry — never let a documented/free verdict hide a parse miss.
    const t = body.trimStart().slice(0, 8192);
    if (t.startsWith("{") && /"(x402Version|resources|endpoints|accepts|payTo)"/.test(t)) hints.push("extraction_failed");
  }
  return hints;
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
        headers: { Accept: "application/json", "User-Agent": "soltools-verify/1.1" },
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
      const allow = resp.status === 405 ? resp.headers.get("allow") : null;
      const gated = inputGated(body, resp.status);
      const hints = gated ? [gated] : descriptorHints(body);
      return { method, status: resp.status, latency_ms: latency, quote, allow, hints };
    } catch (e) {
      return { method, status: null, latency_ms: Date.now() - start, quote: null, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { method, status: null, latency_ms: Date.now() - start, quote: null, error: "too many redirects" };
}

// Pick the next method to try given a 405 Allow header (skip OPTIONS/HEAD).
function allowMethod(allow: string | null | undefined, tried: Set<string>): string | null {
  if (!allow) return null;
  for (const m of allow.split(",").map((s) => s.trim().toUpperCase())) {
    if (["OPTIONS", "HEAD", "CONNECT", "TRACE"].includes(m)) continue;
    if (!tried.has(m)) return m;
  }
  return null;
}

export async function verifyEndpoint(rawUrl: string): Promise<{
  url: string;
  payability: "payable" | "payable-conditional" | "documented" | "free" | "broken" | "unreachable";
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
  const tried = new Set<string>(["GET"]);
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
  const payableFrom = (p: ProbeResult) =>
    defects.some((d) => ["bad_network", "no_payto", "no_asset", "unpriced"].includes(d.code)) ? "broken" : "payable";

  inspect(g);

  if (g.status === 402 && g.quote) {
    return { url: rawUrl, payability: payableFrom(g), defects, probes };
  }

  // GET 200 with descriptor hints → documented; probe listed resource URLs if any.
  if (g.status === 200 && g.hints && g.hints.length > 0) {
    if (g.hints.includes("extraction_failed")) {
      defects.push({ code: "extraction_failed", detail: "body looks like a descriptor doc but JSON.parse failed — probe the service's documented routes manually" });
    }
    const resTargets = g.hints
      .filter((h) => h.startsWith("resource:") || h.startsWith("endpoint:") || h.startsWith("rel_resource:"))
      .map((h) => {
        let spec = h.split(":").slice(1).join(":");
        let method = "GET";
        const mp = spec.match(/^([A-Z]+)\|/);
        if (mp) { method = mp[1]; spec = spec.slice(mp[0].length); }
        try {
          return { method, url: new URL(spec, url.toString()).toString() }; // resolve relative to the doc's own origin
        } catch {
          return null;
        }
      })
      .filter((u): u is { method: string; url: string } => u !== null);
    if (resTargets.length > 0) {
      const rt = resTargets[0];
      try {
        const ru2 = new URL(rt.url);
        if (!isPrivateHost(ru2.hostname) && ru2.toString() !== rawUrl) {
          probes.push(await probeOnce(ru2.toString(), rt.method));
          let rp = probes[probes.length - 1];
          // Declared method 405ed → fall back to GET on the resource.
          if (rp.status === 405) {
            probes.push(await probeOnce(ru2.toString(), "GET"));
            rp = probes[probes.length - 1];
          }
          inspect(rp);
          if (rp.status === 402 && rp.quote) {
            defects.push({ code: "descriptor_ok", detail: "discovery doc resolves to payable resource " + rt.url + " (" + rt.method + ")" });
            return { url: rawUrl, payability: payableFrom(rp), defects, probes };
          }
          if (rp.status === null) {
            defects.push({ code: "resource_unreachable", detail: "listed resource " + rt.url + " failed: " + (rp.error ?? "network error") });
          }
        }
      } catch { /* bad resource URL */ }
    }
    if (resTargets.length > 0) {
      defects.push({ code: "descriptor_doc", detail: "returns a resource-server descriptor (200), not a priced challenge — probe its listed resources directly" });
      return { url: rawUrl, payability: "documented", defects, probes };
    }
    // Descriptor without absolute resource URLs (e.g. relative routes):
    // fall through to POST on the same URL — many services gate POST only.
    defects.push({ code: "descriptor_get", detail: "GET returns a descriptor (200); checking documented method" });
  }

  // 405 → retry with Allow-listed method (never CORS's Access-Control-Allow-Methods).
  if (g.status === 405) {
    const m = allowMethod(g.allow, tried);
    if (m) {
      tried.add(m);
      probes.push(await probeOnce(rawUrl, m));
      const am = probes[probes.length - 1];
      inspect(am);
      if (am.status === 402 && am.quote) {
        defects.push({ code: "verb_mismatch", detail: "GET returned 405; payable on " + m });
        return { url: rawUrl, payability: payableFrom(am), defects, probes };
      }
    } else {
      defects.push({ code: "allow_missing", detail: "405 with no Allow header — RFC 9110 requires it; probe can't discover the method" });
    }
  }

  // Input-gated responses (400/422 naming a required field) → gate likely behind input.
  const gated = (g.hints ?? []).find((h) => INPUT_GATED.test(h));
  if (gated) {
    defects.push({ code: "input_gated", detail: "GET returned " + g.status + " naming required input (" + gated + ") — a 402 likely sits behind valid input" });
    return { url: rawUrl, payability: "payable-conditional", defects, probes };
  }

  // Fallback: POST probe.
  tried.add("POST");
  probes.push(await probeOnce(rawUrl, "POST"));
  const p = probes[probes.length - 1];
  inspect(p);
  if (p.status === 402 && p.quote) {
    defects.push({ code: "verb_mismatch", detail: "pays on POST, not GET" });
    return { url: rawUrl, payability: payableFrom(p), defects, probes };
  }
  const pgated = (p.hints ?? []).find((h) => INPUT_GATED.test(h));
  if (pgated) {
    defects.push({ code: "input_gated", detail: "POST returned " + p.status + " naming required input (" + pgated + ") — a 402 likely sits behind valid input" });
    return { url: rawUrl, payability: "payable-conditional", defects, probes };
  }
  if (g.status === 200 || p.status === 200) {
    defects.push({ code: "no_paywall", detail: "answered " + (g.status === 200 ? "GET" : "POST") + " 200 without payment — not an x402-paid route (or paywall leak if it should be paid)" });
    return { url: rawUrl, payability: "free", defects, probes };
  }
  defects.push({ code: "not_paywalled", detail: "GET " + g.status + ", POST " + p.status + " — no 402 on either verb" });
  return { url: rawUrl, payability: "broken", defects, probes };
}
