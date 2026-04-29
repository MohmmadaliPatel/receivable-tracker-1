'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function DeclineBody() {
  const sp = useSearchParams();
  const token = sp.get('token');
  const [status, setStatus] = useState<'loading' | 'done' | 'already' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Missing link.');
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/public/confirmation/msme/decline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 403 && data.error === 'already_submitted') {
          setStatus('already');
          setMessage(data.message || 'A response was already recorded.');
          return;
        }
        if (!res.ok) {
          setStatus('error');
          setMessage(data.error || data.message || 'Could not save.');
          return;
        }
        setStatus('done');
        setMessage('Thank you. Your response has been recorded.');
      } catch {
        setStatus('error');
        setMessage('Network error.');
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900 mb-2">MSME confirmation</h1>
        {status === 'loading' && <p className="text-slate-600">Saving…</p>}
        {(status === 'done' || status === 'already' || status === 'error') && (
          <p className={`text-sm ${status === 'error' ? 'text-red-600' : 'text-slate-800'}`}>{message}</p>
        )}
      </div>
    </div>
  );
}

export default function MsmeDeclinePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <DeclineBody />
    </Suspense>
  );
}
