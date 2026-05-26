'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ModuleKey } from '@/lib/module-types';
import { placeholdersForForm, placeholderSnippet } from '@/lib/email-template-placeholders';
import { EmailHtmlEditor, type EmailHtmlEditorHandle } from '@/components/EmailHtmlEditor';

const API_BASE = '/api/masters/email-body-templates';

type TemplateRow = {
  id: string;
  name: string;
  slug: string;
  moduleKey: string | null;
  category: string | null;
  purpose: string;
  subjectTemplate: string | null;
  htmlBody: string;
  plainBody: string | null;
  isDefault: boolean;
};

const MODULE_OPTIONS = [
  { value: '', label: 'Any module' },
  { value: 'trade_payable', label: 'Trade payables' },
  { value: 'trade_receivable', label: 'Trade receivables' },
  { value: 'confirm_msme', label: 'Confirm MSME' },
];

const CATEGORY_SUGGESTIONS = [
  '',
  'Trade Payables',
  'Trade Receivables',
  'Confirm MSME',
  'Bank Balances and FDs',
  'Borrowings',
];

function PlaceholderChips({
  defs,
  variant,
  onInsert,
}: {
  defs: ReturnType<typeof placeholdersForForm>;
  variant: 'subject' | 'body';
  onInsert: (snippet: string) => void;
}) {
  const subjectCls =
    'text-[11px] px-2 py-1 rounded-full bg-violet-50 text-violet-900 border border-violet-200 hover:bg-violet-100/80';
  const bodyCls =
    'text-[11px] px-2 py-1 rounded-full bg-neutral-100 text-neutral-800 border border-neutral-200 hover:bg-neutral-200/80';
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {defs.map((p) => (
        <button
          key={`${variant}-${p.key}`}
          type="button"
          onClick={() => onInsert(placeholderSnippet(p.key))}
          className={variant === 'subject' ? subjectCls : bodyCls}
          title={p.label}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export default function EmailTemplatesClient() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [creating, setCreating] = useState(false);

  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formModule, setFormModule] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formPurpose, setFormPurpose] = useState<'initial' | 'followup'>('initial');
  const [formSubject, setFormSubject] = useState('');
  const [formHtml, setFormHtml] = useState('');
  const [formDefault, setFormDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showRawHtml, setShowRawHtml] = useState(false);

  const subjectInputRef = useRef<HTMLInputElement>(null);
  const bodyEditorRef = useRef<EmailHtmlEditorHandle>(null);

  const moduleKeyForPlaceholders: ModuleKey | '' =
    formModule === 'trade_payable' || formModule === 'trade_receivable' || formModule === 'confirm_msme'
      ? formModule
      : '';

  const placeholderDefs = placeholdersForForm(moduleKeyForPlaceholders || null, formPurpose);
  const formOpen = creating || !!editing;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API_BASE);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setTemplates(data.templates || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resetForm = () => {
    setFormName('');
    setFormSlug('');
    setFormModule('');
    setFormCategory('');
    setFormPurpose('initial');
    setFormSubject('');
    setFormHtml('');
    setFormDefault(false);
    setEditing(null);
    setCreating(false);
    setShowRawHtml(false);
  };

  const insertInSubject = (snippet: string) => {
    const el = subjectInputRef.current;
    if (!el) {
      setFormSubject((s) => s + snippet);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const v = formSubject;
    const next = v.slice(0, start) + snippet + v.slice(end);
    setFormSubject(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const openCreate = () => {
    resetForm();
    setCreating(true);
    setFormHtml(
      `<p>Dear Sir/Ma'am,</p>
<p>We write regarding <strong>{{entityName}}</strong> for the year ended <strong>{{yearEnding}}</strong>.</p>
<p>{{balanceRequestHtml}}</p>
{{invoiceTableHtml}}
{{actionButtonsHtml}}
<p>Regards,<br>{{companyName}}</p>`
    );
  };

  const openEdit = (t: TemplateRow) => {
    setCreating(false);
    setEditing(t);
    setFormName(t.name);
    setFormSlug(t.slug);
    setFormModule(t.moduleKey || '');
    setFormCategory(t.category || '');
    setFormPurpose(t.purpose === 'followup' ? 'followup' : 'initial');
    setFormSubject(t.subjectTemplate || '');
    setFormHtml(t.htmlBody);
    setFormDefault(t.isDefault);
    setShowRawHtml(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        const res = await fetch(`${API_BASE}/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formName,
            slug: formSlug || undefined,
            moduleKey: formModule || null,
            category: formCategory || null,
            purpose: formPurpose,
            subjectTemplate: formSubject || null,
            htmlBody: formHtml,
            isDefault: formDefault,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
      } else {
        const res = await fetch(API_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formName,
            slug: formSlug || undefined,
            moduleKey: formModule || null,
            category: formCategory || null,
            purpose: formPurpose,
            subjectTemplate: formSubject || null,
            htmlBody: formHtml,
            isDefault: formDefault,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Create failed');
      }
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this template?')) return;
    setError(null);
    const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error || 'Delete failed');
      return;
    }
    resetForm();
    await load();
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/masters/vendor" className="text-sm text-neutral-800 hover:underline">
              Masters
            </Link>
            <span className="text-gray-300">/</span>
            <span className="text-sm text-gray-500">Email templates</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Email body templates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Rich text is stored as HTML. Set your firm name under Settings for{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">{'{{companyName}}'}</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="px-4 py-2 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
        >
          New template
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm">
          <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-600">
            Templates ({templates.length})
          </div>
          <ul className="divide-y divide-gray-100">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => openEdit(t)}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 transition-colors"
                >
                  <span className="font-medium text-gray-900">{t.name}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    {t.purpose} · {t.moduleKey || 'any module'}
                    {t.category ? ` · ${t.category}` : ''}
                    {t.isDefault ? ' · default' : ''}
                  </span>
                </button>
              </li>
            ))}
            {templates.length === 0 && (
              <li className="px-4 py-12 text-center text-sm text-gray-400">
                No templates yet. Click &quot;New template&quot; to create one.
              </li>
            )}
          </ul>
        </div>
      )}

      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!saving) resetForm();
          }}
          role="presentation"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-form-title"
          >
            <div className="px-6 py-4 border-b border-gray-200 flex-shrink-0 flex items-center justify-between">
              <h2 id="template-form-title" className="text-lg font-semibold text-gray-900">
                {editing ? 'Edit template' : 'New template'}
              </h2>
              <button
                type="button"
                onClick={() => !saving && resetForm()}
                disabled={saving}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg disabled:opacity-50"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              <label className="block text-xs text-gray-500">
                Name
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="mt-0.5 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-gray-500">
                Slug (unique)
                <input
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value)}
                  placeholder="auto from name if empty"
                  className="mt-0.5 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-gray-500">
                  Module
                  <select
                    value={formModule}
                    onChange={(e) => setFormModule(e.target.value)}
                    className="mt-0.5 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    {MODULE_OPTIONS.map((o) => (
                      <option key={o.value || 'any'} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-gray-500">
                  Purpose
                  <select
                    value={formPurpose}
                    onChange={(e) => setFormPurpose(e.target.value as 'initial' | 'followup')}
                    className="mt-0.5 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="initial">Initial send</option>
                    <option value="followup">Follow-up</option>
                  </select>
                </label>
              </div>
              <label className="block text-xs text-gray-500">
                Category (optional)
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="mt-0.5 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  {CATEGORY_SUGGESTIONS.map((c) => (
                    <option key={c || 'none'} value={c}>
                      {c || '(none)'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-gray-500">
                Subject template (optional)
                <input
                  ref={subjectInputRef}
                  value={formSubject}
                  onChange={(e) => setFormSubject(e.target.value)}
                  placeholder="{{entityName}}: …"
                  className="mt-0.5 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
                <PlaceholderChips
                  defs={placeholderDefs}
                  variant="subject"
                  onInsert={insertInSubject}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={formDefault}
                  onChange={(e) => setFormDefault(e.target.checked)}
                />
                Default for module + purpose (when category omitted)
              </label>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">Message body</span>
                  <button
                    type="button"
                    onClick={() => setShowRawHtml((v) => !v)}
                    className="text-xs text-neutral-700 hover:underline"
                  >
                    {showRawHtml ? 'Visual editor' : 'Edit raw HTML'}
                  </button>
                </div>
                <PlaceholderChips
                  defs={placeholderDefs}
                  variant="body"
                  onInsert={(s) => bodyEditorRef.current?.insertAtCursor(s)}
                />
                {showRawHtml ? (
                  <textarea
                    value={formHtml}
                    onChange={(e) => setFormHtml(e.target.value)}
                    rows={12}
                    className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                ) : (
                  <div className="mt-2">
                    <EmailHtmlEditor ref={bodyEditorRef} value={formHtml} onChange={setFormHtml} disabled={saving} />
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex-shrink-0 flex flex-wrap gap-2 bg-gray-50/80 rounded-b-2xl">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={resetForm}
                className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700"
              >
                Cancel
              </button>
              {editing && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleDelete(editing.id)}
                  className="px-4 py-2 rounded-lg border border-red-200 text-red-700 text-sm ml-auto"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
