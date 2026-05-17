import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import DashboardClient from './dashboard-client';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  return (
    <DashboardClient
      userName={session.user.name ?? null}
      userEmail={session.user.email ?? null}
      userImage={session.user.image ?? null}
    />
  );
}
