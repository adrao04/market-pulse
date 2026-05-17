import { NextRequest, NextResponse } from 'next/server';
import { getWatchlist, addToWatchlist, upsertStockCache } from '@/lib/db';
import { fetchStock } from '@/lib/stock';
import { yfQuote } from '@/lib/yf';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const watchlist = await getWatchlist(session.user.id);
  return NextResponse.json({ watchlist });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const symbol: string = String(body.symbol ?? '')
    .toUpperCase()
    .trim();

  if (!symbol) {
    return NextResponse.json({ error: 'No symbol provided' }, { status: 400 });
  }

  // Verify the ticker exists — only reject on a clean "no data" response,
  // not on rate-limit/network failures (those would incorrectly block valid tickers).
  try {
    const quote = await yfQuote(symbol);
    if (quote !== null && !quote.regularMarketPrice) {
      return NextResponse.json(
        { error: `Could not find ticker '${symbol}'` },
        { status: 400 }
      );
    }
  } catch {
    // API error (rate limit, network) — let the add proceed
  }

  const current = await getWatchlist(userId);
  if (current.includes(symbol)) {
    return NextResponse.json(
      { error: `${symbol} already in watchlist` },
      { status: 400 }
    );
  }

  await addToWatchlist(userId, symbol);

  fetchStock(symbol)
    .then(data => upsertStockCache(symbol, data))
    .catch(() => {});

  const watchlist = await getWatchlist(userId);
  return NextResponse.json({ ok: true, symbol, watchlist });
}
