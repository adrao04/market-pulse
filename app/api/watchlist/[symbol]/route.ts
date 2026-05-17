import { NextRequest, NextResponse } from 'next/server';
import { getWatchlist, removeFromWatchlist } from '@/lib/db';
import { auth } from '@/auth';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const { symbol } = await params;
  const sym = symbol.toUpperCase();

  const watchlist = await getWatchlist(userId);
  if (!watchlist.includes(sym)) {
    return NextResponse.json(
      { error: `${sym} not in watchlist` },
      { status: 404 }
    );
  }

  await removeFromWatchlist(userId, sym);

  // Remove from cache only if no other user is watching this symbol
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const refs = await sql`SELECT 1 FROM watchlist WHERE symbol = ${sym} LIMIT 1`;
    if (refs.length === 0) {
      await sql`DELETE FROM stock_cache WHERE symbol = ${sym}`;
    }
  } catch {
    // non-fatal
  }

  const updated = await getWatchlist(userId);
  return NextResponse.json({ ok: true, watchlist: updated });
}
