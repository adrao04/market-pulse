import { yfChart, yfQuote } from './yf';
import {
  calcRsi,
  calcSma,
  calcMacd,
  calcBollinger,
} from './indicators';
import { ALERT_RULES, type StockData } from './types';

function isMarketOpen(): boolean {
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
  );
  const day = now.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const h = now.getHours(),
    m = now.getMinutes();
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 30 && mins <= 16 * 60;
}

export { isMarketOpen };

function errorStock(symbol: string, msg: string): StockData {
  return {
    symbol,
    price: 0,
    open: 0,
    prev_close: 0,
    change: 0,
    change_pct: 0,
    dip_open: 0,
    dip_30d: 0,
    rsi: null,
    macd: null,
    macd_signal: null,
    macd_hist: null,
    bb_upper: null,
    bb_mid: null,
    bb_lower: null,
    ma50: null,
    ma200: null,
    volume: 0,
    avg_volume: null,
    vol_ratio: null,
    week_52_high: 0,
    week_52_low: 0,
    buy_signals: [],
    sell_signals: [],
    has_buy: false,
    has_sell: false,
    updated_at: new Date().toLocaleTimeString('en-US', { hour12: false }),
    error: msg,
  };
}

export async function fetchStock(symbol: string): Promise<StockData> {
  try {
    // Sequential to avoid hammering Yahoo Finance with concurrent requests
    const chart = await yfChart(symbol);
    const liveQuote = await yfQuote(symbol).catch(() => null);

    const rawQuotes = chart.quotes;
    if (rawQuotes.length === 0) return errorStock(symbol, 'No historical data');

    const closes = rawQuotes.map(q => q.close).filter((v): v is number => v != null);
    const highs  = rawQuotes.map(q => q.high).filter((v): v is number => v != null);
    const lows   = rawQuotes.map(q => q.low).filter((v): v is number => v != null);
    const volumes= rawQuotes.map(q => q.volume).filter((v): v is number => v != null);

    if (closes.length < 2) return errorStock(symbol, 'Insufficient data');

    const r2 = (n: number) => Math.round(n * 100) / 100;

    const current = r2(
      liveQuote?.regularMarketPrice ?? chart.regularMarketPrice ?? closes[closes.length - 1]
    );
    const openP  = r2(rawQuotes[rawQuotes.length - 1]?.open ?? current);
    const prevCl = r2(closes[closes.length - 2]);
    const change = r2(current - prevCl);
    const chgPct = r2((change / prevCl) * 100);
    const dipOpen= r2(((current - openP) / openP) * 100);

    const w52High = r2(Math.max(...highs));
    const w52Low  = r2(Math.min(...lows));
    const ma50    = calcSma(closes, 50);
    const ma200   = calcSma(closes, 200);
    const rsi     = calcRsi(closes);

    const [macdLine, macdSig, macdHist, macdHistPrev] = calcMacd(closes);
    const macdBull =
      macdHistPrev != null && macdHist != null &&
      macdHistPrev < 0 && macdHist >= 0;
    const macdBear =
      macdHistPrev != null && macdHist != null &&
      macdHistPrev > 0 && macdHist <= 0;

    const [bbMid, bbUpper, bbLower] = calcBollinger(closes);

    const avgVol =
      volumes.length >= 21
        ? Math.round(
            volumes.slice(-21, -1).reduce((a: number, b: number) => a + b, 0) / 20
          )
        : null;
    const currVol  = volumes[volumes.length - 1] ?? 0;
    const volRatio = avgVol ? r2(currVol / avgVol) : null;

    const recentHigh =
      highs.length >= 30 ? r2(Math.max(...highs.slice(-30))) : w52High;
    const dip30d = r2(((current - recentHigh) / recentHigh) * 100);

    // ── Buy signals ──
    const buySignals: string[] = [];
    if (dip30d <= -ALERT_RULES.buy_dip_pct)
      buySignals.push(`Dip ${Math.abs(dip30d).toFixed(1)}% from 30d high`);
    if (rsi != null && rsi < ALERT_RULES.buy_rsi_oversold)
      buySignals.push(`RSI oversold (${rsi})`);
    if (volRatio != null && volRatio >= ALERT_RULES.buy_volume_spike && change < 0)
      buySignals.push(`Vol spike ${volRatio}x on down day`);
    if (current <= w52Low * (1 + ALERT_RULES.buy_near_52w_low / 100))
      buySignals.push('Near 52-week low');
    if (
      ma200 != null && current < ma200 &&
      Math.abs(((current - ma200) / ma200) * 100) <= ALERT_RULES.buy_below_200ma
    )
      buySignals.push(`At 200MA support ($${ma200})`);
    if (bbLower != null && current <= bbLower)
      buySignals.push('At lower Bollinger Band');
    if (ALERT_RULES.buy_macd_cross && macdBull)
      buySignals.push('MACD bullish crossover');

    // ── Sell signals ──
    const sellSignals: string[] = [];
    if (rsi != null && rsi > ALERT_RULES.sell_rsi_overbought)
      sellSignals.push(`RSI overbought (${rsi})`);
    if (current >= w52High * (1 - ALERT_RULES.sell_near_52w_high / 100))
      sellSignals.push('Near 52-week high');
    if (
      ma200 != null && current > ma200 &&
      ((current - ma200) / ma200) * 100 >= ALERT_RULES.sell_above_200ma
    )
      sellSignals.push(`>${ALERT_RULES.sell_above_200ma}% above 200MA`);
    if (bbUpper != null && current >= bbUpper)
      sellSignals.push('At upper Bollinger Band');
    if (ALERT_RULES.sell_macd_cross && macdBear)
      sellSignals.push('MACD bearish crossover');
    if (
      volRatio != null && volRatio >= ALERT_RULES.sell_vol_spike_up &&
      change > 0 && chgPct > 3
    )
      sellSignals.push(`Vol spike ${volRatio}x on up surge`);

    return {
      symbol,
      price: current,
      open: openP,
      prev_close: prevCl,
      change,
      change_pct: chgPct,
      dip_open: dipOpen,
      dip_30d: dip30d,
      rsi,
      macd: macdLine,
      macd_signal: macdSig,
      macd_hist: macdHist,
      bb_upper: bbUpper,
      bb_mid: bbMid,
      bb_lower: bbLower,
      ma50,
      ma200,
      volume: currVol,
      avg_volume: avgVol,
      vol_ratio: volRatio,
      week_52_high: w52High,
      week_52_low: w52Low,
      buy_signals: buySignals,
      sell_signals: sellSignals,
      has_buy: buySignals.length > 0,
      has_sell: sellSignals.length > 0,
      updated_at: new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      error: null,
    };
  } catch (e) {
    console.error(`[fetchStock] ${symbol}:`, e);
    return errorStock(symbol, String(e instanceof Error ? e.message : e));
  }
}

export async function fetchAllStocks(symbols: string[]): Promise<StockData[]> {
  const results: StockData[] = [];
  for (let i = 0; i < symbols.length; i++) {
    results.push(await fetchStock(symbols[i]!));
    if (i < symbols.length - 1) await new Promise(r => setTimeout(r, 600));
  }
  return results;
}
