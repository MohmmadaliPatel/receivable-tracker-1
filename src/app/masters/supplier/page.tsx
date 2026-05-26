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

export default async function MastersSupplierPage() {
  const user = await getUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin' && !user.accessTradeReceivable) {
    if (user.accessTradePayable) redirect('/masters/vendor');
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
            variant="supplier"
            title="Supplier master"
            description="Canonical suppliers/customers for Trade Receivables. The listing file matches the Trade Receivables workspace — one upload updates supplier masters and TR rows. Confirm MSME is hydrated from Vendor master (not this list)."
            listUrl="/api/masters/supplier"
            listingUploadUrl="/api/masters/supplier/upload"
            rtUploadUrl="/api/masters/supplier/rt-upload"
          />
        </div>
      </div>
    </AuthGuard>
  );
}
