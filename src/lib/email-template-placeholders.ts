import type { ModuleKey } from '@/lib/module-types';

export type TemplatePurpose = 'initial' | 'followup';

export type EmailTemplatePlaceholderDef = {
  key: string;
  label: string;
  /** null = applies to every module */
  modules: ModuleKey[] | null;
  purposes: TemplatePurpose[];
};

export const EMAIL_TEMPLATE_PLACEHOLDER_DEFS: EmailTemplatePlaceholderDef[] = [
  {
    key: 'companyName',
    label: 'Your firm / organization',
    modules: null,
    purposes: ['initial', 'followup'],
  },
  {
    key: 'entityName',
    label: 'Counterparty / entity name',
    modules: null,
    purposes: ['initial', 'followup'],
  },
  {
    key: 'yearEnding',
    label: 'Year ending line',
    modules: null,
    purposes: ['initial', 'followup'],
  },
  {
    key: 'category',
    label: 'Confirmation category',
    modules: null,
    purposes: ['initial', 'followup'],
  },
  {
    key: 'balanceRequestHtml',
    label: 'Balance wording (HTML)',
    modules: null,
    purposes: ['initial', 'followup'],
  },
  {
    key: 'invoiceTableHtml',
    label: 'Invoice table (trade)',
    modules: ['trade_payable', 'trade_receivable'],
    purposes: ['initial', 'followup'],
  },
  {
    key: 'actionButtonsHtml',
    label: 'Action buttons (links)',
    modules: null,
    purposes: ['initial', 'followup'],
  },
  {
    key: 'originalSentDate',
    label: 'Original sent date (follow-up)',
    modules: null,
    purposes: ['followup'],
  },
];

export function placeholderSnippet(key: string): string {
  return `{{${key}}}`;
}

export function placeholdersForForm(
  moduleKey: ModuleKey | '' | null | undefined,
  purpose: TemplatePurpose
): EmailTemplatePlaceholderDef[] {
  return EMAIL_TEMPLATE_PLACEHOLDER_DEFS.filter((p) => {
    if (!p.purposes.includes(purpose)) return false;
    if (p.modules === null) return true;
    if (!moduleKey) return true;
    return p.modules.includes(moduleKey as ModuleKey);
  });
}
