import type { StockData } from './types';

interface SendGridMail {
  personalizations: Array<{ to: Array<{ email: string }> }>;
  from: { email: string };
  subject: string;
  content: Array<{ type: string; value: string }>;
}

function buildRows(alerts: StockData[], kind: 'buy' | 'sell'): string {
  return alerts
    .map(a => {
      const signals = (
        kind === 'buy' ? a.buy_signals : a.sell_signals
      )
        .map(s => `<li>${s}</li>`)
        .join('');
      const color = a.change_pct >= 0 ? '#16a34a' : '#dc2626';
      return `<tr>
        <td style="padding:10px;font-weight:bold">${a.symbol}</td>
        <td style="padding:10px">$${a.price.toFixed(2)}</td>
        <td style="padding:10px;color:${color}">${a.change_pct >= 0 ? '+' : ''}${a.change_pct.toFixed(2)}%</td>
        <td style="padding:10px"><ul style="margin:0;padding-left:16px">${signals}</ul></td>
      </tr>`;
    })
    .join('');
}

export async function sendAlertEmail(
  buyAlerts: StockData[],
  sellAlerts: StockData[],
  recipients: string[]
): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.ALERT_FROM_EMAIL;

  if (!apiKey || apiKey === 'YOUR_SENDGRID_API_KEY') {
    console.log('[EMAIL] Skipped — set SENDGRID_API_KEY env var');
    return;
  }
  if (!recipients.length) {
    console.log('[EMAIL] Skipped — no recipients configured');
    return;
  }

  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  let html = `<html><body style="font-family:sans-serif;max-width:640px;margin:auto">
  <h2 style="border-bottom:2px solid #111;padding-bottom:8px">
    📊 Stock Alert · ${now} ET</h2>`;

  if (buyAlerts.length) {
    html += `<h3 style="color:#16a34a">🟢 Buy Signals</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #ddd">
      <thead><tr style="background:#16a34a;color:#fff">
        <th style="padding:10px;text-align:left">Symbol</th><th>Price</th><th>Change</th><th>Signals</th>
      </tr></thead><tbody>${buildRows(buyAlerts, 'buy')}</tbody></table>`;
  }

  if (sellAlerts.length) {
    html += `<h3 style="color:#dc2626;margin-top:24px">🔴 Sell Signals</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #ddd">
      <thead><tr style="background:#dc2626;color:#fff">
        <th style="padding:10px;text-align:left">Symbol</th><th>Price</th><th>Change</th><th>Signals</th>
      </tr></thead><tbody>${buildRows(sellAlerts, 'sell')}</tbody></table>`;
  }

  html += `<p style='color:#999;font-size:11px;margin-top:24px'>Not financial advice.</p></body></html>`;

  const syms = [...new Set([...buyAlerts, ...sellAlerts].map(a => a.symbol))];

  const payload: SendGridMail = {
    personalizations: [{ to: recipients.map(e => ({ email: e })) }],
    from: { email: fromEmail ?? 'alerts@example.com' },
    subject: `📊 Stock Alert: ${syms.join(', ')}`,
    content: [{ type: 'text/html', value: html }],
  };

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    console.log(
      `[EMAIL] ${res.status === 202 ? 'Sent ✓' : `Failed ${res.status}`} → ${recipients}`
    );
  } catch (e) {
    console.error('[EMAIL ERROR]', e);
  }
}
