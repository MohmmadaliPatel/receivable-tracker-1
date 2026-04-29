import { redirect } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Sidebar from '@/components/Sidebar';
import ConfirmationsClient from './ConfirmationsClient';
import { getSession } from '@/lib/simple-auth';
import { cookies } from 'next/headers';

async function getUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

export default async function ConfirmationsPage() {
  const user = await getUser();
  if (!user || user.role !== 'admin') redirect('/trade-payables');

  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar user={user ? { username: user.username, name: user.name, role: user.role, accessTradePayable: user.accessTradePayable, accessTradeReceivable: user.accessTradeReceivable, accessConfirmMsme: user.accessConfirmMsme } : undefined} />
        <div className="flex-1 overflow-hidden">
          <ConfirmationsClient />
        </div>
      </div>
    </AuthGuard>
  );
}
