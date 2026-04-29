import AuthGuard from '@/components/AuthGuard';
import Sidebar from '@/components/Sidebar';
import PartyMasterWorkspaceClient from '@/components/PartyMasterWorkspaceClient';
import { getSession } from '@/lib/simple-auth';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

async function getUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

export default async function VendorMasterPage() {
  const user = await getUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin' && !user.accessTradePayable) {
    if (user.accessTradeReceivable) redirect('/supplier-master');
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
        <div className="flex-1 overflow-auto">
          <PartyMasterWorkspaceClient
            variant="vendor"
            title="Vendor master"
            description="Canonical vendors for Trade Payables. The listing file here is the same as on the Trade Payables page — one upload updates vendor masters and TP rows. Use the RT India workbook for Sheet1 billing emails."
            listUrl="/api/masters/vendor"
            listingUploadUrl="/api/masters/vendor/upload"
            rtUploadUrl="/api/masters/vendor/rt-upload"
          />
        </div>
      </div>
    </AuthGuard>
  );
}
