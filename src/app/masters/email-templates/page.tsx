import AuthGuard from '@/components/AuthGuard';
import Sidebar from '@/components/Sidebar';
import EmailTemplatesClient from './EmailTemplatesClient';
import { getSession } from '@/lib/simple-auth';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

async function getUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

export default async function MastersEmailTemplatesPage() {
  const user = await getUser();
  if (!user || user.role !== 'admin') {
    redirect('/settings');
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
        <div className="flex-1 overflow-auto">
          <EmailTemplatesClient />
        </div>
      </div>
    </AuthGuard>
  );
}
