export interface StockData {
  symbol: string;
  price: number;
  open: number;
  prev_close: number;
  change: number;
  change_pct: number;
  dip_open: number;
  dip_30d: number;
  rsi: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  bb_upper: number | null;
  bb_mid: number | null;
  bb_lower: number | null;
  ma50: number | null;
  ma200: number | null;
  volume: number;
  avg_volume: number | null;
  vol_ratio: number | null;
  week_52_high: number;
  week_52_low: number;
  buy_signals: string[];
  sell_signals: string[];
  has_buy: boolean;
  has_sell: boolean;
  updated_at: string;
  error: string | null;
}

export interface AnalystData {
  symbol: string;
  is_equity: boolean;
  quote_type: string;
  company: {
    name: string;
    sector: string;
    industry: string;
    country: string;
    employees: number | null;
    description: string;
    website: string;
    exchange: string;
    quote_type: string;
    category: string;
    fund_family: string;
    inception: string;
    total_assets: number | null;
    nav: number | null;
    ytd_return: number | null;
    three_yr: number | null;
    five_yr: number | null;
    expense_ratio: number | null;
  };
  fundamentals: {
    market_cap: number | null;
    pe_ratio: number | null;
    forward_pe: number | null;
    peg_ratio: number | null;
    price_to_book: number | null;
    price_to_sales: number | null;
    ev_ebitda: number | null;
    debt_to_equity: number | null;
    current_ratio: number | null;
    roe: number | null;
    roa: number | null;
    profit_margin: number | null;
    revenue_growth: number | null;
    earnings_growth: number | null;
    dividend_yield: number | null;
    beta: number | null;
    short_ratio: number | null;
    shares_short_pct: number | null;
    eps_trailing: number | null;
    eps_forward: number | null;
    revenue_ttm: number | null;
    free_cashflow: number | null;
    gross_margins: number | null;
    operating_margins: number | null;
  };
  analyst: {
    target_mean: number | null;
    target_high: number | null;
    target_low: number | null;
    target_median: number | null;
    upside_pct: number | null;
    rec_key: string;
    rec_mean: number | null;
    num_analysts: number | null;
  };
  upgrades: Array<{
    date: string;
    firm: string;
    action: string;
    to: string;
    from: string;
  }>;
  earnings: Array<{
    date: string;
    eps_estimate: number | null;
    eps_actual: number | null;
    surprise: number | null;
    surprise_pct: number | null;
  }>;
  next_earnings: string | null;
  fetched_at: string;
  error: string | null;
}

export interface AppState {
  stocks: StockData[];
  market_open: boolean;
  last_poll: string | null;
  alerts_sent: number;
  watchlist: string[];
  recipients: string[];
}

export const ALERT_RULES = {
  buy_dip_pct: 5,
  buy_rsi_oversold: 35,
  buy_volume_spike: 2.0,
  buy_near_52w_low: 5,
  buy_below_200ma: 2,
  buy_bb_lower: true,
  buy_macd_cross: true,
  sell_rsi_overbought: 70,
  sell_near_52w_high: 3,
  sell_above_200ma: 10,
  sell_bb_upper: true,
  sell_macd_cross: true,
  sell_vol_spike_up: 2.0,
} as const;
