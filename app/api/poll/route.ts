import { NextResponse } from 'next/server';
import {
  getWatchlist,
  getRecipients,
  upsertStockCache,
  incrementAlertsSent,
} from '@/lib/db';
import { fetchAllStocks, isMarketOpen } from '@/lib/stock';
import { sendAlertEmail } from '@/lib/email';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const force =
    new URL(request.url).searchParams.get('force') === '1' ||
    request.headers.get('x-force-poll') === '1';

  if (!force && !isMarketOpen()) {
    return NextResponse.json({ ok: true, skipped: 'market closed' });
  }

  const [watchlist, recipients] = await Promise.all([
    getWatchlist(userId),
    getRecipients(userId),
  ]);

  if (watchlist.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'empty watchlist' });
  }

  const stocks = await fetchAllStocks(watchlist);

  await Promise.all(
    stocks.map(s => upsertStockCache(s.symbol, s))
  );

  const buyAlerts = stocks.filter(s => s.has_buy && !s.error);
  const sellAlerts = stocks.filter(s => s.has_sell && !s.error);

  if ((buyAlerts.length || sellAlerts.length) && recipients.length) {
    await sendAlertEmail(buyAlerts, sellAlerts, recipients);
    await incrementAlertsSent(buyAlerts.length + sellAlerts.length);
  }

  return NextResponse.json({ ok: true, polled: stocks.length });
}
