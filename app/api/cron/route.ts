import { NextRequest, NextResponse } from 'next/server';
import {
  getAllWatchlistSymbols,
  getAllUserWatchlists,
  getRecipients,
  upsertStockCache,
  incrementAlertsSent,
} from '@/lib/db';
import { fetchAllStocks, isMarketOpen } from '@/lib/stock';
import { sendAlertEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isMarketOpen()) {
    console.log('[CRON] Market closed — skipping poll');
    return NextResponse.json({ ok: true, skipped: 'market closed' });
  }

  // Fetch all unique symbols across every user's watchlist
  const allSymbols = await getAllWatchlistSymbols();
  if (!allSymbols.length) {
    return NextResponse.json({ ok: true, skipped: 'no symbols' });
  }

  console.log(`[CRON] Polling ${allSymbols.join(', ')}`);
  const stocks = await fetchAllStocks(allSymbols);
  await Promise.all(stocks.map(s => upsertStockCache(s.symbol, s)));

  // Send per-user alert emails
  const userWatchlists = await getAllUserWatchlists();
  let totalAlerts = 0;

  for (const { userId, symbols } of userWatchlists) {
    const userStocks = stocks.filter(s => symbols.includes(s.symbol));
    const buyAlerts = userStocks.filter(s => s.has_buy && !s.error);
    const sellAlerts = userStocks.filter(s => s.has_sell && !s.error);

    if (buyAlerts.length || sellAlerts.length) {
      const recipients = await getRecipients(userId);
      if (recipients.length) {
        await sendAlertEmail(buyAlerts, sellAlerts, recipients);
        totalAlerts += buyAlerts.length + sellAlerts.length;
      }
    }
  }

  if (totalAlerts > 0) await incrementAlertsSent(totalAlerts);

  return NextResponse.json({
    ok: true,
    polled: stocks.length,
    users: userWatchlists.length,
    alerts_sent: totalAlerts,
  });
}
