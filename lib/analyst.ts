import { yfQuoteSummary, yfQuote } from './yf';
import type { AnalystData } from './types';

const MODULES = [
  'price',
  'assetProfile',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'earningsHistory',
  'upgradeDowngradeHistory',
  'calendarEvents',
  'fundProfile',
];

function safeNum(val: unknown, divisor = 1, decimals = 2): number | null {
  try {
    if (val == null) return null;
    const n = Number(val);
    if (!isFinite(n)) return null;
    return (
      Math.round((n / divisor) * Math.pow(10, decimals)) /
      Math.pow(10, decimals)
    );
  } catch {
    return null;
  }
}

export async function fetchAnalystData(symbol: string): Promise<AnalystData> {
  let summary: Record<string, unknown> = {};

  try {
    summary = await yfQuoteSummary(symbol, MODULES);
  } catch (e) {
    console.error(`[fetchAnalystData] ${symbol}:`, e);
  }

  // Also get current price from quote endpoint as fallback
  const liveQuote = await yfQuote(symbol).catch(() => null);

  const price = (summary.price ?? {}) as Record<string, unknown>;
  const profile = (summary.assetProfile ?? {}) as Record<string, unknown>;
  const detail = (summary.summaryDetail ?? {}) as Record<string, unknown>;
  const stats = (summary.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const financial = (summary.financialData ?? {}) as Record<string, unknown>;
  const fundProfile = (summary.fundProfile ?? {}) as Record<string, unknown>;

  const quoteType = String(price.quoteType ?? '').toUpperCase();
  const isEquity = quoteType === 'EQUITY' || quoteType === '';

  const company: AnalystData['company'] = {
    name: String(price.longName ?? price.shortName ?? symbol),
    sector: String(profile.sector ?? ''),
    industry: String(profile.industry ?? ''),
    country: String(profile.country ?? ''),
    employees: safeNum(profile.fullTimeEmployees, 1, 0),
    description: String(profile.longBusinessSummary ?? ''),
    website: String(profile.website ?? ''),
    exchange: String(price.exchange ?? ''),
    quote_type: quoteType,
    category: String(fundProfile.category ?? ''),
    fund_family: String(fundProfile.fundFamily ?? ''),
    inception: String(fundProfile.fundInceptionDate ?? ''),
    total_assets: safeNum(detail.totalAssets, 1e9, 2),
    nav: safeNum(price.navPrice),
    ytd_return: safeNum(fundProfile.ytdReturn),
    three_yr: safeNum(fundProfile.threeYearAverageReturn),
    five_yr: safeNum(fundProfile.fiveYearAverageReturn),
    expense_ratio: safeNum(fundProfile.annualReportExpenseRatio),
  };

  const targetMean   = safeNum(financial.targetMeanPrice);
  const targetHigh   = safeNum(financial.targetHighPrice);
  const targetLow    = safeNum(financial.targetLowPrice);
  const targetMedian = safeNum(financial.targetMedianPrice);
  const currentPrice =
    safeNum(financial.currentPrice) ??
    safeNum(price.regularMarketPrice) ??
    liveQuote?.regularMarketPrice ??
    null;
  const upside =
    targetMean != null && currentPrice != null && currentPrice > 0
      ? Math.round(((targetMean - currentPrice) / currentPrice) * 1000) / 10
      : null;
  const recKey     = String(financial.recommendationKey ?? '');
  const recMean    = safeNum(financial.recommendationMean);
  const numAnalysts= safeNum(financial.numberOfAnalystOpinions, 1, 0);

  // ── Upgrades/Downgrades ──
  const udHistory = (summary.upgradeDowngradeHistory ?? {}) as {
    history?: Array<{
      epochGradeDate?: number;
      firm?: string;
      action?: string;
      toGrade?: string;
      fromGrade?: string;
    }>;
  };
  const upgrades = (udHistory.history ?? []).slice(0, 10).map(u => ({
    date: u.epochGradeDate
      ? new Date(u.epochGradeDate * 1000).toISOString().slice(0, 10)
      : '—',
    firm:   String(u.firm   ?? ''),
    action: String(u.action ?? ''),
    to:     String(u.toGrade   ?? ''),
    from:   String(u.fromGrade ?? ''),
  }));

  // ── Earnings history ──
  const ehRaw = (summary.earningsHistory ?? {}) as {
    history?: Array<{
      quarter?: { raw?: number };
      epsEstimate?: { raw?: number };
      epsActual?: { raw?: number };
      epsDifference?: { raw?: number };
      surprisePercent?: { raw?: number };
    }>;
  };
  const earnings = (ehRaw.history ?? []).slice(-8).map(e => ({
    date: e.quarter?.raw
      ? new Date(e.quarter.raw * 1000).toISOString().slice(0, 10)
      : '—',
    eps_estimate: safeNum(e.epsEstimate?.raw),
    eps_actual:   safeNum(e.epsActual?.raw),
    surprise:     safeNum(e.epsDifference?.raw),
    surprise_pct:
      e.surprisePercent?.raw != null
        ? Math.round(e.surprisePercent.raw * 1000) / 10
        : null,
  }));

  // ── Next earnings date ──
  let nextEarnings: string | null = null;
  try {
    const cal = (summary.calendarEvents ?? {}) as {
      earnings?: { earningsDate?: Array<{ raw?: number }> };
    };
    const d = cal.earnings?.earningsDate?.[0]?.raw;
    if (d) nextEarnings = new Date(d * 1000).toISOString().slice(0, 10);
  } catch {
    // ignore
  }

  const fundamentals: AnalystData['fundamentals'] = {
    market_cap:        safeNum(price.marketCap ?? detail.marketCap, 1e9, 2),
    pe_ratio:          safeNum(detail.trailingPE),
    forward_pe:        safeNum(stats.forwardPE),
    peg_ratio:         safeNum(stats.pegRatio),
    price_to_book:     safeNum(stats.priceToBook),
    price_to_sales:    safeNum(detail.priceToSalesTrailing12Months),
    ev_ebitda:         safeNum(stats.enterpriseToEbitda),
    debt_to_equity:    safeNum(financial.debtToEquity),
    current_ratio:     safeNum(financial.currentRatio),
    roe:               safeNum(financial.returnOnEquity),
    roa:               safeNum(financial.returnOnAssets),
    profit_margin:     safeNum(financial.profitMargins),
    revenue_growth:    safeNum(financial.revenueGrowth),
    earnings_growth:   safeNum(financial.earningsGrowth),
    dividend_yield:    safeNum(detail.dividendYield),
    beta:              safeNum(detail.beta ?? stats.beta),
    short_ratio:       safeNum(stats.shortRatio),
    shares_short_pct:  safeNum(stats.shortPercentOfFloat),
    eps_trailing:      safeNum(stats.trailingEps),
    eps_forward:       safeNum(stats.forwardEps),
    revenue_ttm:       safeNum(financial.totalRevenue, 1e9, 2),
    free_cashflow:     safeNum(financial.freeCashflow, 1e9, 2),
    gross_margins:     safeNum(financial.grossMargins),
    operating_margins: safeNum(financial.operatingMargins),
  };

  // Yahoo Finance v10 wraps many values in {raw, fmt} objects — unwrap them.
  function unwrap(obj: Record<string, unknown>) {
    for (const key of Object.keys(obj) as Array<keyof typeof obj>) {
      const v = obj[key];
      if (v && typeof v === 'object' && 'raw' in v) {
        (obj as Record<string, unknown>)[key] = (v as { raw: unknown }).raw;
      }
    }
  }
  unwrap(fundamentals as unknown as Record<string, unknown>);

  return {
    symbol,
    is_equity:  isEquity,
    quote_type: quoteType,
    company,
    fundamentals,
    analyst: {
      target_mean:   targetMean,
      target_high:   targetHigh,
      target_low:    targetLow,
      target_median: targetMedian,
      upside_pct:    upside,
      rec_key:       recKey,
      rec_mean:      recMean != null ? Math.round(recMean * 100) / 100 : null,
      num_analysts:  numAnalysts,
    },
    upgrades,
    earnings,
    next_earnings: nextEarnings,
    fetched_at: new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
    }),
    error: null,
  };
}
