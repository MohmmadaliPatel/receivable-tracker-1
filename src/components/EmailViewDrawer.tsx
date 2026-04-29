'use client';

import { useEffect, useState, useRef } from 'react';
import { formatCurrencyCellDisplay } from '@/lib/inr-amount';
import { effectiveMsmeContactEmail } from '@/lib/msme-display-email';

interface AttachmentMeta {
  id: string;
  name: string;
  contentType: string;
  size: number;
  /** Set when reply-check saved the file under the emails/ tree */
  savedPath?: string;
}

interface FollowupEntry {
  followupNumber: number;
  sentAt: string;
  subject: string;
  filePath: string;
  messageId: string | null;
}

interface ResponseEntry {
  receivedAt: string;
  messageId: string;
  subject: string;
  fromEmail: string;
  fromName: string;
  htmlBody: string | null;
  body: string | null;
  filePath: string;
  hasAttachments: boolean;
  attachmentsJson: string | null;
}

interface ConfirmationRecord {
  id: string;
  module?: 'trade_payable' | 'trade_receivable' | 'confirm_msme';
  entityName: string;
  category: string;
  bankName?: string | null;
  accountNumber?: string | null;
  custId?: string | null;
  emailTo: string;
  emailCc?: string | null;
  status: string;
  sentAt?: string | null;
  followupSentAt?: string | null;
  followupCount?: number;
  followupsJson?: string | null;
  responseReceivedAt?: string | null;
  responseSubject?: string | null;
  responseFromEmail?: string | null;
  responseFromName?: string | null;
  responseBody?: string | null;
  responseHtmlBody?: string | null;
  responseHasAttachments?: boolean;
  responseAttachmentsJson?: string | null;
  responsesJson?: string | null;
  sentEmailFilePath?: string | null;
  followupEmailFilePath?: string | null;
  responseEmailFilePath?: string | null;
  emailsSentFolderPath?: string | null;
  responsesFolderPath?: string | null;
  attachmentName?: string | null;
  remarks?: string | null;
  webConfirmedAt?: string | null;
  respondentQueryJson?: string | null;
  msmeHasCertificate?: boolean | null;
  msmeCertificateFilesJson?: string | null;
  documentDate?: string | null;
  documentNumber?: string | null;
  currencyValue?: string | null;
  tradeInvoiceLines?: ConfirmationRecord[];
}

function hasWebConfirmation(record: ConfirmationRecord): boolean {
  if (record.webConfirmedAt) return true;
  const q = record.respondentQueryJson?.trim();
  if (q && q !== '[]') {
    try {
      const j = JSON.parse(q) as unknown;
      if (Array.isArray(j) && j.length > 0) return true;
    } catch {
      return true;
    }
  }
  if (record.msmeCertificateFilesJson?.trim() && record.msmeCertificateFilesJson !== '[]') return true;
  if (record.msmeHasCertificate === true || record.msmeHasCertificate === false) return true;
  return false;
}

interface EmailViewDrawerProps {
  record: ConfirmationRecord;
  onClose: () => void;
}

// Tab can be 'sent' | 'followup-N' (N=1,2,...) | 'response' | 'trail'
type ActiveTab = 'sent' | `followup-${number}` | 'response' | 'trail';

function defaultTabForRecord(record: ConfirmationRecord): ActiveTab {
  if (hasWebConfirmation(record)) return 'response';
  if (record.responseEmailFilePath || record.responseHtmlBody || record.responseBody) return 'trail';
  if (record.followupEmailFilePath || (record.followupCount ?? 0) > 0) return 'trail';
  return 'sent';
}

const statusColors: Record<string, string> = {
  not_sent: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  followup_sent: 'bg-yellow-100 text-yellow-700',
  response_received: 'bg-green-100 text-green-700',
};

const statusLabels: Record<string, string> = {
  not_sent: 'Not Sent',
  sent: 'Email Sent',
  followup_sent: 'Follow-up Sent',
  response_received: 'Response Received',
};

function formatFileSize(bytes: number | undefined): string {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(contentType: string) {
  if (contentType.includes('pdf')) return '📄';
  if (contentType.includes('image')) return '🖼️';
  if (contentType.includes('word') || contentType.includes('document')) return '📝';
  if (contentType.includes('sheet') || contentType.includes('excel')) return '📊';
  if (contentType.includes('zip') || contentType.includes('compressed')) return '🗜️';
  return '📎';
}

export default function EmailViewDrawer({ record, onClose }: EmailViewDrawerProps) {
  const followups: FollowupEntry[] = (() => {
    try { return JSON.parse(record.followupsJson ?? '[]'); } catch { return []; }
  })();

  const allResponses: ResponseEntry[] = (() => {
    try { return JSON.parse(record.responsesJson ?? '[]'); } catch { return []; }
  })();

  // Fall back to single response fields if history list is empty
  const responses: ResponseEntry[] = allResponses.length > 0
    ? allResponses
    : (record.responseReceivedAt ? [{
        receivedAt: record.responseReceivedAt,
        messageId: record.responseAttachmentsJson ? '' : '',
        subject: record.responseSubject ?? '',
        fromEmail: record.responseFromEmail ?? '',
        fromName: record.responseFromName ?? '',
        htmlBody: record.responseHtmlBody ?? null,
        body: record.responseBody ?? null,
        filePath: record.responseEmailFilePath ?? '',
        hasAttachments: record.responseHasAttachments ?? false,
        attachmentsJson: record.responseAttachmentsJson ?? null,
      }] : []);

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => defaultTabForRecord(record));
  const [emailHtml, setEmailHtml] = useState<string | null>(null);
  const [emailPdfUrl, setEmailPdfUrl] = useState<string | null>(null);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [downloadingAttachment, setDownloadingAttachment] = useState<string | null>(null);
  const [showFullThread, setShowFullThread] = useState(false);
  const [threadHtml, setThreadHtml] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const loadGenerationRef = useRef(0);

  const responseAttachments: AttachmentMeta[] = (() => {
    try {
      return record.responseAttachmentsJson ? JSON.parse(record.responseAttachmentsJson) : [];
    } catch {
      return [];
    }
  })();

  const hasEmailThread = responses.length > 0;
  const hasWeb = hasWebConfirmation(record);
  const hasAnyFollowup = followups.length > 0 || !!record.followupEmailFilePath;
  const hasTrail = hasAnyFollowup || hasEmailThread;

  const isMsmeRecord = record.module === 'confirm_msme' || record.category === 'Confirm MSME';
  const msmeEmailEff = isMsmeRecord ? effectiveMsmeContactEmail(record) : null;

  // Build tab list
  interface TabDef { key: ActiveTab; label: string; available: boolean; badge?: string }
  const tabs: TabDef[] = [
    { key: 'sent', label: 'Original', available: !!record.sentEmailFilePath },
    ...(hasTrail
      ? [{ key: 'trail' as ActiveTab, label: 'Full Trail', available: true,
           badge: String((record.followupCount ?? 0) + (hasEmailThread ? 1 : 0) + (hasWeb ? 1 : 0)) }]
      : []),
    { key: 'response', label: 'Response', available: hasEmailThread || hasWeb },
  ];

  // Load file-based content for sent/followup-N tabs
  useEffect(() => {
    if (activeTab === 'response' || activeTab === 'trail') {
      setEmailHtml(null);
      setEmailPdfUrl(null);
      setEmailError(null);
      setFilePath(activeTab === 'response' ? (record.responseEmailFilePath ?? null) : null);
      return;
    }

    let cancelled = false;
    const gen = ++loadGenerationRef.current;

    const isPdfPath = (p: string | null | undefined) => !!p && p.endsWith('.pdf');

    const load = async () => {
      setLoadingEmail(true);
      setEmailHtml(null);
      setEmailPdfUrl(null);
      setEmailError(null);
      setFilePath(null);

      try {
        // followup-N tabs: load from followupsJson history, fall back to legacy endpoint
        if (activeTab.startsWith('followup-')) {
          const fuNum = parseInt(activeTab.replace('followup-', ''), 10);
          const entry = followups.find((f) => f.followupNumber === fuNum);
          if (entry?.filePath) {
            const rel = entry.filePath.replace(/\\/g, '/').split('emails/')[1] ?? '';
            if (isPdfPath(entry.filePath)) {
              setEmailPdfUrl(`/api/documents?action=file&path=${encodeURIComponent(rel)}`);
              setFilePath(entry.filePath);
            } else {
              const res = await fetch(`/api/documents?action=file&path=${encodeURIComponent(rel)}`);
              if (cancelled || gen !== loadGenerationRef.current) return;
              if (res.ok) {
                const data = await res.json();
                setEmailHtml(data.content);
                setFilePath(entry.filePath);
              } else {
                setEmailError('Could not load follow-up email');
              }
            }
          } else {
            const res = await fetch(`/api/confirmations/${record.id}/email-file?type=followup&followupNumber=${fuNum}`);
            if (cancelled || gen !== loadGenerationRef.current) return;
            const ct = res.headers.get('content-type') ?? '';
            if (ct.includes('application/pdf')) {
              const blob = await res.blob();
              setEmailPdfUrl(URL.createObjectURL(blob));
            } else if (res.ok) {
              const d = await res.json();
              setEmailHtml(d.html);
              setFilePath(d.filePath);
            } else {
              setEmailError('Could not load follow-up email');
            }
          }
          return;
        }

        const res = await fetch(`/api/confirmations/${record.id}/email-file?type=${activeTab}`);
        if (cancelled || gen !== loadGenerationRef.current) return;

        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('application/pdf')) {
          const blob = await res.blob();
          if (cancelled || gen !== loadGenerationRef.current) return;
          setEmailPdfUrl(URL.createObjectURL(blob));
          return;
        }

        if (!res.ok) {
          const err = await res.json();
          setEmailError(err.error || 'Could not load email');
          return;
        }
        const data = await res.json();
        if (cancelled || gen !== loadGenerationRef.current) return;
        setEmailHtml(data.html);
        setFilePath(data.filePath);
      } catch {
        if (!cancelled && gen === loadGenerationRef.current) setEmailError('Failed to load email content');
      } finally {
        if (!cancelled && gen === loadGenerationRef.current) setLoadingEmail(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeTab, record.id]);

  const handleDownloadAttachment = async (att: AttachmentMeta, responseIndex: number) => {
    setDownloadingAttachment(att.id);
    try {
      const params = new URLSearchParams({
        attachmentId: att.id,
        responseIndex: String(responseIndex),
      });
      const res = await fetch(`/api/confirmations/${record.id}/response-attachment?${params.toString()}`);
      if (!res.ok) {
        alert('Failed to download attachment');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.name;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingAttachment(null);
    }
  };

  const handlePrintPDF = () => {
    const html = emailHtml;
    if (!html) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  };

  const formatDate = (d?: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const emlDownloadHref =
    activeTab === 'sent' && record.sentEmailFilePath?.endsWith('.pdf')
      ? `/api/confirmations/${record.id}/email-file?type=sent&format=eml`
      : activeTab.startsWith('followup-')
        ? (() => {
            const fuNum = parseInt(activeTab.replace('followup-', ''), 10);
            const entry = followups.find((f) => f.followupNumber === fuNum);
            if (entry?.filePath?.endsWith('.pdf')) {
              return `/api/confirmations/${record.id}/email-file?type=followup&format=eml&followupNumber=${fuNum}`;
            }
            if (record.followupEmailFilePath?.endsWith('.pdf')) {
              return `/api/confirmations/${record.id}/email-file?type=followup&format=eml`;
            }
            return null;
          })()
        : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-view-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-5xl max-h-[92vh] bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200/80 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 id="email-view-title" className="text-lg font-semibold text-slate-900 truncate">
                {record.entityName}
              </h2>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                  statusColors[record.status] || 'bg-gray-100 text-gray-600'
                }`}
              >
                {statusLabels[record.status] || record.status}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1">{record.category}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Metadata grid */}
        <div className="px-6 py-4 bg-slate-50/90 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {!isMsmeRecord && <MetaItem label="Bank / Party" value={record.bankName} />}
          {!isMsmeRecord && <MetaItem label="Authority Letter" value={record.attachmentName} />}
          {isMsmeRecord ? (
            !!record.custId?.trim() && <MetaItem label="Cust ID / Listing" value={record.custId} />
          ) : (
            (record.accountNumber || record.custId) && (
              <>
                <MetaItem label="Account / Loan No." value={record.accountNumber} />
                <MetaItem label="Cust ID" value={record.custId} />
              </>
            )
          )}
          <div className="col-span-1 sm:col-span-2">
            <MetaItem
              label={
                msmeEmailEff?.fromReply && !record.emailTo?.trim()
                  ? 'Vendor email (from reply)'
                  : 'Email To'
              }
              value={
                isMsmeRecord
                  ? msmeEmailEff?.text || '—'
                  : record.emailTo || '—'
              }
            />
            {msmeEmailEff?.fromReply && !!msmeEmailEff.text && (
              <p className="text-xs text-slate-500 mt-1">
                Shown because no outbound &ldquo;Email To&rdquo; is stored on this row; address comes from the inbox
                reply.
              </p>
            )}
          </div>
          {record.emailCc && (
            <div className="col-span-1 sm:col-span-2">
              <MetaItem label="Email CC" value={record.emailCc} />
            </div>
          )}
          <MetaItem label="Sent At" value={formatDate(record.sentAt)} />
          <MetaItem
            label={`Follow-ups${(record.followupCount ?? 0) > 0 ? ` (${record.followupCount})` : ''}`}
            value={
              record.followupSentAt
                ? `Last: ${formatDate(record.followupSentAt)}`
                : (record.followupCount ?? 0) > 0
                  ? `${record.followupCount} sent`
                  : undefined
            }
          />
          {record.remarks && (
            <div className="col-span-1 sm:col-span-2">
              <MetaItem label="Remarks" value={record.remarks} />
            </div>
          )}
        </div>

        {/* Folder paths */}
        {(record.emailsSentFolderPath || record.responsesFolderPath) && (
          <div className="px-6 py-3 bg-indigo-50/80 border-b border-indigo-100 text-xs">
            <p className="font-medium text-indigo-800 mb-1">Saved file locations</p>
            {record.emailsSentFolderPath && <FolderPath label="Emails Sent" path={record.emailsSentFolderPath} />}
            {record.responsesFolderPath && <FolderPath label="Responses" path={record.responsesFolderPath} />}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-slate-200 bg-white px-3 sm:px-4 overflow-x-auto gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => tab.available && setActiveTab(tab.key)}
              disabled={!tab.available}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap rounded-t-lg ${
                activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50'
                  : tab.available
                    ? 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                    : 'border-transparent text-slate-300 cursor-not-allowed'
              }`}
            >
              {tab.label}
              {tab.badge && Number(tab.badge) > 0 && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.key ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
              {!tab.available && <span className="ml-1 text-xs">(none)</span>}
            </button>
          ))}
          <div className="flex-1" />
          {activeTab !== 'response' && activeTab !== 'trail' && emailHtml && (
            <button
              onClick={handlePrintPDF}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg my-1 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download PDF
            </button>
          )}
          {activeTab !== 'response' && activeTab !== 'trail' && emlDownloadHref && (
            <a
              href={emlDownloadHref}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg my-1 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download .eml
            </a>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

          {/* ── TRAIL TAB ── timeline of all emails */}
          {activeTab === 'trail' && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-4 py-4 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium px-1">Email Activity Timeline</p>

              {/* Original */}
              <TrailItem
                type="conf"
                label="Confirmation Sent"
                date={record.sentAt}
                subLabel={record.emailTo}
                onView={record.sentEmailFilePath ? () => setActiveTab('sent') : undefined}
              />

              {/* Follow-ups from history */}
              {followups.map((fu) => (
                <TrailItem
                  key={fu.followupNumber}
                  type="followup"
                  label={`Follow-up #${fu.followupNumber}`}
                  date={fu.sentAt}
                  subLabel={fu.subject}
                  onView={fu.filePath ? () => setActiveTab(`followup-${fu.followupNumber}`) : undefined}
                />
              ))}

              {/* Legacy single follow-up (if no history but has followupSentAt) */}
              {followups.length === 0 && record.followupSentAt && (
                <TrailItem
                  type="followup"
                  label="Follow-up Sent"
                  date={record.followupSentAt}
                  subLabel="(Legacy — details not available)"
                  onView={record.followupEmailFilePath ? () => setActiveTab('followup-1' as ActiveTab) : undefined}
                />
              )}

              {hasWeb && (
                <TrailItem
                  type="response"
                  label="Web confirmation (primary)"
                  date={record.webConfirmedAt ?? record.responseReceivedAt}
                  subLabel="Responded via web / magic link"
                  onView={() => setActiveTab('response')}
                />
              )}

              {/* All email thread responses */}
              {responses.map((r, i) => (
                <TrailItem
                  key={r.messageId || i}
                  type="response"
                  label={responses.length > 1 ? `Response #${i + 1}` : 'Response Received'}
                  date={r.receivedAt}
                  subLabel={r.fromName ? `${r.fromName} <${r.fromEmail}>` : r.fromEmail}
                  onView={() => setActiveTab('response')}
                />
              ))}
              {!hasEmailThread && !hasWeb && (
                <div className="flex items-center gap-3 px-3 py-3 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                  <span className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-sm flex-shrink-0">?</span>
                  <div>
                    <p className="text-sm font-medium text-gray-400">Awaiting Response</p>
                    <p className="text-xs text-gray-400 mt-0.5">No reply received yet</p>
                  </div>
                </div>
              )}
            </div>
            </div>
          )}

          {/* ── RESPONSE TAB ── shows all responses with navigation */}
          {activeTab === 'response' && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <ResponseTabContent
              record={record}
              hasWeb={hasWeb}
              responses={responses}
              responseAttachments={responseAttachments}
              downloadingAttachment={downloadingAttachment}
              onDownloadAttachment={handleDownloadAttachment}
              formatDate={formatDate}
              showFullThread={showFullThread}
              setShowFullThread={setShowFullThread}
              threadHtml={threadHtml}
              setThreadHtml={setThreadHtml}
              loadingThread={loadingThread}
              setLoadingThread={setLoadingThread}
            />
            </div>
          )}

          {/* ── SENT / FOLLOWUP-N TABS ── iframe file viewer */}
          {activeTab !== 'response' && activeTab !== 'trail' && (
            <div className="flex-1 min-h-0 overflow-y-auto">
            <>
              {loadingEmail ? (
                <div className="flex items-center justify-center h-full py-24">
                  <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
                </div>
              ) : emailError ? (
                <div className="flex flex-col items-center justify-center h-full py-24 text-gray-400 gap-2">
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4" />
                  </svg>
                  <p className="text-sm">{emailError}</p>
                </div>
              ) : emailPdfUrl ? (
                <embed
                  src={emailPdfUrl}
                  type="application/pdf"
                  className="w-full h-full min-h-[400px]"
                  title="Email PDF"
                />
              ) : emailHtml ? (
                <iframe
                  srcDoc={emailHtml}
                  className="w-full h-full min-h-[400px]"
                  title="Email Content"
                  sandbox="allow-same-origin"
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full py-24 text-gray-300">
                  <p className="text-sm">No email content available</p>
                </div>
              )}
            </>
            </div>
          )}
        </div>

        {/* File path footer */}
        {filePath && activeTab !== 'trail' && (
          <div className="px-6 py-2 border-t border-slate-100 bg-slate-50 text-xs text-slate-500 truncate">
            <span className="font-medium text-slate-600">
              {activeTab === 'response' ? 'Saved: ' : 'File: '}
            </span>
            {filePath}
          </div>
        )}
      </div>
    </div>
  );
}

function WebConfirmationPanel({
  record,
  formatDate,
}: {
  record: ConfirmationRecord;
  formatDate: (d?: string | null) => string;
}) {
  const [tradeLines, setTradeLines] = useState<ConfirmationRecord[] | undefined>(record.tradeInvoiceLines);

  useEffect(() => {
    setTradeLines(record.tradeInvoiceLines);
    const isTp =
      record.category === 'Trade Payables' ||
      record.category === 'Trade Receivables' ||
      record.module === 'trade_payable' ||
      record.module === 'trade_receivable';
    if (!isTp || (record.tradeInvoiceLines?.length ?? 0) > 0) return;
    let cancel = false;
    (async () => {
      const res = await fetch(`/api/confirmations/${record.id}`);
      const data = await res.json().catch(() => ({}));
      if (!cancel && res.ok && Array.isArray(data.record?.tradeInvoiceLines)) {
        setTradeLines(data.record.tradeInvoiceLines);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [record.id, record.category, record.module, record.tradeInvoiceLines]);

  const queryLines: Array<{ recordId?: string; amountInBooks?: string; note?: string }> = (() => {
    try {
      const raw = record.respondentQueryJson?.trim();
      if (!raw || raw === '[]') return [];
      const j = JSON.parse(raw) as unknown;
      return Array.isArray(j) ? (j as typeof queryLines) : [];
    } catch {
      return [];
    }
  })();

  const queryByRecordId = new Map<string, { amountInBooks?: string; note?: string }>();
  for (const q of queryLines) {
    if (q.recordId) queryByRecordId.set(q.recordId, { amountInBooks: q.amountInBooks, note: q.note });
  }

  const lines = tradeLines ?? [];

  const msmeFiles: Array<{ path: string; originalName: string }> = (() => {
    try {
      const raw = record.msmeCertificateFilesJson?.trim();
      if (!raw || raw === '[]') return [];
      const j = JSON.parse(raw) as unknown;
      return Array.isArray(j) ? (j as typeof msmeFiles) : [];
    } catch {
      return [];
    }
  })();

  return (
    <div className="border-b border-indigo-200 bg-indigo-50/80 flex-shrink-0">
      <div className="bg-indigo-600 text-white px-6 py-3">
        <span className="font-semibold text-sm tracking-wide">Web confirmation (primary)</span>
        {record.responseReceivedAt && (
          <span className="block text-indigo-100 text-xs mt-1 font-normal">
            Recorded {formatDate(record.webConfirmedAt ?? record.responseReceivedAt)}
          </span>
        )}
      </div>
      <div className="px-6 py-4 space-y-4 text-sm text-gray-800">
        {(record.category === 'Trade Payables' || record.category === 'Trade Receivables') &&
          lines.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Invoice lines</p>
              <div className="overflow-x-auto border border-indigo-100 rounded-lg">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-indigo-100/60 text-left text-gray-600">
                      <th className="p-2">Document Date</th>
                      <th className="p-2">Document Number</th>
                      <th className="p-2 text-right">Currency Value</th>
                      <th className="p-2">Web status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => {
                      const qi = queryByRecordId.get(line.id);
                      const queried = qi != null;
                      const confirmed = !!line.webConfirmedAt;
                      let label = '—';
                      let detail = '';
                      if (confirmed) {
                        label = 'Confirmed';
                        detail = formatDate(line.webConfirmedAt);
                      } else if (queried) {
                        label = 'Queried';
                        detail = [
                          qi?.amountInBooks?.trim()
                            ? `Books: ${formatCurrencyCellDisplay(qi.amountInBooks)}`
                            : '',
                          qi?.note?.trim(),
                        ]
                          .filter(Boolean)
                          .join(' · ');
                      }
                      return (
                        <tr key={line.id} className="border-t border-indigo-50 bg-white">
                          <td className="p-2 text-gray-800">{line.documentDate || '—'}</td>
                          <td className="p-2 font-mono text-gray-700">{line.documentNumber || '—'}</td>
                          <td className="p-2 text-right text-gray-800 tabular-nums">
                            {formatCurrencyCellDisplay(line.currencyValue)}
                          </td>
                          <td className="p-2 text-gray-700">
                            <span className={`font-medium ${confirmed ? 'text-green-700' : queried ? 'text-amber-800' : 'text-gray-400'}`}>
                              {label}
                            </span>
                            {detail && <span className="block text-[11px] text-gray-500 mt-0.5">{detail}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        {(lines.length === 0 ||
          (record.category !== 'Trade Payables' && record.category !== 'Trade Receivables')) &&
          record.webConfirmedAt && (
          <p className="text-green-800 font-medium">Balance / line confirmed via web (Confirm action).</p>
        )}
        {queryLines.length > 0 && lines.length === 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Queries submitted</p>
            <ul className="space-y-2">
              {queryLines.map((line, i) => (
                <li key={line.recordId ?? i} className="bg-white border border-indigo-100 rounded-lg px-3 py-2 text-sm">
                  {line.amountInBooks?.trim() && (
                    <span className="font-medium text-gray-900">
                      Amount (books): {formatCurrencyCellDisplay(line.amountInBooks)}
                    </span>
                  )}
                  {line.note && <p className="text-gray-700 mt-1">{line.note}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(record.msmeHasCertificate === true || record.msmeHasCertificate === false) && (
          <p className="text-gray-800">
            <span className="font-medium">MSME response: </span>
            {record.msmeHasCertificate === true ? 'Respondent indicated they have an MSME certificate.' : 'Respondent selected &ldquo;No&rdquo; (no certificate).'}
          </p>
        )}
        {msmeFiles.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Uploaded files (web)</p>
            <div className="flex flex-wrap gap-2">
              {msmeFiles.map((f) => (
                <a
                  key={f.path}
                  href={`/api/uploads/local-file?relative=${encodeURIComponent(f.path)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-indigo-200 rounded-lg text-indigo-700 text-sm hover:bg-indigo-50"
                >
                  {fileIcon('application/pdf')}
                  <span className="truncate max-w-[200px]">{f.originalName}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResponseTabContent({
  record,
  hasWeb,
  responses,
  responseAttachments,
  downloadingAttachment,
  onDownloadAttachment,
  formatDate,
  showFullThread,
  setShowFullThread,
  threadHtml,
  setThreadHtml,
  loadingThread,
  setLoadingThread,
}: {
  record: ConfirmationRecord;
  hasWeb: boolean;
  responses: ResponseEntry[];
  responseAttachments: AttachmentMeta[];
  downloadingAttachment: string | null;
  onDownloadAttachment: (att: AttachmentMeta, responseIndex: number) => void;
  formatDate: (d?: string | null) => string;
  showFullThread: boolean;
  setShowFullThread: (v: boolean) => void;
  threadHtml: string | null;
  setThreadHtml: (v: string | null) => void;
  loadingThread: boolean;
  setLoadingThread: (v: boolean) => void;
}) {
  const [activeResponseIdx, setActiveResponseIdx] = useState(0);
  const [threadPdfUrl, setThreadPdfUrl] = useState<string | null>(null);
  const resp = responses[activeResponseIdx];
  const hasEmailThread = responses.length > 0;
  const showBothChannels = hasWeb && hasEmailThread;
  const [responseChannel, setResponseChannel] = useState<'web' | 'email'>('web');

  useEffect(() => {
    if (hasWeb && !hasEmailThread) setResponseChannel('web');
    else if (!hasWeb && hasEmailThread) setResponseChannel('email');
    else if (hasWeb && hasEmailThread) setResponseChannel('web');
  }, [hasWeb, hasEmailThread, record.id]);

  if (!resp && !hasWeb) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4" />
        </svg>
        <p className="text-sm">No response received yet</p>
      </div>
    );
  }

  const respAttachments: AttachmentMeta[] = resp
    ? (() => {
        try {
          return JSON.parse(resp.attachmentsJson ?? '[]');
        } catch {
          return responseAttachments;
        }
      })()
    : [];

  const loadFullThread = async () => {
    setShowFullThread(true);
    if (!threadHtml && !threadPdfUrl) {
      setLoadingThread(true);
      try {
        const res = await fetch(`/api/confirmations/${record.id}/email-file?type=response`);
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('application/pdf')) {
          const blob = await res.blob();
          setThreadPdfUrl(URL.createObjectURL(blob));
        } else if (res.ok) {
          const d = await res.json();
          setThreadHtml(d.html);
        }
      } finally { setLoadingThread(false); }
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
      {showBothChannels && (
        <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-gray-200 bg-slate-50 flex-shrink-0">
          <button
            type="button"
            onClick={() => setResponseChannel('web')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              responseChannel === 'web'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-600 hover:bg-gray-200/80'
            }`}
          >
            Web response
          </button>
          <button
            type="button"
            onClick={() => setResponseChannel('email')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              responseChannel === 'email'
                ? 'bg-green-600 text-white'
                : 'text-gray-600 hover:bg-gray-200/80'
            }`}
          >
            Email (inbox)
          </button>
        </div>
      )}

      {hasWeb && (!showBothChannels || responseChannel === 'web') && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <WebConfirmationPanel record={record} formatDate={formatDate} />
        </div>
      )}

      {hasEmailThread && resp && (!showBothChannels || responseChannel === 'email') && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden border-t border-gray-100">
          <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-600 flex-shrink-0">
            Email reply (inbox thread)
          </div>
      {responses.length > 1 && (
        <div className="flex items-center gap-2 px-5 py-2 bg-gray-50 border-b border-gray-200">
          <span className="text-xs text-gray-500 font-medium">
            {responses.length} responses received:
          </span>
          {responses.map((r, i) => (
            <button
              key={r.messageId || i}
              onClick={() => setActiveResponseIdx(i)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                i === activeResponseIdx ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
              }`}
            >
              #{i + 1}
            </button>
          ))}
        </div>
      )}

      {/* Response header */}
      <div className="bg-green-600 text-white px-6 py-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            <span className="font-semibold text-lg">
              {responses.length > 1 ? `Response #${activeResponseIdx + 1} of ${responses.length}` : 'Reply Received'}
            </span>
          </div>
          {resp.filePath?.endsWith('.pdf') && (
            <a
              href={`/api/confirmations/${record.id}/email-file?type=response&format=eml&responseIndex=${activeResponseIdx}`}
              className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white border border-white/30 transition-colors"
            >
              Download .eml
            </a>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
          <div>
            <p className="text-green-200 text-xs font-medium uppercase tracking-wide">From</p>
            <p className="text-white font-medium mt-0.5">{resp.fromName || resp.fromEmail || '—'}</p>
            {resp.fromName && resp.fromEmail && <p className="text-green-200 text-xs mt-0.5">{resp.fromEmail}</p>}
          </div>
          <div>
            <p className="text-green-200 text-xs font-medium uppercase tracking-wide">Received At</p>
            <p className="text-white font-medium mt-0.5">{formatDate(resp.receivedAt)}</p>
          </div>
          {resp.subject && (
            <div className="col-span-2">
              <p className="text-green-200 text-xs font-medium uppercase tracking-wide">Subject</p>
              <p className="text-white mt-0.5">{resp.subject}</p>
            </div>
          )}
        </div>
      </div>

      {/* Attachments */}
      {respAttachments.length > 0 && (
        <div className="px-6 py-3 border-b border-gray-200 bg-amber-50">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
            {respAttachments.length} Attachment{respAttachments.length > 1 ? 's' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {respAttachments.map((att) => {
              const isPdf =
                (att.name || '').toLowerCase().endsWith('.pdf') ||
                (att.contentType || '').toLowerCase().includes('pdf');
              const openHref = `/api/confirmations/${record.id}/response-attachment?${new URLSearchParams({
                attachmentId: att.id,
                responseIndex: String(activeResponseIdx),
                inline: '1',
              }).toString()}`;
              return (
              <div key={att.id} className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => onDownloadAttachment(att, activeResponseIdx)}
                disabled={downloadingAttachment === att.id}
                className="flex items-center gap-2 px-3 py-2 bg-white border border-amber-200 rounded-lg text-sm hover:bg-amber-50 hover:border-amber-400 transition-colors disabled:opacity-60"
              >
                <span className="text-base leading-none">{fileIcon(att.contentType)}</span>
                <span className="max-w-[180px] truncate text-gray-700 font-medium">{att.name}</span>
                <span className="text-gray-400 text-xs flex-shrink-0">{formatFileSize(att.size)}</span>
                {downloadingAttachment === att.id ? (
                  <svg className="w-4 h-4 animate-spin text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                )}
              </button>
              {isPdf && (
                <a
                  href={openHref}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-amber-800 hover:underline px-2 py-1 rounded-lg border border-amber-200 bg-white"
                >
                  View PDF
                </a>
              )}
              </div>
            );})}
          </div>
        </div>
      )}

      {/* View toggle */}
      {resp.filePath && (resp.htmlBody || resp.body) && (
        <div className="flex items-center gap-2 px-6 py-2 bg-gray-50 border-b border-gray-200 text-xs">
          <span className="text-gray-500">View:</span>
          <button
            onClick={() => setShowFullThread(false)}
            className={`px-2.5 py-1 rounded-full font-medium transition-colors ${!showFullThread ? 'bg-green-600 text-white' : 'text-gray-500 hover:bg-gray-200'}`}
          >
            Reply only
          </button>
          <button
            onClick={loadFullThread}
            className={`px-2.5 py-1 rounded-full font-medium transition-colors ${showFullThread ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-200'}`}
          >
            Full email thread
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {showFullThread ? (
          loadingThread ? (
            <div className="flex items-center justify-center py-24">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
            </div>
          ) : threadPdfUrl ? (
            <embed src={threadPdfUrl} type="application/pdf" className="w-full h-full min-h-[400px]" title="Full Thread PDF" />
          ) : threadHtml ? (
            <iframe srcDoc={threadHtml} className="w-full h-full min-h-[400px]" title="Full Thread" sandbox="allow-same-origin" />
          ) : (
            <p className="text-sm text-gray-400 p-6">Could not load full thread.</p>
          )
        ) : resp.htmlBody ? (
          <iframe srcDoc={resp.htmlBody} className="w-full h-full min-h-[400px]" title="Response" sandbox="allow-same-origin" />
        ) : resp.body ? (
          <div className="px-6 py-5 text-gray-800 whitespace-pre-wrap leading-relaxed text-sm">{resp.body}</div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">Reply content not available</p>
            <p className="text-xs">Run &ldquo;Check Replies&rdquo; to re-capture.</p>
          </div>
        )}
      </div>
        </div>
      )}

      {hasWeb && !hasEmailThread && (
        <div className="flex flex-shrink-0 flex-col items-center justify-center px-6 text-center text-sm text-gray-500 py-6 border-t border-gray-100 bg-gray-50/80">
          <p>No email thread replies loaded for this confirmation yet.</p>
          <p className="mt-2 text-xs text-gray-400">Use Check Replies after the counterparty replies by email.</p>
        </div>
      )}
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</span>
      <p className="text-gray-700 mt-0.5 truncate" title={value}>{value}</p>
    </div>
  );
}

function TrailItem({
  type,
  label,
  date,
  subLabel,
  onView,
}: {
  type: 'conf' | 'followup' | 'response';
  label: string;
  date?: string | null;
  subLabel?: string;
  onView?: () => void;
}) {
  const cfg = {
    conf:     { icon: '📧', bg: 'bg-blue-50',   border: 'border-blue-200',  dot: 'bg-blue-500',  text: 'text-blue-700'  },
    followup: { icon: '🔁', bg: 'bg-amber-50',  border: 'border-amber-200', dot: 'bg-amber-500', text: 'text-amber-700' },
    response: { icon: '✅', bg: 'bg-green-50',  border: 'border-green-200', dot: 'bg-green-500', text: 'text-green-700' },
  }[type];

  const formatDate = (d?: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className={`flex items-start gap-3 px-3 py-3 rounded-lg border ${cfg.bg} ${cfg.border}`}>
      <div className={`w-8 h-8 rounded-full ${cfg.dot} flex items-center justify-center text-white text-sm flex-shrink-0 mt-0.5`}>
        {cfg.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${cfg.text}`}>{label}</p>
        {date && <p className="text-xs text-gray-500 mt-0.5">{formatDate(date)}</p>}
        {subLabel && <p className="text-xs text-gray-600 mt-0.5 truncate">{subLabel}</p>}
      </div>
      {onView && (
        <button
          onClick={onView}
          className="flex-shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-1 hover:bg-blue-50 rounded transition-colors"
        >
          View →
        </button>
      )}
    </div>
  );
}

function FolderPath({ label, path }: { label: string; path: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center gap-2 mt-1">
      <span className="text-blue-600 font-medium w-24 flex-shrink-0">{label}:</span>
      <span className="text-blue-800 font-mono truncate flex-1" title={path}>{path}</span>
      <button onClick={handleCopy} className="flex-shrink-0 text-blue-600 hover:text-blue-800 transition-colors" title="Copy path">
        {copied ? (
          <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
        )}
      </button>
    </div>
  );
}
