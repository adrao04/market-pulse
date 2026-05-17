import { NextResponse } from 'next/server';
import {
  ensureSchema,
  getCachedStocks,
  getWatchlist,
  getRecipients,
  getLastPoll,
  getAlertsSent,
} from '@/lib/db';
import { isMarketOpen } from '@/lib/stock';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    await ensureSchema();

    const [stocks, watchlist, recipients, lastPoll, alertsSent] =
      await Promise.all([
        getCachedStocks(userId),
        getWatchlist(userId),
        getRecipients(userId),
        getLastPoll(),
        getAlertsSent(),
      ]);

    return NextResponse.json({
      stocks,
      market_open: isMarketOpen(),
      last_poll: lastPoll,
      alerts_sent: alertsSent,
      watchlist,
      recipients,
    });
  } catch (e) {
    console.error('[/api/stocks]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
