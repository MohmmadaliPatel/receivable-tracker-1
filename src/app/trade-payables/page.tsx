import AuthGuard from '@/components/AuthGuard';
import Sidebar from '@/components/Sidebar';
import ModuleWorkspaceClient from '@/components/ModuleWorkspaceClient';
import { getSession } from '@/lib/simple-auth';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

async function getUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

export default async function TradePayablesPage() {
  const user = await getUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin' && !user.accessTradePayable) {
    if (user.accessTradeReceivable) redirect('/trade-receivables');
    if (user.accessConfirmMsme) redirect('/confirm-msme');
    redirect('/');
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar
          user={
            user
              ? {
                  username: user.username,
                  name: user.name,
                  role: user.role,
                  accessTradePayable: user.accessTradePayable,
                  accessTradeReceivable: user.accessTradeReceivable,
                  accessConfirmMsme: user.accessConfirmMsme,
                }
              : undefined
          }
        />
        <div className="flex-1 overflow-hidden">
          <ModuleWorkspaceClient moduleKey="trade_payable" title="Trade Payables" />
        </div>
      </div>
    </AuthGuard>
  );
}
