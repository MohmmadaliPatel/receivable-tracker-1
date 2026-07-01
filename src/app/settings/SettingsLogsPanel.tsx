'use client';

import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import {
  auditActionLabel,
  auditActionCategory,
  formatAuditDetails,
  summarizeAuditDetails,
  formatBytes,
  formatLogFileDescription,
  AUDIT_ACTION_LABELS,
} from '@/lib/audit-log-labels';
import { META_AUDIT_ACTIONS } from '@/lib/audit-route';

interface AuditLogRow {
  id: string;
  createdAt: string;
  action: string;
  userId: string | null;
  username: string | null;
  ip: string | null;
  userAgent: string | null;
  success: boolean;
  resource: string | null;
  details: string | null;
}

interface LogFileEntry {
  name: string;
  size: number;
  modifiedAt: string;
}

type Tab = 'activity' | 'files';

export default function SettingsLogsPanel() {
  const [tab, setTab] = useState<Tab>('activity');

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Logs &amp; audit trail</h2>
        <p className="text-sm text-gray-500 mt-1">
          Review security-relevant activity and open detailed log files on the server. Admin access only.
        </p>
        <div className="flex gap-2 mt-4">
          <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
            Activity log
          </TabButton>
          <TabButton active={tab === 'files'} onClick={() => setTab('files')}>
            Log files
          </TabButton>
        </div>
      </div>
      <div className="p-6">
        {tab === 'activity' ? <ActivityLogTab /> : <LogFilesTab />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
        active
          ? 'bg-neutral-900 text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

function ActivityLogTab() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [hideMeta, setHideMeta] = useState(true);
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const actionOptions = useMemo(
    () =>
      Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({ value, label })),
    []
  );

  const visibleLogs = useMemo(() => {
    return logs.filter((log) => {
      if (hideMeta && META_AUDIT_ACTIONS.has(log.action)) return false;
      if (failuresOnly && log.success) return false;
      return true;
    });
  }, [logs, hideMeta, failuresOnly]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (actionFilter) params.set('action', actionFilter);
      const res = await fetch(`/api/admin/audit-logs?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load audit log');
        return;
      }
      setLogs(data.logs || []);
      setTotalPages(data.pagination?.pages || 1);
      setTotal(data.pagination?.total || 0);
    } catch {
      setError('Network error while loading audit log');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const exportUrl = actionFilter
    ? `/api/admin/audit-logs?format=ndjson&action=${encodeURIComponent(actionFilter)}&limit=5000`
    : '/api/admin/audit-logs?format=ndjson&limit=5000';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/25 min-w-[220px]"
        >
          <option value="">All activity types</option>
          {actionOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={loadLogs}
          className="px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
        >
          Refresh
        </button>
        <label className="flex items-center gap-2 text-sm text-gray-600 px-2">
          <input
            type="checkbox"
            checked={hideMeta}
            onChange={(e) => setHideMeta(e.target.checked)}
            className="rounded border-gray-300"
          />
          Hide log browsing
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600 px-2">
          <input
            type="checkbox"
            checked={failuresOnly}
            onChange={(e) => setFailuresOnly(e.target.checked)}
            className="rounded border-gray-300"
          />
          Failures only
        </label>
        <a
          href={exportUrl}
          className="px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-700"
        >
          Download full export (.ndjson)
        </a>
        <span className="text-xs text-gray-400 ml-auto">{total} entries</span>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-xl border border-red-200">{error}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-neutral-900 border-t-transparent rounded-full" />
        </div>
      ) : visibleLogs.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">No audit entries match your filters.</p>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                  <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">When</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">What happened</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Who</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Summary</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Result</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((log) => {
                  const detailsObj = formatAuditDetails(log.details);
                  const summary = summarizeAuditDetails(log.action, detailsObj);
                  const expanded = expandedId === log.id;
                  return (
                    <Fragment key={log.id}>
                      <tr className="border-b border-gray-100 hover:bg-gray-50/80">
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap align-top">
                          {formatWhen(log.createdAt)}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <p className="font-medium text-gray-900">
                            {auditActionLabel(log.action)}
                            {!log.success && (
                              <span className="text-red-600 font-normal"> — failed</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">{auditActionCategory(log.action)}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-700 align-top whitespace-nowrap">
                          {log.username || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 align-top max-w-xs">
                          <p className="line-clamp-2">{summary}</p>
                          {log.resource && (
                            <p className="text-xs text-gray-400 mt-1 truncate">Resource: {log.resource}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <StatusBadge success={log.success} />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : log.id)}
                            className="text-xs font-medium text-neutral-700 hover:text-neutral-900 underline-offset-2 hover:underline"
                          >
                            {expanded ? 'Hide' : 'Details'}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <td colSpan={6} className="px-4 py-4">
                            <DetailPanel log={log} detailsObj={detailsObj} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function LogFilesTab() {
  const [files, setFiles] = useState<LogFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{ totalLines: number; truncated: boolean } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/log-files');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to list log files');
        return;
      }
      setFiles(data.files || []);
    } catch {
      setError('Network error while loading log files');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const openFile = async (name: string) => {
    setSelectedFile(name);
    setLoadingFile(true);
    setFileContent(null);
    setFileMeta(null);
    try {
      const res = await fetch(`/api/admin/log-files?file=${encodeURIComponent(name)}&lines=300`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to read log file');
        return;
      }
      setFileContent(data.content || '');
      setFileMeta({ totalLines: data.totalLines, truncated: data.truncated });
    } catch {
      setError('Network error while reading log file');
    } finally {
      setLoadingFile(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        These files live in the <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">logs/</code> folder on the
        server. Debug logs are only written when <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">DEBUG=true</code>.
        The audit fallback file captures entries if the database audit write fails.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={loadFiles}
          className="px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
        >
          Refresh file list
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-xl border border-red-200">{error}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-neutral-900 border-t-transparent rounded-full" />
        </div>
      ) : files.length === 0 ? (
        <div className="text-sm text-gray-500 py-8 text-center border border-dashed border-gray-200 rounded-xl">
          No log files yet. Files appear here when the app writes to <code className="text-xs bg-gray-100 px-1 rounded">logs/</code>{' '}
          (for example <code className="text-xs bg-gray-100 px-1 rounded">audit-fallback.log</code> if a database audit write fails).
        </div>
      ) : (
        <div className="grid gap-3">
          {files.map((f) => (
            <div
              key={f.name}
              className={`border rounded-xl p-4 transition-colors ${
                selectedFile === f.name ? 'border-neutral-400 bg-neutral-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 font-mono text-sm">{f.name}</p>
                  <p className="text-sm text-gray-500 mt-1">{formatLogFileDescription(f.name)}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    {formatBytes(f.size)} · Last updated {formatWhen(f.modifiedAt)}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openFile(f.name)}
                    className="px-3 py-1.5 text-sm bg-neutral-900 text-white rounded-lg hover:bg-neutral-800"
                  >
                    View details
                  </button>
                  <a
                    href={`/api/admin/log-files?file=${encodeURIComponent(f.name)}&download=1`}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-white text-gray-700"
                  >
                    Download
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedFile && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-gray-900 font-mono">{selectedFile}</p>
              {fileMeta && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Showing last {fileMeta.truncated ? '300' : fileMeta.totalLines} of {fileMeta.totalLines} lines
                  {fileMeta.truncated ? ' — download for the full file' : ''}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setFileContent(null);
              }}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              Close
            </button>
          </div>
          {loadingFile ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin w-6 h-6 border-4 border-neutral-900 border-t-transparent rounded-full" />
            </div>
          ) : (
            <pre className="p-4 text-xs font-mono text-gray-800 bg-white overflow-x-auto max-h-[420px] overflow-y-auto whitespace-pre-wrap break-words">
              {fileContent || '(empty file)'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function DetailPanel({
  log,
  detailsObj,
}: {
  log: AuditLogRow;
  detailsObj: Record<string, unknown> | null;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
      <div className="space-y-2">
        <DetailRow label="Event ID" value={log.id} mono />
        <DetailRow label="Technical action" value={log.action} mono />
        <DetailRow label="User ID" value={log.userId || '—'} mono />
        <DetailRow label="IP address" value={log.ip || '—'} />
      </div>
      <div className="space-y-2">
        <DetailRow label="User agent" value={log.userAgent || '—'} />
        <DetailRow label="Resource" value={log.resource || '—'} />
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Full details (JSON)</p>
          <pre className="text-xs font-mono bg-white border border-gray-200 rounded-lg p-3 overflow-x-auto max-h-40">
            {detailsObj ? JSON.stringify(detailsObj, null, 2) : '—'}
          </pre>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`text-gray-800 break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ success }: { success: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/80' : 'bg-red-50 text-red-700 border border-red-200'
      }`}
    >
      {success ? 'Success' : 'Failed'}
    </span>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
