'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function UploadBody() {
  const sp = useSearchParams();
  const token = sp.get('token');
  const [files, setFiles] = useState<FileList | null>(null);
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error' | 'already'>('idle');
  const [message, setMessage] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setMessage('Missing link.');
      setStatus('error');
      return;
    }
    if (!files?.length) {
      setMessage('Choose at least one file.');
      setStatus('error');
      return;
    }
    setStatus('sending');
    const form = new FormData();
    form.append('token', token);
    for (let i = 0; i < files.length; i++) {
      form.append('files', files.item(i)!);
    }
    try {
      const res = await fetch('/api/public/confirmation/msme/upload', {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data.error === 'already_submitted') {
        setStatus('already');
        setMessage(data.message || 'A response was already submitted.');
        return;
      }
      if (!res.ok) {
        setStatus('error');
        setMessage(data.error || data.message || 'Upload failed.');
        return;
      }
      setStatus('done');
      setMessage('Thank you. Your certificate file(s) have been uploaded.');
    } catch {
      setStatus('error');
      setMessage('Network error.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-2">MSME certificate</h1>
        <p className="text-sm text-slate-600 mb-6">Upload one or more MSME certificate files.</p>
        {status !== 'done' && status !== 'already' ? (
          <form onSubmit={submit} className="space-y-4">
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(e.target.files)}
              className="text-sm w-full"
            />
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {status === 'sending' ? 'Uploading…' : 'Submit'}
            </button>
          </form>
        ) : (
          <p className="text-sm text-slate-800">{message}</p>
        )}
        {status === 'error' && <p className="text-sm text-red-600 mt-3">{message}</p>}
      </div>
    </div>
  );
}

export default function MsmeUploadPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <UploadBody />
    </Suspense>
  );
}
