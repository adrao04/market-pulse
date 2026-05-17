# 📈 Market Pulse — Stock Tracker

Live stock tracker with hourly polling (market hours only) + email alerts via SendGrid.

---

## Project structure

```
stock-tracker/
├── tracker.py        # Python backend: fetches prices, runs alerts, serves API
├── index.html        # Frontend dashboard (open directly in browser)
└── requirements.txt  # Python dependencies
```

---

## Setup

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure your watchlist & alerts

Open `tracker.py` and edit the top section:

```python
WATCHLIST = ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA"]  # Your stocks

ALERT_RULES = {
    "dip_pct":      5,    # Alert on >= 5% dip from today's open
    "rsi_oversold": 35,   # Alert when RSI < 35
    "volume_spike": 2.0,  # Alert when volume is 2x the 20-day average
}
```

### 3. Set up SendGrid email alerts

Sign up at https://sendgrid.com (free tier: 100 emails/day).

Set these environment variables before running:

```bash
# macOS / Linux
export SENDGRID_API_KEY="SG.your_api_key_here"
export ALERT_FROM_EMAIL="alerts@yourdomain.com"   # must be a verified sender
export ALERT_TO_EMAIL="you@gmail.com"

# Windows (PowerShell)
$env:SENDGRID_API_KEY = "SG.your_api_key_here"
$env:ALERT_FROM_EMAIL = "alerts@yourdomain.com"
$env:ALERT_TO_EMAIL   = "you@gmail.com"
```

Or add them directly in `tracker.py` (lines 30-32) — less secure but simpler.

### 4. Run the backend

```bash
python tracker.py
```

The backend:
- Polls all stocks immediately on start
- Polls every hour (skips if market is closed: weekends + before 9:30am / after 4:00pm ET)
- Serves live data on `http://localhost:8765/api/stocks`
- Sends email alerts when signals are triggered

### 5. Open the dashboard

Simply open `index.html` in your browser. It connects to the local backend automatically.

---

## Alert signals

| Signal            | Trigger condition                          |
|-------------------|--------------------------------------------|
| Dip from open     | Price dropped ≥ 5% from today's open       |
| RSI oversold      | RSI(14) dropped below 35                   |
| Volume spike      | Current volume ≥ 2× the 20-day average     |
| Near 52-week low  | Price within 5% of the 52-week low         |

---

## Manual refresh

You can trigger an immediate poll (ignores market hours check) by:
- Clicking **"↻ Refresh now"** in the dashboard
- Or visiting `http://localhost:8765/api/poll` in your browser

---

## Run on a server (optional)

To keep it running 24/7 on a Linux server:

```bash
# Install as a systemd service or use screen/tmux
screen -S stocktracker
python tracker.py
# Ctrl+A, D to detach
```

Or use a Raspberry Pi, any VPS (DigitalOcean $4/mo), or your home machine kept on during market hours.

---

## Disclaimer
Not financial advice. Data from Yahoo Finance (15-min delayed for some feeds).
