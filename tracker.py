"""
Stock Tracker - Live price fetcher + buy/sell alert engine
Polls yfinance every hour during market hours (Mon-Fri, 9:30am-4:00pm ET)
Sends email alerts via SendGrid when signals are detected
Exposes a REST API so the frontend can manage the watchlist dynamically
"""

import yfinance as yf
import schedule
import time
import json
import os
import threading
import urllib.parse
import http.server
import requests
from datetime import datetime, time as dtime
import pytz

# ─────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────
DEFAULT_WATCHLIST = ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA"]

ALERT_RULES = {
    # BUY signals
    "buy_dip_pct":        5,     # % drop from 30-day high
    "buy_rsi_oversold":   35,    # RSI below this = oversold
    "buy_volume_spike":   2.0,   # volume X times 20-day average (on a down day)
    "buy_near_52w_low":   5,     # within X% of 52-week low
    "buy_below_200ma":    2,     # price within X% of 200-day MA (at support)
    "buy_bb_lower":       True,  # price touches lower Bollinger Band
    "buy_macd_cross":     True,  # MACD bullish crossover

    # SELL signals
    "sell_rsi_overbought": 70,   # RSI above this = overbought
    "sell_near_52w_high":  3,    # within X% of 52-week high
    "sell_above_200ma":    10,   # price X% above 200-day MA (stretched)
    "sell_bb_upper":       True, # price touches upper Bollinger Band
    "sell_macd_cross":     True, # MACD bearish crossover
    "sell_vol_spike_up":   2.0,  # volume spike on a big up day (distribution)
}

SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY", "YOUR_SENDGRID_API_KEY")
ALERT_FROM_EMAIL = os.getenv("ALERT_FROM_EMAIL", "alerts@yourdomain.com")

# Default recipients — add more here or via the dashboard
DEFAULT_RECIPIENTS = ["akshatharao04@gmail.com"]

SERVER_PORT = 8765

# ─────────────────────────────────────────────
# SHARED STATE
# ─────────────────────────────────────────────
watchlist  = list(DEFAULT_WATCHLIST)
recipients = list(DEFAULT_RECIPIENTS)
state      = {"stocks": [], "market_open": False, "last_poll": None, "alerts_sent": 0}
state_lock = threading.Lock()

# ─────────────────────────────────────────────
# MARKET HOURS
# ─────────────────────────────────────────────
def is_market_open():
    et  = pytz.timezone("America/New_York")
    now = datetime.now(et)
    if now.weekday() >= 5:
        return False
    return dtime(9, 30) <= now.time() <= dtime(16, 0)

# ─────────────────────────────────────────────
# INDICATORS
# ─────────────────────────────────────────────
def calc_rsi(closes, period=14):
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
    gains  = [d if d > 0 else 0 for d in deltas[-period:]]
    losses = [-d if d < 0 else 0 for d in deltas[-period:]]
    avg_g  = sum(gains) / period
    avg_l  = sum(losses) / period
    if avg_l == 0:
        return 100.0
    return round(100 - (100 / (1 + avg_g / avg_l)), 2)

def calc_sma(values, period):
    if len(values) < period:
        return None
    return round(sum(values[-period:]) / period, 2)

def calc_ema(values, period):
    if len(values) < period:
        return None
    k, ema = 2 / (period + 1), sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1 - k)
    return ema

def calc_macd(closes):
    if len(closes) < 35:
        return None, None, None
    macd_series = []
    for i in range(26, len(closes)):
        e12 = calc_ema(closes[:i+1], 12)
        e26 = calc_ema(closes[:i+1], 26)
        if e12 and e26:
            macd_series.append(e12 - e26)
    if len(macd_series) < 9:
        return None, None, None
    macd_now    = macd_series[-1]
    signal_now  = calc_ema(macd_series, 9)
    histogram   = macd_now - signal_now if signal_now else None
    # Previous histogram for crossover detection
    if len(macd_series) >= 10:
        signal_prev = calc_ema(macd_series[:-1], 9)
        hist_prev   = macd_series[-2] - signal_prev if signal_prev else None
    else:
        hist_prev = None
    return (
        round(macd_now, 4),
        round(signal_now, 4) if signal_now else None,
        round(histogram, 4)  if histogram  else None,
        round(hist_prev, 4)  if hist_prev  else None,
    )

def calc_bollinger(closes, period=20, mult=2):
    if len(closes) < period:
        return None, None, None
    window   = closes[-period:]
    mean     = sum(window) / period
    std      = (sum((x - mean)**2 for x in window) / period) ** 0.5
    return round(mean, 2), round(mean + mult * std, 2), round(mean - mult * std, 2)

# ─────────────────────────────────────────────
# FETCH + ANALYSE
# ─────────────────────────────────────────────
def fetch_stock(symbol):
    try:
        ticker = yf.Ticker(symbol)
        hist   = ticker.history(period="1y")
        if hist.empty:
            return None

        closes  = hist["Close"].tolist()
        highs   = hist["High"].tolist()
        lows    = hist["Low"].tolist()
        volumes = hist["Volume"].tolist()

        current  = round(float(ticker.fast_info.last_price), 2)
        open_p   = round(float(hist["Open"].iloc[-1]), 2)
        prev_cl  = round(float(closes[-2]) if len(closes) > 1 else closes[-1], 2)
        change   = round(current - prev_cl, 2)
        chg_pct  = round((change / prev_cl) * 100, 2)
        dip_open = round(((current - open_p) / open_p) * 100, 2)

        w52_high = round(max(highs), 2)
        w52_low  = round(min(lows),  2)
        ma50     = calc_sma(closes, 50)
        ma200    = calc_sma(closes, 200)
        rsi      = calc_rsi(closes)

        macd_result = calc_macd(closes)
        if len(macd_result) == 4:
            macd_line, macd_sig, macd_hist, macd_hist_prev = macd_result
        else:
            macd_line = macd_sig = macd_hist = macd_hist_prev = None

        macd_bull = macd_hist_prev is not None and macd_hist is not None and macd_hist_prev < 0 and macd_hist >= 0
        macd_bear = macd_hist_prev is not None and macd_hist is not None and macd_hist_prev > 0 and macd_hist <= 0

        bb_mid, bb_upper, bb_lower = calc_bollinger(closes)

        avg_vol   = round(sum(volumes[-21:-1]) / 20) if len(volumes) >= 21 else None
        curr_vol  = int(volumes[-1])
        vol_ratio = round(curr_vol / avg_vol, 2) if avg_vol else None

        recent_high = round(max(highs[-30:]), 2) if len(highs) >= 30 else w52_high
        dip_30d     = round(((current - recent_high) / recent_high) * 100, 2)

        # ── BUY SIGNALS ──
        buy_signals = []
        if dip_30d <= -ALERT_RULES["buy_dip_pct"]:
            buy_signals.append(f"Dip {abs(dip_30d):.1f}% from 30d high")
        if rsi and rsi < ALERT_RULES["buy_rsi_oversold"]:
            buy_signals.append(f"RSI oversold ({rsi})")
        if vol_ratio and vol_ratio >= ALERT_RULES["buy_volume_spike"] and change < 0:
            buy_signals.append(f"Vol spike {vol_ratio}x on down day")
        if current <= w52_low * (1 + ALERT_RULES["buy_near_52w_low"] / 100):
            buy_signals.append("Near 52-week low")
        if ma200 and current < ma200 and abs((current - ma200) / ma200 * 100) <= ALERT_RULES["buy_below_200ma"]:
            buy_signals.append(f"At 200MA support (${ma200})")
        if bb_lower and current <= bb_lower:
            buy_signals.append("At lower Bollinger Band")
        if ALERT_RULES["buy_macd_cross"] and macd_bull:
            buy_signals.append("MACD bullish crossover")

        # ── SELL SIGNALS ──
        sell_signals = []
        if rsi and rsi > ALERT_RULES["sell_rsi_overbought"]:
            sell_signals.append(f"RSI overbought ({rsi})")
        if current >= w52_high * (1 - ALERT_RULES["sell_near_52w_high"] / 100):
            sell_signals.append("Near 52-week high")
        if ma200 and current > ma200 and ((current - ma200) / ma200 * 100) >= ALERT_RULES["sell_above_200ma"]:
            sell_signals.append(f">{ALERT_RULES['sell_above_200ma']}% above 200MA")
        if bb_upper and current >= bb_upper:
            sell_signals.append("At upper Bollinger Band")
        if ALERT_RULES["sell_macd_cross"] and macd_bear:
            sell_signals.append("MACD bearish crossover")
        if vol_ratio and vol_ratio >= ALERT_RULES["sell_vol_spike_up"] and change > 0 and chg_pct > 3:
            sell_signals.append(f"Vol spike {vol_ratio}x on up surge")

        return {
            "symbol":      symbol,
            "price":       current,
            "open":        open_p,
            "prev_close":  prev_cl,
            "change":      change,
            "change_pct":  chg_pct,
            "dip_open":    dip_open,
            "dip_30d":     dip_30d,
            "rsi":         rsi,
            "macd":        macd_line,
            "macd_signal": macd_sig,
            "macd_hist":   macd_hist,
            "bb_upper":    bb_upper,
            "bb_mid":      bb_mid,
            "bb_lower":    bb_lower,
            "ma50":        ma50,
            "ma200":       ma200,
            "volume":      curr_vol,
            "avg_volume":  avg_vol,
            "vol_ratio":   vol_ratio,
            "week_52_high":w52_high,
            "week_52_low": w52_low,
            "buy_signals": buy_signals,
            "sell_signals":sell_signals,
            "has_buy":     len(buy_signals) > 0,
            "has_sell":    len(sell_signals) > 0,
            "updated_at":  datetime.now().strftime("%H:%M:%S"),
            "error":       None,
        }
    except Exception as e:
        print(f"[ERROR] {symbol}: {e}")
        return {"symbol": symbol, "error": str(e), "buy_signals": [], "sell_signals": [], "has_buy": False, "has_sell": False}

# ─────────────────────────────────────────────
# ANALYST + FUNDAMENTAL DATA
# ─────────────────────────────────────────────
def fetch_analyst_data(symbol):
    """
    Fetch analyst ratings, price targets, earnings, and fundamentals.
    Resilient to ETFs, funds, futures, and any ticker that lacks full fundamentals.
    Each data section is fetched independently so a failure in one never blocks others.
    """
    ticker = yf.Ticker(symbol)

    # ── Safely fetch ticker.info — never crash on 404 or missing fields ──
    info = {}
    try:
        raw = ticker.info
        if isinstance(raw, dict):
            info = raw
    except Exception as e:
        print(f"[ANALYST] {symbol}: info unavailable ({e})")

    # Detect instrument type — ETFs/funds/indices lack fundamentals
    quote_type = info.get("quoteType", "").upper()   # EQUITY, ETF, MUTUALFUND, INDEX, FUTURE, CURRENCY
    is_equity  = quote_type in ("EQUITY", "")        # empty = assume equity if info loaded at all

    def safe(key, divisor=1, decimals=2):
        try:
            v = info.get(key)
            return round(float(v) / divisor, decimals) if v is not None else None
        except Exception:
            return None

    # ── Company / instrument info ──
    company = {
        "name":        info.get("longName") or info.get("shortName", symbol),
        "sector":      info.get("sector", ""),
        "industry":    info.get("industry", ""),
        "country":     info.get("country", ""),
        "employees":   info.get("fullTimeEmployees"),
        "description": info.get("longBusinessSummary", ""),
        "website":     info.get("website", ""),
        "exchange":    info.get("exchange", ""),
        "quote_type":  quote_type,
        # ETF-specific fields
        "category":    info.get("category", ""),
        "fund_family": info.get("fundFamily", ""),
        "inception":   info.get("fundInceptionDate", ""),
        "total_assets":safe("totalAssets", 1e9, 2),   # in billions
        "nav":         safe("navPrice"),
        "ytd_return":  safe("ytdReturn"),
        "three_yr":    safe("threeYearAverageReturn"),
        "five_yr":     safe("fiveYearAverageReturn"),
        "expense_ratio":safe("annualReportExpenseRatio"),
    }

    # ── Analyst consensus (equity only) ──
    target_mean   = safe("targetMeanPrice")
    target_high   = safe("targetHighPrice")
    target_low    = safe("targetLowPrice")
    target_median = safe("targetMedianPrice")
    current_price = safe("currentPrice") or safe("regularMarketPrice") or safe("navPrice")
    upside = round(((target_mean - current_price) / current_price) * 100, 1) \
             if target_mean and current_price else None
    rec_key      = info.get("recommendationKey", "")
    rec_mean     = safe("recommendationMean")
    num_analysts = info.get("numberOfAnalystOpinions")

    # ── Upgrades / Downgrades ──
    upgrades = []
    try:
        ud = ticker.upgrades_downgrades
        if ud is not None and not ud.empty:
            for idx, row in ud.head(10).iterrows():
                upgrades.append({
                    "date":   str(idx)[:10],
                    "firm":   str(row.get("Firm", "")),
                    "action": str(row.get("Action", "")),
                    "to":     str(row.get("ToGrade", "")),
                    "from":   str(row.get("FromGrade", "")),
                })
    except Exception:
        pass

    # ── Earnings history (equity only) ──
    earnings_hist = []
    try:
        eh = ticker.earnings_history
        if eh is not None and not eh.empty:
            for _, row in eh.tail(8).iterrows():
                eps_est      = row.get("epsEstimate")
                eps_act      = row.get("epsActual")
                surprise     = row.get("epsDifference")
                surprise_pct = row.get("surprisePercent")
                earnings_hist.append({
                    "date":         str(row.get("quarter", ""))[:10],
                    "eps_estimate": round(float(eps_est), 2)        if eps_est      is not None else None,
                    "eps_actual":   round(float(eps_act), 2)        if eps_act      is not None else None,
                    "surprise":     round(float(surprise), 2)       if surprise     is not None else None,
                    "surprise_pct": round(float(surprise_pct)*100,1) if surprise_pct is not None else None,
                })
    except Exception:
        pass

    # ── Next earnings date ──
    next_earnings = None
    try:
        cal = ticker.calendar
        if cal is not None:
            # calendar can be a dict or DataFrame depending on yfinance version
            if hasattr(cal, "get"):
                ed = cal.get("Earnings Date")
                if ed is not None and len(ed) > 0:
                    next_earnings = str(ed.iloc[0] if hasattr(ed, "iloc") else ed[0])[:10]
            elif hasattr(cal, "empty") and not cal.empty:
                ed = cal.get("Earnings Date")
                if ed is not None and len(ed) > 0:
                    next_earnings = str(ed.iloc[0])[:10]
    except Exception:
        pass

    # ── Fundamentals (equity only — None for ETFs is fine, modal handles it) ──
    fundamentals = {
        "market_cap":        safe("marketCap", 1e9, 2),
        "pe_ratio":          safe("trailingPE"),
        "forward_pe":        safe("forwardPE"),
        "peg_ratio":         safe("pegRatio"),
        "price_to_book":     safe("priceToBook"),
        "price_to_sales":    safe("priceToSalesTrailing12Months"),
        "ev_ebitda":         safe("enterpriseToEbitda"),
        "debt_to_equity":    safe("debtToEquity"),
        "current_ratio":     safe("currentRatio"),
        "roe":               safe("returnOnEquity"),
        "roa":               safe("returnOnAssets"),
        "profit_margin":     safe("profitMargins"),
        "revenue_growth":    safe("revenueGrowth"),
        "earnings_growth":   safe("earningsGrowth"),
        "dividend_yield":    safe("dividendYield"),
        "beta":              safe("beta"),
        "short_ratio":       safe("shortRatio"),
        "shares_short_pct":  safe("shortPercentOfFloat"),
        "eps_trailing":      safe("trailingEps"),
        "eps_forward":       safe("forwardEps"),
        "revenue_ttm":       safe("totalRevenue", 1e9, 2),
        "free_cashflow":     safe("freeCashflow", 1e9, 2),
        "gross_margins":     safe("grossMargins"),
        "operating_margins": safe("operatingMargins"),
    }

    return {
        "symbol":        symbol,
        "is_equity":     is_equity,
        "quote_type":    quote_type,
        "company":       company,
        "fundamentals":  fundamentals,
        "analyst": {
            "target_mean":   target_mean,
            "target_high":   target_high,
            "target_low":    target_low,
            "target_median": target_median,
            "upside_pct":    upside,
            "rec_key":       rec_key,
            "rec_mean":      round(rec_mean, 2) if rec_mean else None,
            "num_analysts":  num_analysts,
        },
        "upgrades":      upgrades,
        "earnings":      earnings_hist,
        "next_earnings": next_earnings,
        "fetched_at":    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "error":         None,
    }


def send_alert_email(buy_alerts, sell_alerts):
    if SENDGRID_API_KEY == "YOUR_SENDGRID_API_KEY":
        print("[EMAIL] Skipped — set SENDGRID_API_KEY env var")
        return
    if not recipients:
        print("[EMAIL] Skipped — no recipients configured")
        return

    def rows(alerts, kind):
        out = ""
        for a in alerts:
            sigs = "".join(f"<li>{s}</li>" for s in a[f"{kind}_signals"])
            clr  = "#16a34a" if a["change_pct"] >= 0 else "#dc2626"
            out += f"""<tr>
              <td style="padding:10px;font-weight:bold">{a['symbol']}</td>
              <td style="padding:10px">${a['price']}</td>
              <td style="padding:10px;color:{clr}">{a['change_pct']:+.2f}%</td>
              <td style="padding:10px"><ul style="margin:0;padding-left:16px">{sigs}</ul></td>
            </tr>"""
        return out

    html = f"""<html><body style="font-family:sans-serif;max-width:640px;margin:auto">
    <h2 style="border-bottom:2px solid #111;padding-bottom:8px">
      📊 Stock Alert · {datetime.now().strftime('%b %d, %H:%M ET')}</h2>"""

    if buy_alerts:
        html += f"""<h3 style="color:#16a34a">🟢 Buy Signals</h3>
        <table style="width:100%;border-collapse:collapse;border:1px solid #ddd">
          <thead><tr style="background:#16a34a;color:#fff">
            <th style="padding:10px;text-align:left">Symbol</th><th>Price</th><th>Change</th><th>Signals</th>
          </tr></thead><tbody>{rows(buy_alerts,'buy')}</tbody></table>"""

    if sell_alerts:
        html += f"""<h3 style="color:#dc2626;margin-top:24px">🔴 Sell Signals</h3>
        <table style="width:100%;border-collapse:collapse;border:1px solid #ddd">
          <thead><tr style="background:#dc2626;color:#fff">
            <th style="padding:10px;text-align:left">Symbol</th><th>Price</th><th>Change</th><th>Signals</th>
          </tr></thead><tbody>{rows(sell_alerts,'sell')}</tbody></table>"""

    html += "<p style='color:#999;font-size:11px;margin-top:24px'>Not financial advice.</p></body></html>"

    syms = list({a["symbol"] for a in buy_alerts + sell_alerts})
    to_list = [{"email": e} for e in recipients]
    try:
        r = requests.post(
            "https://api.sendgrid.com/v3/mail/send",
            headers={"Authorization": f"Bearer {SENDGRID_API_KEY}", "Content-Type": "application/json"},
            json={
                "personalizations": [{"to": to_list}],
                "from": {"email": ALERT_FROM_EMAIL},
                "subject": f"📊 Stock Alert: {', '.join(syms)}",
                "content": [{"type": "text/html", "value": html}],
            }, timeout=10
        )
        print(f"[EMAIL] {'Sent ✓' if r.status_code == 202 else f'Failed {r.status_code}'} → {recipients}")
    except Exception as e:
        print(f"[EMAIL ERROR] {e}")

# ─────────────────────────────────────────────
# POLL
# ─────────────────────────────────────────────
def poll_stocks(force=False):
    market_open = is_market_open()
    with state_lock:
        state["market_open"] = market_open

    if not market_open and not force:
        print(f"[{datetime.now().strftime('%H:%M')}] Market closed — skipping poll")
        with state_lock:
            state["last_poll"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return

    current_list = list(watchlist)
    print(f"[{datetime.now().strftime('%H:%M')}] Polling {current_list}...")
    results, buy_alerts, sell_alerts = [], [], []

    for sym in current_list:
        data = fetch_stock(sym)
        if data:
            results.append(data)
            if data["has_buy"]:  buy_alerts.append(data)
            if data["has_sell"]: sell_alerts.append(data)
            if not data.get("error"):
                print(f"  {sym}: ${data['price']} ({data['change_pct']:+.2f}%) RSI={data['rsi']}")

    with state_lock:
        state["stocks"]    = results
        state["last_poll"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if buy_alerts or sell_alerts:
            state["alerts_sent"] += len(buy_alerts) + len(sell_alerts)

    if buy_alerts or sell_alerts:
        send_alert_email(buy_alerts, sell_alerts)

def _fetch_and_add(symbol):
    data = fetch_stock(symbol)
    if data:
        with state_lock:
            state["stocks"] = [s for s in state["stocks"] if s["symbol"] != symbol]
            state["stocks"].append(data)

# ─────────────────────────────────────────────
# HTTP SERVER
# ─────────────────────────────────────────────
class Handler(http.server.BaseHTTPRequestHandler):

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path

        # Serve the dashboard HTML from the same origin as the API
        if path == "/" or path == "/index.html" or path == "":
            html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")
            try:
                with open(html_path, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)
            except FileNotFoundError:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"index.html not found next to tracker.py")
            return

        if path == "/api/stocks":
            with state_lock:
                payload = dict(state)
                payload["watchlist"]   = list(watchlist)
                payload["recipients"]  = list(recipients)
            self.send_json(payload)
        elif path == "/api/poll":
            threading.Thread(target=poll_stocks, kwargs={"force": True}, daemon=True).start()
            self.send_json({"ok": True})
        elif path == "/api/watchlist":
            self.send_json({"watchlist": list(watchlist)})
        elif path == "/api/recipients":
            self.send_json({"recipients": list(recipients)})
        elif path.startswith("/api/detail/"):
            symbol = path.split("/api/detail/")[-1].upper().strip()
            if not symbol:
                return self.send_json({"error": "No symbol"}, 400)
            data = fetch_analyst_data(symbol)
            self.send_json(data)
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/watchlist":
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length))
            symbol = body.get("symbol", "").upper().strip()
            if not symbol:
                return self.send_json({"error": "No symbol provided"}, 400)
            if symbol in watchlist:
                return self.send_json({"error": f"{symbol} already in watchlist"}, 400)
            try:
                price = yf.Ticker(symbol).fast_info.last_price
                if not price:
                    raise ValueError()
            except:
                return self.send_json({"error": f"Could not find ticker '{symbol}'"}, 400)
            watchlist.append(symbol)
            print(f"[WATCHLIST] + {symbol}")
            threading.Thread(target=_fetch_and_add, args=(symbol,), daemon=True).start()
            self.send_json({"ok": True, "symbol": symbol, "watchlist": list(watchlist)})
        elif path == "/api/recipients":
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length))
            email  = body.get("email", "").lower().strip()
            if not email or "@" not in email or "." not in email.split("@")[-1]:
                return self.send_json({"error": "Invalid email address"}, 400)
            if email in recipients:
                return self.send_json({"error": f"{email} already in list"}, 400)
            recipients.append(email)
            print(f"[RECIPIENTS] + {email}")
            self.send_json({"ok": True, "email": email, "recipients": list(recipients)})
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_DELETE(self):
        parts = urllib.parse.urlparse(self.path).path.strip("/").split("/")
        if len(parts) == 3 and parts[1] == "watchlist":
            symbol = parts[2].upper()
            if symbol in watchlist:
                watchlist.remove(symbol)
                with state_lock:
                    state["stocks"] = [s for s in state["stocks"] if s["symbol"] != symbol]
                print(f"[WATCHLIST] - {symbol}")
                self.send_json({"ok": True, "watchlist": list(watchlist)})
            else:
                self.send_json({"error": f"{symbol} not in watchlist"}, 404)
        elif len(parts) == 3 and parts[1] == "recipients":
            email = urllib.parse.unquote(parts[2]).lower()
            if email in recipients:
                recipients.remove(email)
                print(f"[RECIPIENTS] - {email}")
                self.send_json({"ok": True, "recipients": list(recipients)})
            else:
                self.send_json({"error": f"{email} not in list"}, 404)
        else:
            self.send_json({"error": "Not found"}, 404)

    def log_message(self, *args):
        pass

def start_server():
    server = http.server.HTTPServer(("0.0.0.0", SERVER_PORT), Handler)
    print(f"[SERVER] Listening on http://localhost:{SERVER_PORT}")
    server.serve_forever()

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print("  Market Pulse — Stock Tracker")
    print(f"  Watchlist : {', '.join(DEFAULT_WATCHLIST)}")
    print(f"  Alerts to : {', '.join(DEFAULT_RECIPIENTS)}")
    print(f"  Dashboard : http://localhost:{SERVER_PORT}")
    print("  ↑ Open this URL in your browser")
    print("=" * 55)

    # 1. Start HTTP server in background so the browser can connect immediately
    threading.Thread(target=start_server, daemon=True).start()

    # 2. Small pause to let the socket bind, then kick off the first poll
    #    in its own thread so the server stays responsive during the fetch
    time.sleep(0.5)
    print("[INIT] Running initial poll in background…")
    threading.Thread(target=poll_stocks, kwargs={"force": True}, daemon=True).start()

    # 3. Schedule hourly polls (skips automatically when market is closed)
    schedule.every(1).hours.do(poll_stocks)
    print("[SCHEDULER] Hourly polling active (market hours only)")

    # 4. Keep main thread alive running the scheduler
    while True:
        schedule.run_pending()
        time.sleep(30)
