import { NextRequest, NextResponse } from 'next/server';
import { getRecipients, addRecipient } from '@/lib/db';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const recipients = await getRecipients(session.user.id);
  return NextResponse.json({ recipients });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const email: string = String(body.email ?? '')
    .toLowerCase()
    .trim();

  if (!email || !email.includes('@') || !email.split('@')[1]?.includes('.')) {
    return NextResponse.json(
      { error: 'Invalid email address' },
      { status: 400 }
    );
  }

  const current = await getRecipients(userId);
  if (current.includes(email)) {
    return NextResponse.json(
      { error: `${email} already in list` },
      { status: 400 }
    );
  }

  await addRecipient(userId, email);
  const recipients = await getRecipients(userId);
  return NextResponse.json({ ok: true, email, recipients });
}
