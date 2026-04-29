import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";
import DashboardOverview from "@/components/DashboardOverview";
import { getSession } from '@/lib/simple-auth';
import { cookies } from 'next/headers';

async function getUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

export default async function Home() {
  const user = await getUser();

  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-slate-50/90">
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
        <div className="flex-1 min-w-0">
          <div className="p-6 md:p-10">
            <DashboardOverview />
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
