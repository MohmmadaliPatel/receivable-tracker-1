'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function ConfirmBody() {
  const sp = useSearchParams();
  const token = sp.get('token');
  const [status, setStatus] = useState<'loading' | 'done' | 'already' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Missing link. Open the full URL from your email.');
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/public/confirmation/trade/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 403 && data.error === 'already_submitted') {
          setStatus('already');
          setMessage(data.message || 'Your response was already recorded.');
          return;
        }
        if (!res.ok) {
          setStatus('error');
          setMessage(data.error || data.message || 'Could not confirm.');
          return;
        }
        setStatus('done');
        setMessage('Thank you. Your confirmation has been recorded.');
      } catch {
        setStatus('error');
        setMessage('Network error. Please try again.');
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900 mb-2">Balance confirmation</h1>
        {status === 'loading' && <p className="text-slate-600">Submitting…</p>}
        {(status === 'done' || status === 'already' || status === 'error') && (
          <p className={`text-sm ${status === 'error' ? 'text-red-600' : 'text-slate-700'}`}>{message}</p>
        )}
      </div>
    </div>
  );
}

export default function TradeConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <p className="text-slate-600">Loading…</p>
        </div>
      }
    >
      <ConfirmBody />
    </Suspense>
  );
}
