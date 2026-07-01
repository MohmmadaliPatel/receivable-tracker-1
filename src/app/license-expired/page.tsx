import { verifyLicense, licenseStatusMessage, formatLicenseExpiry, licenseContact } from '@/lib/license';

export const dynamic = 'force-dynamic';

export default async function LicenseExpiredPage() {
  const status = await verifyLicense();
  const contact = licenseContact();
  const headline = status.ok ? 'License active' : status.reason === 'expired' ? 'License expired' : 'License required';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{headline}</h1>
            <p className="text-sm text-slate-500">Taxteck Email Auto Manager</p>
          </div>
        </div>

        <p className="text-slate-700 leading-relaxed">{licenseStatusMessage(status)}</p>

        {!status.ok && status.customer && (
          <p className="mt-3 text-sm text-slate-500">
            Licensed to: <span className="font-medium text-slate-700">{status.customer}</span>
          </p>
        )}

        {!status.ok && status.expiresAt && status.reason === 'expired' && (
          <p className="mt-1 text-sm text-slate-500">
            Expiry date: <span className="font-medium text-slate-700">{formatLicenseExpiry(status.expiresAt)}</span>
          </p>
        )}

        <div className="mt-8 p-5 rounded-xl bg-slate-50 border border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Contact us for renewal</h2>
          <p className="text-sm text-slate-600 mt-2">
            To renew or obtain a license, please reach out:
          </p>
          <ul className="mt-4 space-y-3 text-sm">
            <li>
              <span className="text-slate-500">Email</span>
              <br />
              <a href={`mailto:${contact.email}`} className="font-medium text-blue-700 hover:underline">
                {contact.email}
              </a>
            </li>
            <li>
              <span className="text-slate-500">Phone</span>
              <br />
              <a href={`tel:+91${contact.phone}`} className="font-medium text-blue-700 hover:underline">
                +91 {contact.phone}
              </a>
            </li>
          </ul>
        </div>

        {status.ok && (
          <p className="mt-6 text-sm text-emerald-700">
            Your license is valid until {formatLicenseExpiry(status.expiresAt)}.
          </p>
        )}
      </div>
    </div>
  );
}
