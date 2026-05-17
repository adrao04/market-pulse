/**
 * Minimal Yahoo Finance HTTP client — no npm dependency.
 * Handles crumb authentication and maps the raw API shapes
 * we actually need for stock fetching + analyst data.
 */

const Q1 = 'https://query1.finance.yahoo.com';
const Q2 = 'https://query2.finance.yahoo.com';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Module-level crumb cache — survives warm Lambda invocations.
interface CrumbCache {
  crumb: string;
  cookie: string;
  expiresAt: number;
}
let _crumbCache: CrumbCache | null = null;

async function getCrumb(): Promise<CrumbCache> {
  if (_crumbCache && Date.now() < _crumbCache.expiresAt) return _crumbCache;

  // Step 1 — get a Yahoo session cookie
  const cookieRes = await fetch(
    'https://fc.yahoo.com/v2/reader?brand=fp&locale=en-US&region=US&site=finance',
    { headers: BASE_HEADERS }
  );
  const rawCookie = cookieRes.headers.get('set-cookie') ?? '';
  // Keep just the first name=value pair
  const cookie = rawCookie.split(';')[0] ?? '';

  // Step 2 — exchange cookie for a crumb
  const crumbRes = await fetch(`${Q1}/v1/test/getcrumb`, {
    headers: { ...BASE_HEADERS, Cookie: cookie },
  });
  const crumb = (await crumbRes.text()).trim();

  _crumbCache = {
    crumb,
    cookie,
    expiresAt: Date.now() + 20 * 60 * 1000, // 20-minute TTL
  };
  return _crumbCache;
}

// ─── Type definitions for the data shapes we consume ──────────

export interface YFChartQuote {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface YFChartResult {
  regularMarketPrice: number | null;
  quotes: YFChartQuote[];
}

export interface YFQuote {
  regularMarketPrice: number | null;
  regularMarketOpen: number | null;
  regularMarketPreviousClose: number | null;
}

export type YFSummaryResult = Record<string, unknown>;

// ─── API methods ───────────────────────────────────────────────

export async function yfChart(symbol: string): Promise<YFChartResult> {
  const { crumb, cookie } = await getCrumb();
  const url = `${Q1}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&events=history&includePrePost=false&crumb=${encodeURIComponent(crumb)}`;
  const res = await fetch(url, { headers: { ...BASE_HEADERS, Cookie: cookie } });
  if (!res.ok) throw new Error(`Chart fetch failed: ${res.status}`);
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        meta?: { regularMarketPrice?: number };
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: (number | null)[];
            high?: (number | null)[];
            low?: (number | null)[];
            close?: (number | null)[];
            volume?: (number | null)[];
          }>;
        };
      }>;
      error?: { description?: string };
    };
  };

  if (json.chart?.error) throw new Error(json.chart.error.description ?? 'Chart error');
  const result = json.chart?.result?.[0];
  if (!result) throw new Error('No chart data');

  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const quotes: YFChartQuote[] = ts.map((t, i) => ({
    date: new Date(t * 1000),
    open: q.open?.[i] ?? null,
    high: q.high?.[i] ?? null,
    low: q.low?.[i] ?? null,
    close: q.close?.[i] ?? null,
    volume: q.volume?.[i] ?? null,
  }));

  return {
    regularMarketPrice: result.meta?.regularMarketPrice ?? null,
    quotes,
  };
}

export async function yfQuote(symbol: string): Promise<YFQuote | null> {
  try {
    const { crumb, cookie } = await getCrumb();
    const url = `${Q1}/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, {
      headers: { ...BASE_HEADERS, Cookie: cookie },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      quoteResponse?: {
        result?: Array<{
          regularMarketPrice?: number;
          regularMarketOpen?: number;
          regularMarketPreviousClose?: number;
        }>;
      };
    };
    const r = json.quoteResponse?.result?.[0];
    if (!r) return null;
    return {
      regularMarketPrice: r.regularMarketPrice ?? null,
      regularMarketOpen: r.regularMarketOpen ?? null,
      regularMarketPreviousClose: r.regularMarketPreviousClose ?? null,
    };
  } catch {
    return null;
  }
}

export async function yfQuoteSummary(
  symbol: string,
  modules: string[]
): Promise<YFSummaryResult> {
  const { crumb, cookie } = await getCrumb();
  const modsParam = modules.join(',');
  const url = `${Q2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modsParam}&crumb=${encodeURIComponent(crumb)}&corsDomain=finance.yahoo.com`;
  const res = await fetch(url, {
    headers: { ...BASE_HEADERS, Cookie: cookie },
  });
  if (!res.ok) throw new Error(`QuoteSummary fetch failed: ${res.status}`);
  const json = (await res.json()) as {
    quoteSummary?: { result?: YFSummaryResult[] };
  };
  return json.quoteSummary?.result?.[0] ?? {};
}
