'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { signOut } from 'next-auth/react';
import type { StockData, AnalystData, AppState } from '@/lib/types';

// ─── Helpers ───────────────────────────────────────────────────
const fmt = (n: number | null | undefined, d = 2) =>
  n != null ? (+n).toFixed(d) : '—';
const fmtPct = (n: number | null | undefined) =>
  n != null ? fmt(n * 100, 1) + '%' : '—';
const sign = (n: number) => (n >= 0 ? '+' : '');

function pillClass(sig: string) {
  const s = sig.toLowerCase();
  if (s.includes('rsi')) return 'pill-rsi';
  if (s.includes('vol')) return 'pill-vol';
  if (s.includes('bollinger')) return 'pill-bb';
  if (s.includes('200') || s.includes('ma') || s.includes('50'))
    return 'pill-ma';
  return '';
}
function rsiColor(r: number | null) {
  if (!r) return '';
  if (r < 35 || r > 70) return 'danger';
  if (r < 45 || r > 60) return 'warn';
  return 'ok';
}

// ─── Tooltip glossary ─────────────────────────────────────────
const GLOSSARY: Record<
  string,
  { term: string; def: string; signal?: string }
> = {
  rsi: {
    term: 'RSI 14 — Relative Strength Index',
    def: 'Measures the speed and magnitude of recent price changes on a 0–100 scale. Calculated over the last 14 trading days.',
    signal: '< 35 = Oversold (buy signal) · > 70 = Overbought (sell signal) · 45–55 = Neutral',
  },
  macd: {
    term: 'MACD — Moving Avg Convergence/Divergence',
    def: 'The difference between the 12-day EMA and 26-day EMA. The histogram shows MACD minus its 9-day signal line.',
    signal: 'Histogram crosses 0 from below = Bullish · Crosses from above = Bearish',
  },
  bb: {
    term: 'BB Position — Bollinger Band %',
    def: 'Where the current price sits within the Bollinger Bands (20-day MA ± 2 standard deviations). 0% = lower band, 100% = upper band.',
    signal: '< 15% = Near lower band (buy signal) · > 85% = Near upper band (sell signal)',
  },
  ma50: {
    term: 'MA 50 — 50-Day Moving Average',
    def: 'The average closing price over the last 50 trading days. A widely-watched short-to-medium term trend indicator.',
    signal: 'Price above MA50 = short-term uptrend · Price below = short-term downtrend',
  },
  ma200: {
    term: 'MA 200 — 200-Day Moving Average',
    def: 'The average closing price over the last 200 trading days. The most-watched long-term trend indicator used by institutions.',
    signal: 'Price above MA200 = long-term uptrend · Price below = long-term downtrend (bear territory)',
  },
  vol_ratio: {
    term: 'Volume Ratio',
    def: "Today's trading volume divided by the 20-day average volume. Shows whether today's activity is unusual.",
    signal: '> 2× on a down day = heavy selling (possible capitulation buy) · > 2× on a big up day = possible distribution (sell signal)',
  },
  w52h: {
    term: '52-Week High',
    def: 'The highest price the stock has traded at over the past 52 weeks (one year).',
    signal: 'Price within 3% of this level may trigger a sell signal — approaching resistance',
  },
  w52l: {
    term: '52-Week Low',
    def: 'The lowest price the stock has traded at over the past 52 weeks (one year).',
    signal: 'Price within 5% of this level may trigger a buy signal — potential value zone',
  },
  dip30: {
    term: '30-Day Dip',
    def: 'How far the current price has fallen from the highest point in the last 30 trading days. Negative = below recent peak.',
    signal: '≤ −5% = Potential dip buying opportunity',
  },
  mktcap: { term: 'Market Capitalisation', def: 'Total market value of all outstanding shares. Price × Shares outstanding. Shown in billions ($B).', signal: 'Large cap > $10B · Mid cap $2–10B · Small cap < $2B' },
  pe: { term: 'P/E Ratio — Price to Earnings (Trailing)', def: "Stock price divided by earnings per share over the last 12 months. Tells you how much you're paying per $1 of profit.", signal: 'Lower P/E = cheaper relative to earnings. Compare to sector peers and historical average.' },
  fwd_pe: { term: 'Forward P/E', def: "Stock price divided by next 12 months' estimated earnings. More forward-looking than trailing P/E.", signal: 'Forward P/E < trailing P/E = earnings expected to grow' },
  peg: { term: 'PEG Ratio — Price/Earnings to Growth', def: 'P/E ratio divided by the earnings growth rate. Adjusts valuation for growth speed.', signal: '< 1 = potentially undervalued for its growth · > 2 = expensive relative to growth' },
  pb: { term: 'Price / Book', def: 'Stock price divided by book value per share (assets minus liabilities). Shows what you pay vs what the company owns.', signal: '< 1 = trading below book value (potentially undervalued) · Very high = market pricing in strong growth expectations' },
  ps: { term: 'Price / Sales (TTM)', def: 'Stock price divided by revenue per share over the last 12 months. Useful for companies with no earnings yet.', signal: 'Lower is cheaper. Varies widely by industry — compare within sector.' },
  ev_ebitda: { term: 'EV / EBITDA', def: 'Enterprise Value divided by Earnings Before Interest, Tax, Depreciation & Amortisation. A capital-structure-neutral valuation multiple.', signal: 'Lower = cheaper. More meaningful than P/E for capital-heavy businesses. < 10 often considered reasonable.' },
  eps: { term: 'EPS — Earnings Per Share (TTM)', def: 'Net profit divided by shares outstanding, over the trailing twelve months. The most fundamental measure of profitability per share.', signal: 'Positive and growing EPS is a healthy sign. Negative = company is losing money.' },
  fwd_eps: { term: 'Forward EPS', def: 'Analyst consensus estimate of earnings per share for the next 12 months.', signal: 'Higher than trailing EPS = earnings growth expected' },
  gross_margin: { term: 'Gross Margin', def: 'Revenue minus cost of goods sold, divided by revenue. Shows profitability before operating expenses.', signal: 'Higher is better. Software/pharma typically > 60%. Retail/hardware typically < 40%.' },
  op_margin: { term: 'Operating Margin', def: 'Operating income divided by revenue. Measures efficiency after paying operating costs but before interest and taxes.', signal: 'Consistently > 15% = strong operational efficiency' },
  net_margin: { term: 'Net Profit Margin', def: 'Net income divided by revenue. The bottom-line profitability after all costs, taxes, and interest.', signal: 'Higher is better. Anything above 10% is generally solid.' },
  roe: { term: 'ROE — Return on Equity', def: "Net income divided by shareholders' equity. Measures how efficiently management uses equity capital to generate profit.", signal: '> 15% = strong capital efficiency · Warren Buffett looks for > 20% consistently' },
  roa: { term: 'ROA — Return on Assets', def: 'Net income divided by total assets. Shows how efficiently the company uses its assets to generate earnings.', signal: '> 5% is generally considered good. > 10% is excellent.' },
  rev_growth: { term: 'Revenue Growth (YoY)', def: 'Year-over-year percentage change in total revenue. A key indicator of business expansion.', signal: '> 10% = healthy growth for established companies · > 20% = high-growth phase' },
  earn_growth: { term: 'Earnings Growth (YoY)', def: 'Year-over-year percentage change in earnings. Ideally should outpace revenue growth, signalling efficiency improvements.', signal: 'Positive and accelerating = strong momentum. Declining = potential red flag.' },
  de: { term: 'Debt / Equity', def: "Total debt divided by shareholders' equity. Measures financial leverage and how much the company relies on borrowing.", signal: '< 1 = conservative · 1–2 = moderate · > 2 = highly leveraged (higher risk)' },
  beta: { term: 'Beta', def: 'Measures how much the stock moves relative to the overall market (S&P 500). Calculated over 5 years monthly.', signal: 'β = 1 = moves with market · β > 1 = more volatile · β < 1 = less volatile · β < 0 = moves inversely (e.g. gold)' },
  div_yield: { term: 'Dividend Yield', def: 'Annual dividends per share divided by the current stock price. Income returned to shareholders as a percentage.', signal: '2–4% = moderate income · > 5% = high yield (check sustainability) · 0% = growth company reinvesting profits' },
  short_pct: { term: 'Short % of Float', def: 'Percentage of shares available for trading that are currently sold short. High short interest means many investors are betting the price will fall.', signal: '> 10% = elevated short interest, possible short squeeze risk or bearish sentiment · > 20% = heavily shorted' },
  revenue: { term: 'Revenue TTM', def: 'Total revenue (sales) generated over the trailing twelve months. The top-line figure before any costs are deducted.', signal: 'Track growth quarter-over-quarter and year-over-year for momentum.' },
  fcf: { term: 'Free Cash Flow', def: 'Operating cash flow minus capital expenditures. The actual cash the business generates after maintaining/growing its asset base.', signal: 'Positive and growing FCF = financial strength. Many value investors consider FCF the truest measure of profitability.' },
};

// ─── Tooltip component ────────────────────────────────────────
function Tooltip() {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [entry, setEntry] = useState<{
    term: string;
    def: string;
    signal?: string;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onOver(e: MouseEvent) {
      const el = (e.target as Element).closest<HTMLElement>('[data-tt]');
      if (!el?.dataset.tt) return;
      const g = GLOSSARY[el.dataset.tt];
      if (!g) return;
      const rect = el.getBoundingClientRect();
      const tipW = 260;
      let left = rect.left + rect.width / 2 - tipW / 2;
      const top = rect.bottom + 8 + window.scrollY;
      left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
      setEntry(g);
      setPos({ left, top });
      if (timerRef.current) clearTimeout(timerRef.current);
      setVisible(true);
    }
    function onOut(e: MouseEvent) {
      if ((e.target as Element).closest('[data-tt]')) {
        timerRef.current = setTimeout(() => setVisible(false), 120);
      }
    }
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
    };
  }, []);

  if (!entry) return null;
  return (
    <div
      id="tooltip"
      className={visible ? 'visible' : ''}
      style={{ left: pos.left, top: pos.top, width: 260 }}
    >
      <div className="tt-term">{entry.term}</div>
      <div className="tt-def">{entry.def}</div>
      {entry.signal && <div className="tt-signal">{entry.signal}</div>}
    </div>
  );
}

// ─── Stock Card ───────────────────────────────────────────────
function StockCard({
  s,
  onRemove,
  onOpenDetail,
}: {
  s: StockData;
  onRemove: (sym: string) => void;
  onOpenDetail: (sym: string) => void;
}) {
  if (s.error) {
    return (
      <div className="card err-card" onClick={() => onOpenDetail(s.symbol)}>
        <div className="card-head">
          <span className="sym">{s.symbol}</span>
          <div className="card-tags">
            <button
              className="remove-btn"
              onClick={e => { e.stopPropagation(); onRemove(s.symbol); }}
              title="Remove"
            >
              ✕
            </button>
          </div>
        </div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: 'var(--red)', marginTop: 8 }}>
          ⚠ {s.error}
        </div>
      </div>
    );
  }

  const up = s.change_pct >= 0;
  const cls =
    s.has_buy && s.has_sell ? 'has-buy has-sell'
    : s.has_buy ? 'has-buy'
    : s.has_sell ? 'has-sell'
    : up ? 'up' : 'down';

  const bbPct =
    s.bb_upper != null && s.bb_lower != null
      ? Math.round(((s.price - s.bb_lower) / (s.bb_upper - s.bb_lower)) * 100)
      : null;

  const rsiPct = s.rsi != null ? Math.min(s.rsi, 100) : 0;
  const rsiCol =
    s.rsi != null
      ? s.rsi < 35 || s.rsi > 70 ? 'var(--red)'
        : s.rsi < 45 || s.rsi > 60 ? 'var(--amber)'
        : 'var(--green)'
      : 'var(--muted)';

  return (
    <div className={`card ${cls}`} onClick={() => onOpenDetail(s.symbol)}>
      <div className="card-head">
        <span className="sym">{s.symbol}</span>
        <div className="card-tags">
          {s.has_buy && <span className="tag tag-buy">BUY</span>}
          {s.has_sell && <span className="tag tag-sell">SELL</span>}
          <button
            className="remove-btn"
            onClick={e => { e.stopPropagation(); onRemove(s.symbol); }}
            title="Remove"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="price-row">
        <span className="price">${fmt(s.price)}</span>
        <span className={`chg ${up ? 'pos' : 'neg'}`}>
          {sign(s.change_pct)}{fmt(s.change_pct)}%
        </span>
      </div>
      <div className="sub">
        {sign(s.change)}${fmt(Math.abs(s.change))} today · open ${fmt(s.open)} · {s.updated_at}
      </div>

      <div className="meta">
        <div className="mi">
          <span className="mk tt" data-tt="rsi">RSI 14</span>
          <span className={`mv ${rsiColor(s.rsi)}`}>{s.rsi ?? '—'}</span>
          <div className="rsi-track">
            <div className="rsi-fill" style={{ width: `${rsiPct}%`, background: rsiCol }} />
          </div>
        </div>
        <div className="mi">
          <span className="mk tt" data-tt="macd">MACD</span>
          <span className="mv">
            {s.macd_hist != null && (
              <span className="macd-dot" style={{ background: s.macd_hist >= 0 ? 'var(--green)' : 'var(--red)' }} />
            )}
            {s.macd_hist != null ? fmt(s.macd_hist, 3) : '—'}
          </span>
        </div>
        <div className="mi">
          <span className="mk tt" data-tt="bb">BB pos</span>
          <span className={`mv ${bbPct != null && (bbPct < 15 || bbPct > 85) ? 'warn' : ''}`}>
            {bbPct != null ? `${bbPct}%` : '—'}
          </span>
        </div>
        <div className="mi">
          <span className="mk tt" data-tt="ma50">MA 50</span>
          <span className="mv">{s.ma50 ? `$${fmt(s.ma50)}` : '—'}</span>
        </div>
        <div className="mi">
          <span className="mk tt" data-tt="ma200">MA 200</span>
          <span className={`mv ${s.ma200 != null && s.price < s.ma200 ? 'warn' : ''}`}>
            {s.ma200 ? `$${fmt(s.ma200)}` : '—'}
          </span>
        </div>
        <div className="mi">
          <span className="mk tt" data-tt="vol_ratio">Vol ratio</span>
          <span className={`mv ${(s.vol_ratio ?? 0) >= 2 ? 'warn' : ''}`}>
            {s.vol_ratio ?? '—'}×
          </span>
        </div>
        <div className="mi">
          <span className="mk tt" data-tt="w52h">52W High</span>
          <span className="mv">${fmt(s.week_52_high)}</span>
        </div>
        <div className="mi">
          <span className="mk tt" data-tt="w52l">52W Low</span>
          <span className="mv">${fmt(s.week_52_low)}</span>
        </div>
        <div className="mi">
          <span className="mk tt" data-tt="dip30">30d dip</span>
          <span className={`mv ${s.dip_30d <= -5 ? 'warn' : ''}`}>
            {sign(s.dip_30d)}{fmt(s.dip_30d)}%
          </span>
        </div>
      </div>

      {(s.buy_signals.length > 0 || s.sell_signals.length > 0) && (
        <div className="signals-wrap">
          {s.buy_signals.length > 0 && (
            <div>
              <div className="sig-lbl">Buy signals</div>
              <div className="sig-row">
                {s.buy_signals.map((sig, i) => (
                  <span key={i} className={`pill pill-buy ${pillClass(sig)}`}>{sig}</span>
                ))}
              </div>
            </div>
          )}
          {s.sell_signals.length > 0 && (
            <div>
              <div className="sig-lbl">Sell signals</div>
              <div className="sig-row">
                {s.sell_signals.map((sig, i) => (
                  <span key={i} className={`pill pill-sell ${pillClass(sig)}`}>{sig}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="hint">Click for analyst deep-dive →</div>
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────
function recPillClass(key: string) {
  const k = (key || '').toLowerCase().replace(/[_\s]/g, '-');
  if (k.includes('strong-buy')) return 'rec-strong-buy';
  if (k.includes('buy')) return 'rec-buy';
  if (k.includes('hold')) return 'rec-hold';
  if (k.includes('underperform') || k.includes('strong-sell')) return 'rec-underperform';
  if (k.includes('sell')) return 'rec-sell';
  return 'rec-hold';
}
function recLabel(key: string) {
  const map: Record<string, string> = {
    strong_buy: 'Strong Buy', buy: 'Buy', hold: 'Hold',
    sell: 'Sell', underperform: 'Underperform', strong_sell: 'Strong Sell',
  };
  return map[key] || key || '—';
}
function actionClass(action: string) {
  const a = (action || '').toLowerCase();
  if (a === 'upgrade') return 'grade-up';
  if (a === 'downgrade') return 'grade-down';
  if (a === 'init' || a === 'initiated') return 'grade-init';
  return 'grade-maint';
}

function DetailModal({
  symbol,
  stock,
  onClose,
}: {
  symbol: string;
  stock: StockData | undefined;
  onClose: () => void;
}) {
  const [data, setData] = useState<AnalystData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    setDescExpanded(false);
    fetch(`/api/detail/${symbol}`)
      .then(r => r.json())
      .then((d: AnalystData) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(e => setError(String(e)));
  }, [symbol]);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  const co = data?.company;
  const an = data?.analyst;
  const fu = data?.fundamentals;
  const up = (stock?.change_pct ?? 0) >= 0;
  const isEquity = data?.is_equity !== false;
  const qtype = (data?.quote_type ?? '').toUpperCase();
  const isETF = qtype === 'ETF' || qtype === 'MUTUALFUND';

  function downloadReport() {
    if (!data || !stock) return;
    const now = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
    const pct = (v: number | null | undefined) => v != null ? (v * 100).toFixed(1) + '%' : 'N/A';
    const usd = (v: number | null | undefined, d = 2) => v != null ? '$' + (+v).toFixed(d) : 'N/A';
    const num = (v: number | null | undefined, d = 2) => v != null ? (+v).toFixed(d) : 'N/A';

    const buySignals = (stock.buy_signals || []).length
      ? stock.buy_signals.map(s => `- 🟢 ${s}`).join('\n')
      : '- None currently active';
    const sellSignals = (stock.sell_signals || []).length
      ? stock.sell_signals.map(s => `- 🔴 ${s}`).join('\n')
      : '- None currently active';

    const report = `# ${symbol} — Investment Research Report
**Generated:** ${now}
**Data source:** Yahoo Finance via Market Pulse

---

## Company Overview
| Field | Value |
|-------|-------|
| Name | ${co?.name ?? symbol} |
| Sector | ${co?.sector || 'N/A'} |
| Industry | ${co?.industry || 'N/A'} |
| Exchange | ${co?.exchange || 'N/A'} |
${data?.next_earnings ? `| Next Earnings | ${data.next_earnings} |` : ''}

${co?.description ? `### Business Description\n\n${co.description}` : ''}

---

## Technical Snapshot
| Metric | Value |
|--------|-------|
| Current Price | ${usd(stock.price)} |
| Day Change | ${sign(stock.change_pct)}${fmt(stock.change_pct)}% |
| RSI (14-day) | ${stock.rsi ?? 'N/A'} |
| MACD Histogram | ${stock.macd_hist ?? 'N/A'} |
| MA 50 | ${usd(stock.ma50)} |
| MA 200 | ${usd(stock.ma200)} |
| 52-Week High | ${usd(stock.week_52_high)} |
| 52-Week Low | ${usd(stock.week_52_low)} |
| Volume Ratio | ${stock.vol_ratio != null ? stock.vol_ratio + 'x' : 'N/A'} |

### Active Buy Signals
${buySignals}

### Active Sell Signals
${sellSignals}

---

## Analyst Consensus
| Metric | Value |
|--------|-------|
| Recommendation | ${an?.rec_key ? recLabel(an.rec_key) : 'N/A'} |
| Mean Target | ${usd(an?.target_mean)} |
| High Target | ${usd(an?.target_high)} |
| Low Target | ${usd(an?.target_low)} |
| Implied Upside | ${an?.upside_pct != null ? (an.upside_pct > 0 ? '+' : '') + an.upside_pct + '%' : 'N/A'} |
| # Analysts | ${an?.num_analysts ?? 'N/A'} |

---

## Fundamentals
| Metric | Value |
|--------|-------|
| Market Cap | ${fu?.market_cap != null ? usd(fu.market_cap) + 'B' : 'N/A'} |
| P/E (Trailing) | ${num(fu?.pe_ratio)} |
| P/E (Forward) | ${num(fu?.forward_pe)} |
| PEG Ratio | ${num(fu?.peg_ratio)} |
| Price/Book | ${num(fu?.price_to_book)} |
| EV/EBITDA | ${num(fu?.ev_ebitda)} |
| Gross Margin | ${pct(fu?.gross_margins)} |
| Operating Margin | ${pct(fu?.operating_margins)} |
| Net Margin | ${pct(fu?.profit_margin)} |
| ROE | ${pct(fu?.roe)} |
| Revenue Growth | ${pct(fu?.revenue_growth)} |
| Debt/Equity | ${num(fu?.debt_to_equity)} |
| Beta | ${num(fu?.beta)} |
| Dividend Yield | ${pct(fu?.dividend_yield)} |

---
_Not financial advice · Data via Yahoo Finance · ${now}_
`;
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${symbol}_report_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="overlay" onClick={handleOverlayClick}>
      <div className="modal">
        {!data && !error && (
          <div className="modal-loading">
            <span className="spin-teal" />
            <span>Loading analyst data…</span>
          </div>
        )}
        {error && (
          <div className="modal-loading" style={{ color: 'var(--red)' }}>
            ⚠ {error}
          </div>
        )}
        {data && (
          <>
            <div className="modal-header">
              <div className="modal-title">
                <div className="modal-sym">{symbol}</div>
                <div className="modal-name">{co?.name ?? symbol}</div>
                <div className="modal-sector">
                  {!isEquity && (
                    <span className="badge" style={{ color: 'var(--purple)', borderColor: 'rgba(155,141,255,.4)' }}>
                      {qtype || 'FUND'}
                    </span>
                  )}
                  {co?.sector && <span className="badge">{co.sector}</span>}
                  {co?.industry && <span className="badge">{co.industry}</span>}
                  {co?.exchange && <span className="badge">{co.exchange}</span>}
                  {co?.country && <span className="badge">{co.country}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(31,214,124,.1)', borderColor: 'rgba(31,214,124,.3)', color: 'var(--green)' }}
                  onClick={downloadReport}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M6.5 1v7M3.5 5.5l3 3 3-3M1.5 10.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Download Report
                </button>
                <button className="modal-close" onClick={onClose}>✕</button>
              </div>
            </div>

            <div className="modal-price-bar">
              <span className="modal-price">${fmt(stock?.price)}</span>
              <span className={`chg ${up ? 'pos' : 'neg'}`} style={{ fontSize: 14 }}>
                {sign(stock?.change_pct ?? 0)}{fmt(stock?.change_pct)}%
              </span>
              {data.next_earnings && (
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: 'var(--amber)' }}>
                  📅 Next earnings: {data.next_earnings}
                </span>
              )}
              {co?.employees && (
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: 'var(--muted2)' }}>
                  {co.employees.toLocaleString()} employees
                </span>
              )}
            </div>

            <div className="modal-body">
              {co?.description && (
                <div>
                  <div className="sec-hdr">About</div>
                  <div className={`desc ${descExpanded ? 'expanded' : ''}`}>
                    {co.description}
                    {!descExpanded && <div className="desc-fade" />}
                  </div>
                  {!descExpanded && (
                    <button className="read-more" onClick={() => setDescExpanded(true)}>
                      Read more ↓
                    </button>
                  )}
                </div>
              )}

              {isEquity && (an?.rec_key || an?.target_mean || an?.num_analysts) ? (
                <div>
                  <div className="sec-hdr">Analyst Consensus</div>
                  <div className="consensus-grid">
                    <div className="con-card">
                      <div className="con-lbl">Recommendation</div>
                      <div style={{ marginTop: 4 }}>
                        <span className={`rec-pill ${recPillClass(an?.rec_key ?? '')}`}>
                          {recLabel(an?.rec_key ?? '') || '—'}
                        </span>
                      </div>
                      <div className="con-sub">
                        {an?.num_analysts ? `${an.num_analysts} analysts` : ''}
                        {an?.rec_mean ? ` · score ${fmt(an.rec_mean, 1)}` : ''}
                      </div>
                    </div>
                    <div className="con-card">
                      <div className="con-lbl">Mean target</div>
                      <div className={`con-val ${(an?.upside_pct ?? 0) > 0 ? 'g' : (an?.upside_pct ?? 0) < 0 ? 'r' : ''}`}>
                        {an?.target_mean ? `$${fmt(an.target_mean)}` : '—'}
                      </div>
                      <div className="con-sub">
                        {an?.upside_pct != null
                          ? `${an.upside_pct > 0 ? '↑ +' : '↓ '}${fmt(an.upside_pct, 1)}% upside`
                          : ''}
                      </div>
                    </div>
                    <div className="con-card">
                      <div className="con-lbl">Bull target</div>
                      <div className="con-val g">{an?.target_high ? `$${fmt(an.target_high)}` : '—'}</div>
                      <div className="con-sub">Highest analyst</div>
                    </div>
                    <div className="con-card">
                      <div className="con-lbl">Bear target</div>
                      <div className="con-val r">{an?.target_low ? `$${fmt(an.target_low)}` : '—'}</div>
                      <div className="con-sub">Lowest analyst</div>
                    </div>
                  </div>
                  {an?.target_low != null && an.target_high != null && stock?.price && (
                    <TargetBar low={an.target_low} high={an.target_high} current={stock.price} />
                  )}
                </div>
              ) : !isEquity ? (
                <div>
                  <div className="sec-hdr">{isETF ? 'ETF / Fund Info' : 'Instrument Info'}</div>
                  <div className="consensus-grid">
                    {co?.fund_family && (
                      <div className="con-card">
                        <div className="con-lbl">Fund family</div>
                        <div className="con-val" style={{ fontSize: 14 }}>{co.fund_family}</div>
                      </div>
                    )}
                    {co?.category && (
                      <div className="con-card">
                        <div className="con-lbl">Category</div>
                        <div className="con-val" style={{ fontSize: 14 }}>{co.category}</div>
                      </div>
                    )}
                    {co?.total_assets != null && (
                      <div className="con-card">
                        <div className="con-lbl">Total assets</div>
                        <div className="con-val b">${fmt(co.total_assets)}B</div>
                      </div>
                    )}
                    {co?.nav != null && (
                      <div className="con-card">
                        <div className="con-lbl">NAV</div>
                        <div className="con-val">${fmt(co.nav)}</div>
                      </div>
                    )}
                    {co?.expense_ratio != null && (
                      <div className="con-card">
                        <div className="con-lbl">Expense ratio</div>
                        <div className="con-val">{(co.expense_ratio * 100).toFixed(2)}%</div>
                      </div>
                    )}
                    {co?.ytd_return != null && (
                      <div className="con-card">
                        <div className="con-lbl">YTD return</div>
                        <div className={`con-val ${co.ytd_return >= 0 ? 'g' : 'r'}`}>
                          {(co.ytd_return * 100).toFixed(1)}%
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              <div>
                <div className="sec-hdr">Recent Upgrades &amp; Downgrades</div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="upgrade-table">
                    <thead>
                      <tr><th>Date</th><th>Firm</th><th>Action</th><th>From</th><th>To</th></tr>
                    </thead>
                    <tbody>
                      {data.upgrades.length > 0 ? (
                        data.upgrades.map((u, i) => (
                          <tr key={i}>
                            <td style={{ color: 'var(--muted2)' }}>{u.date}</td>
                            <td style={{ fontWeight: 600 }}>{u.firm}</td>
                            <td className={actionClass(u.action)} style={{ fontWeight: 600, textTransform: 'capitalize' }}>{u.action}</td>
                            <td>{u.from || '—'}</td>
                            <td style={{ fontWeight: 600, color: 'var(--text)' }}>{u.to || '—'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} style={{ color: 'var(--muted)', fontFamily: "'DM Mono',monospace", fontSize: 11 }}>
                            {isEquity ? 'No recent upgrades/downgrades' : 'Not applicable for this instrument type'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="sec-hdr">Earnings History (EPS)</div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="earnings-table">
                    <thead>
                      <tr><th>Quarter</th><th>Estimate</th><th>Actual</th><th>Surprise</th></tr>
                    </thead>
                    <tbody>
                      {data.earnings.length > 0 ? (
                        [...data.earnings].reverse().map((e, i) => {
                          const beat = e.surprise_pct != null && e.surprise_pct > 0;
                          const miss = e.surprise_pct != null && e.surprise_pct < 0;
                          return (
                            <tr key={i}>
                              <td>{e.date}</td>
                              <td>{e.eps_estimate != null ? `$${fmt(e.eps_estimate)}` : '—'}</td>
                              <td style={{ fontWeight: 600 }}>{e.eps_actual != null ? `$${fmt(e.eps_actual)}` : '—'}</td>
                              <td className={beat ? 'beat' : miss ? 'miss' : 'inline'}>
                                {e.surprise_pct != null ? `${beat ? '+' : ''}${fmt(e.surprise_pct, 1)}%` : '—'}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={4} style={{ color: 'var(--muted)', fontFamily: "'DM Mono',monospace", fontSize: 11 }}>
                            {isEquity ? 'No earnings history available' : 'ETFs/funds do not report quarterly EPS'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="sec-hdr">Fundamentals</div>
                <FundamentalsGrid fu={fu} />
              </div>

              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>
                Data via Yahoo Finance · {data.fetched_at} · Not financial advice
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TargetBar({ low, high, current }: { low: number; high: number; current: number }) {
  const lo = Math.min(low, current * 0.8);
  const hi = Math.max(high, current * 1.2);
  const range = hi - lo;
  const curPct = Math.max(0, Math.min(100, ((current - lo) / range) * 100));
  const lowPct = Math.max(0, Math.min(100, ((low - lo) / range) * 100));
  const highPct = Math.max(0, Math.min(100, ((high - lo) / range) * 100));
  return (
    <div className="target-bar-wrap">
      <div className="target-bar-track">
        <div className="target-bar-range" style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }} />
        <div className="target-bar-cur" style={{ left: `${curPct}%` }} />
      </div>
      <div className="target-labels">
        <span>Low ${fmt(low)}</span>
        <span style={{ color: 'var(--text)' }}>Current ${fmt(current)}</span>
        <span>High ${fmt(high)}</span>
      </div>
    </div>
  );
}

function FundamentalsGrid({ fu }: { fu: AnalystData['fundamentals'] | undefined }) {
  if (!fu) return null;
  const items = [
    { lbl: 'Market Cap', tt: 'mktcap', val: fu.market_cap != null ? `$${fmt(fu.market_cap)}B` : null },
    { lbl: 'Revenue TTM', tt: 'revenue', val: fu.revenue_ttm != null ? `$${fmt(fu.revenue_ttm)}B` : null },
    { lbl: 'Free Cash Flow', tt: 'fcf', val: fu.free_cashflow != null ? `$${fmt(fu.free_cashflow)}B` : null },
    { lbl: 'P/E (trailing)', tt: 'pe', val: fu.pe_ratio != null ? fmt(fu.pe_ratio) : null },
    { lbl: 'P/E (forward)', tt: 'fwd_pe', val: fu.forward_pe != null ? fmt(fu.forward_pe) : null },
    { lbl: 'PEG Ratio', tt: 'peg', val: fu.peg_ratio != null ? fmt(fu.peg_ratio) : null },
    { lbl: 'Price/Book', tt: 'pb', val: fu.price_to_book != null ? fmt(fu.price_to_book) : null },
    { lbl: 'Price/Sales', tt: 'ps', val: fu.price_to_sales != null ? fmt(fu.price_to_sales) : null },
    { lbl: 'EV/EBITDA', tt: 'ev_ebitda', val: fu.ev_ebitda != null ? fmt(fu.ev_ebitda) : null },
    { lbl: 'EPS (TTM)', tt: 'eps', val: fu.eps_trailing != null ? `$${fmt(fu.eps_trailing)}` : null },
    { lbl: 'EPS (Fwd)', tt: 'fwd_eps', val: fu.eps_forward != null ? `$${fmt(fu.eps_forward)}` : null },
    { lbl: 'Gross Margin', tt: 'gross_margin', val: fmtPct(fu.gross_margins) !== '—' ? fmtPct(fu.gross_margins) : null },
    { lbl: 'Op. Margin', tt: 'op_margin', val: fmtPct(fu.operating_margins) !== '—' ? fmtPct(fu.operating_margins) : null },
    { lbl: 'Net Margin', tt: 'net_margin', val: fmtPct(fu.profit_margin) !== '—' ? fmtPct(fu.profit_margin) : null },
    { lbl: 'ROE', tt: 'roe', val: fmtPct(fu.roe) !== '—' ? fmtPct(fu.roe) : null },
    { lbl: 'ROA', tt: 'roa', val: fmtPct(fu.roa) !== '—' ? fmtPct(fu.roa) : null },
    { lbl: 'Rev Growth', tt: 'rev_growth', val: fmtPct(fu.revenue_growth) !== '—' ? fmtPct(fu.revenue_growth) : null },
    { lbl: 'Earn. Growth', tt: 'earn_growth', val: fmtPct(fu.earnings_growth) !== '—' ? fmtPct(fu.earnings_growth) : null },
    { lbl: 'Debt/Equity', tt: 'de', val: fu.debt_to_equity != null ? fmt(fu.debt_to_equity) : null },
    { lbl: 'Beta', tt: 'beta', val: fu.beta != null ? fmt(fu.beta) : null },
    { lbl: 'Dividend Yield', tt: 'div_yield', val: fmtPct(fu.dividend_yield) !== '—' ? fmtPct(fu.dividend_yield) : null },
    { lbl: 'Short %Float', tt: 'short_pct', val: fmtPct(fu.shares_short_pct) !== '—' ? fmtPct(fu.shares_short_pct) : null },
  ].filter(item => item.val != null);

  if (!items.length) {
    return (
      <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: 'var(--muted)' }}>
        No fundamental data available for this instrument.
      </p>
    );
  }

  return (
    <div className="fund-grid">
      {items.map((item, i) => (
        <div key={i} className="fund-item">
          <div className="fund-lbl tt" data-tt={item.tt}>{item.lbl}</div>
          <div className="fund-val">{item.val}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Clock ────────────────────────────────────────────────────
function Clock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () =>
      setTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{time}</span>;
}

// ─── Main Dashboard ───────────────────────────────────────────
type Filter = 'all' | 'buy' | 'sell' | 'clean';

interface Props {
  userName: string | null;
  userEmail: string | null;
  userImage: string | null;
}

export default function DashboardClient({ userName, userEmail, userImage }: Props) {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [addInput, setAddInput] = useState('');
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [pollLoading, setPollLoading] = useState(false);
  const [modalSymbol, setModalSymbol] = useState<string | null>(null);
  const bootDoneRef = useRef(false);
  const slowIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/stocks');
      const d = await res.json() as AppState & { error?: string };
      if (!res.ok) {
        setApiError(d.error ?? `Server error ${res.status}`);
        return;
      }
      setApiError(null);
      setAppState(d);
      if (d.last_poll && !bootDoneRef.current) {
        bootDoneRef.current = true;
      }
    } catch (e) {
      setApiError(`Cannot reach API: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const fastId = setInterval(async () => {
      await fetchData();
      if (bootDoneRef.current && !slowIntervalRef.current) {
        clearInterval(fastId);
        slowIntervalRef.current = setInterval(fetchData, 30_000);
      }
    }, 3_000);
    return () => {
      clearInterval(fastId);
      if (slowIntervalRef.current) clearInterval(slowIntervalRef.current);
    };
  }, [fetchData]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setModalSymbol(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  async function addStock() {
    const sym = addInput.trim().toUpperCase();
    if (!sym) return;
    setAddLoading(true);
    setAddError('');
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym }),
      });
      const d = await res.json();
      if (!res.ok) setAddError(d.error || 'Error');
      else { setAddInput(''); await fetchData(); }
    } catch {
      setAddError('Backend unreachable');
    }
    setAddLoading(false);
  }

  async function removeStock(sym: string) {
    try {
      await fetch(`/api/watchlist/${sym}`, { method: 'DELETE' });
      await fetchData();
    } catch { /* ignore */ }
  }

  async function addRecipient() {
    const email = emailInput.trim().toLowerCase();
    if (!email) return;
    setEmailLoading(true);
    setEmailError('');
    try {
      const res = await fetch('/api/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const d = await res.json();
      if (!res.ok) setEmailError(d.error || 'Error');
      else {
        setEmailInput('');
        setAppState(prev => prev ? { ...prev, recipients: d.recipients } : prev);
      }
    } catch {
      setEmailError('Backend unreachable');
    }
    setEmailLoading(false);
  }

  async function removeRecipient(email: string) {
    try {
      const res = await fetch(`/api/recipients/${encodeURIComponent(email)}`, { method: 'DELETE' });
      const d = await res.json();
      if (res.ok) setAppState(prev => prev ? { ...prev, recipients: d.recipients } : prev);
    } catch { /* ignore */ }
  }

  async function manualPoll() {
    setPollLoading(true);
    try {
      await fetch('/api/poll?force=1');
      await new Promise(r => setTimeout(r, 2000));
      await fetchData();
    } catch { /* ignore */ }
    setPollLoading(false);
  }

  const stocks = appState?.stocks ?? [];
  const sorted = [...stocks].sort((a, b) => {
    const sA = (a.has_buy ? 2 : 0) + (a.has_sell ? 1 : 0);
    const sB = (b.has_buy ? 2 : 0) + (b.has_sell ? 1 : 0);
    return sB - sA || (a.change_pct ?? 0) - (b.change_pct ?? 0);
  });
  const filtered =
    filter === 'buy' ? sorted.filter(s => s.has_buy)
    : filter === 'sell' ? sorted.filter(s => s.has_sell)
    : filter === 'clean' ? sorted.filter(s => !s.has_buy && !s.has_sell)
    : sorted;

  const buyCnt = stocks.filter(s => s.has_buy).length;
  const sellCnt = stocks.filter(s => s.has_sell).length;
  const gainCnt = stocks.filter(s => s.change_pct >= 0).length;
  const loseCnt = stocks.filter(s => s.change_pct < 0).length;
  const marketOpen = appState?.market_open ?? false;
  const recipients = appState?.recipients ?? [];

  return (
    <>
      <Tooltip />
      <div className="wrap">
        <header>
          <div className="logo">
            <div className="logo-name">Market Pulse</div>
            <div className="logo-sub">Live stock tracker + alerts</div>
          </div>
          <div className="header-controls">
            <div className={`mkt-pill ${appState ? (marketOpen ? 'open' : 'closed') : ''}`}>
              <span className="dot" />
              <span>{appState ? (marketOpen ? 'Market open' : 'Market closed') : 'Checking…'}</span>
            </div>
            <button className="btn btn-primary" onClick={manualPoll} disabled={pollLoading}>
              {pollLoading ? <><span className="spin" /> Polling…</> : '↻ Refresh'}
            </button>
            <div className="user-menu">
              {userImage && (
                <img src={userImage} alt={userName ?? 'User'} className="user-avatar" referrerPolicy="no-referrer" />
              )}
              <span className="user-name">{userName ?? userEmail ?? 'Account'}</span>
              <button
                className="btn"
                style={{ fontSize: 12, padding: '6px 12px' }}
                onClick={() => signOut({ callbackUrl: '/' })}
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <div className="panel">
          <div className="panel-row">
            <span className="lbl">Add stock</span>
            <input
              id="addInput"
              placeholder="e.g. AMD"
              maxLength={10}
              value={addInput}
              onChange={e => { setAddInput(e.target.value.toUpperCase()); setAddError(''); }}
              onKeyDown={e => e.key === 'Enter' && addStock()}
              style={{ textTransform: 'uppercase' }}
            />
            <button className="btn btn-primary" onClick={addStock} disabled={addLoading}>
              {addLoading ? <span className="spin" /> : '+ Add'}
            </button>
            {addError && <span className="err-msg">{addError}</span>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-row">
            <span className="lbl" style={{ color: 'var(--teal)' }}>📧 Alert recipients</span>
            <input
              className="recipients-input"
              type="email"
              placeholder="name@example.com"
              value={emailInput}
              onChange={e => { setEmailInput(e.target.value); setEmailError(''); }}
              onKeyDown={e => e.key === 'Enter' && addRecipient()}
            />
            <button
              className="btn"
              style={{ background: 'rgba(48,213,200,.1)', borderColor: 'rgba(48,213,200,.3)', color: 'var(--teal)' }}
              onClick={addRecipient}
              disabled={emailLoading}
            >
              {emailLoading ? <span className="spin" /> : '+ Add email'}
            </button>
            {emailError && <span className="err-msg">{emailError}</span>}
          </div>
          <div className="chips">
            {recipients.length === 0 ? (
              <span className="no-chips">No recipients yet</span>
            ) : (
              recipients.map(e => (
                <div key={e} className="chip">
                  <span>{e}</span>
                  <button className="chip-x" onClick={() => removeRecipient(e)}>✕</button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="summary">
          <div className="stat"><div className="stat-lbl">Tracking</div><div className="stat-val b">{stocks.length || '—'}</div></div>
          <div className="stat"><div className="stat-lbl">Gainers</div><div className="stat-val g">{gainCnt || '—'}</div></div>
          <div className="stat"><div className="stat-lbl">Losers</div><div className="stat-val r">{loseCnt || '—'}</div></div>
          <div className="stat"><div className="stat-lbl">Buy signals</div><div className="stat-val a">{buyCnt || '—'}</div></div>
          <div className="stat"><div className="stat-lbl">Sell signals</div><div className="stat-val r">{sellCnt || '—'}</div></div>
        </div>

        <div className="filters">
          {(['all', 'buy', 'sell', 'clean'] as Filter[]).map(f => (
            <button key={f} className={`fbtn ${filter === f ? `active ${f}` : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'ALL' : f === 'buy' ? '🟢 BUY SIGNALS' : f === 'sell' ? '🔴 SELL SIGNALS' : 'CLEAN'}
            </button>
          ))}
        </div>

        <div className="ts">
          {appState?.last_poll
            ? `Last updated: ${appState.last_poll}`
            : appState ? 'Fetching stock data…' : 'Waiting for first poll…'}
        </div>

        <div className="grid">
          {apiError ? (
            <div className="empty" style={{ borderColor: 'rgba(255,71,87,.3)' }}>
              <h3 style={{ color: 'var(--red)' }}>API Error</h3>
              <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: 'var(--red)', marginBottom: 12 }}>{apiError}</p>
              <p style={{ fontSize: 12 }}>Make sure <code>DATABASE_URL</code> is set in <code>.env.local</code>.</p>
            </div>
          ) : !appState ? (
            <div className="empty">
              <div style={{ marginBottom: 16 }}><span className="spin-teal" /></div>
              <h3>Connecting…</h3>
              <p>Loading market data from the database.</p>
            </div>
          ) : !appState.last_poll ? (
            <div className="empty">
              <div style={{ marginBottom: 16 }}><span className="spin-teal" /></div>
              <h3>Fetching stock data…</h3>
              <p>
                The initial poll is running. This usually takes 15–30 seconds.
                <br />Click <strong>↻ Refresh</strong> to trigger a poll now.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty"><h3>No stocks match this filter</h3></div>
          ) : (
            filtered.map(s => (
              <StockCard key={s.symbol} s={s} onRemove={removeStock} onOpenDetail={setModalSymbol} />
            ))
          )}
        </div>

        <footer>
          <span>Market Pulse · Not financial advice</span>
          <Clock />
        </footer>
      </div>

      {modalSymbol && (
        <DetailModal
          symbol={modalSymbol}
          stock={stocks.find(s => s.symbol === modalSymbol)}
          onClose={() => setModalSymbol(null)}
        />
      )}
    </>
  );
}
