import { NextRequest, NextResponse } from 'next/server';
import { fetchAnalystData } from '@/lib/analyst';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { symbol } = await params;
  const sym = symbol.toUpperCase().trim();

  if (!sym) {
    return NextResponse.json({ error: 'No symbol' }, { status: 400 });
  }

  const data = await fetchAnalystData(sym);
  return NextResponse.json(data);
}
