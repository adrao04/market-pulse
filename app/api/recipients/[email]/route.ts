import { NextRequest, NextResponse } from 'next/server';
import { getRecipients, removeRecipient } from '@/lib/db';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const { email } = await params;
  const addr = decodeURIComponent(email).toLowerCase();

  const current = await getRecipients(userId);
  if (!current.includes(addr)) {
    return NextResponse.json(
      { error: `${addr} not in list` },
      { status: 404 }
    );
  }

  await removeRecipient(userId, addr);
  const recipients = await getRecipients(userId);
  return NextResponse.json({ ok: true, recipients });
}
