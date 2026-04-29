import { prisma } from './prisma';
import { GraphMailService, MailAttachment } from './graph-mail-service';
import { EmailConfigService } from './email-config-service';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  EmailConfig,
  MsmeConfirmation,
  TradePayableConfirmation,
  TradeReceivableConfirmation,
} from '@prisma/client';
import puppeteer, { Browser } from 'puppeteer';
import { signEmailActionToken } from './email-action-jwt';
import { getAppBaseUrl } from './app-base-url';
import {
  findConfirmationMetaById,
  getDistinctEntityNames,
  listUnifiedConfirmationRecords,
  patchConfirmationRaw,
  type ListConfirmationFilter,
  type ListUnifiedConfirmationResult,
} from '@/lib/confirmation-repository';
import type { ModuleKey } from '@/lib/module-types';
import { CATEGORY_TRADE_PAYABLES, CATEGORY_TRADE_RECEIVABLES } from '@/lib/module-types';
import {
  resolveTradeAnchorId,
  loadTradeGroupRows,
  buildTradeInvoiceTableHtml,
  rowToInvoiceLine,
} from '@/lib/trade-email-group';

type ConfirmationSourceRow = TradePayableConfirmation | TradeReceivableConfirmation | MsmeConfirmation;

/** Record + module for reply-check batching (IDs are unique across tables). */
type ConfirmationWithModule = { record: ConfirmationSourceRow; module: ModuleKey };
let _browser: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.connected) {
    _browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return _browser;
}

async function htmlToPdf(html: string, outputPath: string): Promise<void> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '40px', right: '40px', bottom: '40px', left: '40px' },
    });
  } finally {
    await page.close();
  }
}

export const CATEGORIES = [
  'Bank Balances and FDs',
  'Borrowings',
  'Trade Receivables',
  'Trade Payables',
  'Other Receivables',
  'Other Payables',
  'Confirm MSME',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CONFIRMATION_STATUSES = {
  NOT_SENT: 'not_sent',
  SENT: 'sent',
  FOLLOWUP_SENT: 'followup_sent',
  RESPONSE_RECEIVED: 'response_received',
} as const;

// Build the balance confirmation body text based on category
function getBalanceRequestText(category: string): string {
  if (category === 'Bank Balances and FDs') {
    return 'Balance of all Bank Accounts held with you (including Escrow accounts), Balance of all Fixed Deposits held with you (including details of any lien on such FDs), FD interest accrued, FD interest income and any other balances or other outstanding instruments such as Letter of Credits, Bank Guarantees, cash credits, etc as at and for the year ended 31 March 2026';
  }
  if (category === 'Borrowings') {
    return 'Amount of Borrowings principal outstanding and interest outstanding, if any as at 31 March 2026';
  }
  return 'Amount Outstanding as at 31 March 2026 as per your books whether receivable / payable by you';
}

export type EmailMagicLinkContext = { baseUrl: string; token: string };

function encodeTokenForUrl(token: string): string {
  return encodeURIComponent(token);
}

function tradeActionButtonsHtml(ctx: EmailMagicLinkContext): string {
  const t = encodeTokenForUrl(ctx.token);
  const base = ctx.baseUrl.replace(/\/$/, '');
  const confirmUrl = `${base}/respond/trade/confirm?token=${t}`;
  const queryUrl = `${base}/respond/trade/query?token=${t}`;
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px;border-collapse:collapse;">
  <tr>
    <td style="padding:8px;">
      <a href="${confirmUrl}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;border-radius:6px;font-size:14px;">Confirm</a>
    </td>
    <td style="padding:8px;">
      <a href="${queryUrl}" style="display:inline-block;padding:12px 18px;background:#ffffff;color:#1e40af;text-decoration:none;font-weight:600;border-radius:6px;font-size:14px;border:2px solid #2563eb;">Have query</a>
    </td>
  </tr>
</table>
<p style="font-size:12px;color:#6b7280;margin-top:12px;">If the buttons do not work, copy the link into your browser or reply to this email.</p>`;
}

function msmeActionButtonsHtml(ctx: EmailMagicLinkContext): string {
  const t = encodeTokenForUrl(ctx.token);
  const base = ctx.baseUrl.replace(/\/$/, '');
  const uploadUrl = `${base}/respond/msme/upload?token=${t}`;
  const declineUrl = `${base}/respond/msme/decline?token=${t}`;
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px;border-collapse:collapse;">
  <tr>
    <td style="padding:8px;">
      <a href="${uploadUrl}" style="display:inline-block;padding:12px 18px;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;border-radius:6px;font-size:14px;">I have MSME certificate</a>
    </td>
    <td style="padding:8px;">
      <a href="${declineUrl}" style="display:inline-block;padding:12px 18px;background:#ffffff;color:#4f46e5;text-decoration:none;font-weight:600;border-radius:6px;font-size:14px;border:2px solid #4f46e5;">No</a>
    </td>
  </tr>
</table>
<p style="font-size:12px;color:#6b7280;margin-top:12px;">If the buttons do not work, reply to this email.</p>`;
}

// Dedicated HTML for Confirm MSME (placeholder wording — customise as needed)
function generateConfirmMsmeEmailHtml(customerName: string, links?: EmailMagicLinkContext): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6; }
    .container { max-width: 700px; margin: 0 auto; padding: 20px; }
    .purpose { background: #f5f7ff; padding: 12px 16px; border-left: 4px solid #4f46e5; margin: 16px 0; }
    .signature { margin-top: 24px; color: #555; }
  </style>
</head>
<body>
  <div class="container">
    <p>Dear Sir/Ma'am,</p>
    <p>We hope this email finds you well.</p>
    <p>We write to request your confirmation regarding <strong>${customerName}</strong> in connection with our audit procedures under applicable MSME / regulatory reporting requirements for the year ended <strong>31 March 2026</strong>.</p>
    <div class="purpose">
      <p><strong>Purpose (placeholder):</strong> Please confirm the details or balances as may be applicable to your engagement with the client, and respond to this email at your earliest convenience. You may revise this paragraph to reflect your firm-specific MSME confirmation wording.</p>
    </div>
    <p>If any information in this communication requires correction or clarification, kindly reply indicating the same.</p>
    <p>Your prompt cooperation will assist us in completing our work in a timely manner.</p>
    ${links ? msmeActionButtonsHtml(links) : ''}
    <div class="signature">
      <p>Regards,<br>Audit Team,<br><strong>HSDR &amp; Associates</strong></p>
    </div>
  </div>
</body>
</html>`;
}

// Generate the email subject for a confirmation record
export function generateEmailSubject(entityName: string, category?: string | null): string {
  if (category === 'Confirm MSME') {
    return `${entityName}: MSME confirmation request (year ending 31 March 2026)`;
  }
  return `${entityName}: Balance Confirmations for the year ending 31 March 2026`;
}

// Generate the plain text email body
export function generateEmailBody(entityName: string, category: string): string {
  if (category === 'Confirm MSME') {
    return `Dear Sir/Ma'am,

We hope this email finds you well.

We write to request your confirmation regarding ${entityName} in connection with our audit procedures under applicable MSME / regulatory reporting requirements for the year ended 31 March 2026.

Purpose (placeholder): Please confirm the details or balances as may be applicable to your engagement with the client, and respond to this email at your earliest convenience. You may revise this paragraph to reflect your firm-specific MSME confirmation wording.

If any information in this communication requires correction or clarification, kindly reply indicating the same.

Your prompt cooperation will assist us in completing our work in a timely manner.

Regards,
Audit Team,
HSDR & Associates`;
  }
  const balanceRequest = getBalanceRequestText(category);
  return `Dear Sir/Ma'am,

We hope this email finds you well.

We are the statutory auditors of ${entityName} (hereinafter referred to as the "Client"). We are currently conducting the statutory audit of the Client's financial statements for the year ended 31 March 2026 in accordance with the Standards on Auditing issued by the Institute of Chartered Accountants of India (ICAI).

We are attaching herewith authority letter from the Client authorising us to obtain the confirmations from you.

As part of our audit procedures, we are required to obtain independent external confirmations of certain balances recorded in the books of account of the Client for the year ending 31 March 2026. In this regard, we kindly request you to confirm the following balance(s) with us:

${balanceRequest}

This request is being made solely for the purpose of our audit and does not constitute any acknowledgement or admission of liability on the part of either party. This is not a request for payment please do not send your remittance to the auditors. This is a standard procedure to ensure the accuracy of the financial records.

Your prompt response will assist us in completing our audit in a timely manner.

Regards,
Audit Team,
HSDR & Associates`;
}

// Generate the HTML email body
export function generateEmailHtml(
  entityName: string,
  category: string,
  links?: EmailMagicLinkContext,
  opts?: { invoiceTableHtml?: string }
): string {
  if (category === 'Confirm MSME') {
    return generateConfirmMsmeEmailHtml(entityName, links);
  }
  const balanceRequest = getBalanceRequestText(category);
  const invoiceTableHtml = opts?.invoiceTableHtml?.trim()
    ? opts.invoiceTableHtml
    : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6; }
    .container { max-width: 700px; margin: 0 auto; padding: 20px; }
    .balance-request { background: #f5f5f5; padding: 12px 16px; border-left: 4px solid #2563eb; margin: 16px 0; }
    .signature { margin-top: 24px; color: #555; }
  </style>
</head>
<body>
  <div class="container">
    <p>Dear Sir/Ma'am,</p>
    <p>We hope this email finds you well.</p>
    <p>We are the statutory auditors of <strong>${entityName}</strong> (hereinafter referred to as the "Client"). We are currently conducting the statutory audit of the Client's financial statements for the year ended 31 March 2026 in accordance with the Standards on Auditing issued by the Institute of Chartered Accountants of India (ICAI).</p>
    <p>We are attaching herewith authority letter from the Client authorising us to obtain the confirmations from you.</p>
    <p>As part of our audit procedures, we are required to obtain independent external confirmations of certain balances recorded in the books of account of the Client for the year ending 31 March 2026. In this regard, we kindly request you to confirm the following balance(s) with us:</p>
    <div class="balance-request">${balanceRequest}</div>
    ${invoiceTableHtml}
    <p>This request is being made solely for the purpose of our audit and does not constitute any acknowledgement or admission of liability on the part of either party. This is not a request for payment please do not send your remittance to the auditors. This is a standard procedure to ensure the accuracy of the financial records.</p>
    <p>Your prompt response will assist us in completing our audit in a timely manner.</p>
    ${
      links && (category === CATEGORY_TRADE_PAYABLES || category === CATEGORY_TRADE_RECEIVABLES)
        ? tradeActionButtonsHtml(links)
        : ''
    }
    <div class="signature">
      <p>Regards,<br>Audit Team,<br><strong>HSDR &amp; Associates</strong></p>
    </div>
  </div>
</body>
</html>`;
}

// Generate the reminder HTML email body
export function generateFollowupEmailHtml(
  entityName: string,
  category: string,
  originalSentAt: Date,
  links?: EmailMagicLinkContext,
  opts?: { invoiceTableHtml?: string }
): string {
  const invoiceTableHtml = opts?.invoiceTableHtml?.trim() ? opts.invoiceTableHtml : '';
  const originalDate = originalSentAt.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  if (category === 'Confirm MSME') {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6; }
    .container { max-width: 700px; margin: 0 auto; padding: 20px; }
    .highlight { background: #fff3cd; padding: 10px 14px; border-left: 4px solid #f59e0b; margin: 16px 0; }
    .signature { margin-top: 24px; color: #555; }
  </style>
</head>
<body>
  <div class="container">
    <p>Dear Sir/Ma'am,</p>
    <p>We hope this email finds you well.</p>
    <p>This is a reminder regarding our earlier email dated <strong>${originalDate}</strong> requesting MSME confirmation for <strong>${entityName}</strong> for the year ended 31 March 2026.</p>
    <div class="highlight">
      <strong>Category:</strong> ${category}<br>
      <strong>Customer / entity:</strong> ${entityName}
    </div>
    <p>We would appreciate a response at the earliest. If you have already replied, please disregard this reminder.</p>
    ${links ? msmeActionButtonsHtml(links) : ''}
    <div class="signature">
      <p>Regards,<br>Audit Team,<br><strong>HSDR &amp; Associates</strong></p>
    </div>
  </div>
</body>
</html>`;
  }
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6; }
    .container { max-width: 700px; margin: 0 auto; padding: 20px; }
    .highlight { background: #fff3cd; padding: 10px 14px; border-left: 4px solid #f59e0b; margin: 16px 0; }
    .signature { margin-top: 24px; color: #555; }
  </style>
</head>
<body>
  <div class="container">
    <p>Dear Sir/Ma'am,</p>
    <p>We hope this email finds you well.</p>
    <p>This is a gentle reminder regarding our earlier email dated <strong>${originalDate}</strong> requesting confirmation of balances for <strong>${entityName}</strong> for the year ended 31 March 2026.</p>
    <div class="highlight">
      <strong>Category:</strong> ${category}<br>
      <strong>Entity:</strong> ${entityName}
    </div>
    ${invoiceTableHtml}
    <p>We would appreciate if you could kindly provide the confirmation at the earliest, as it is critical for timely completion of the statutory audit.</p>
    <p>If you have already responded, please ignore this reminder. If you have any queries, please feel free to reach out to us.</p>
    ${
      links && (category === CATEGORY_TRADE_PAYABLES || category === CATEGORY_TRADE_RECEIVABLES)
        ? tradeActionButtonsHtml(links)
        : ''
    }
    <div class="signature">
      <p>Regards,<br>Audit Team,<br><strong>HSDR &amp; Associates</strong></p>
    </div>
  </div>
</body>
</html>`;
}

/** Server-only: same HTML body as outbound send/follow-up (invoice table + magic links when JWT is configured). */
export async function buildConfirmationPreviewHtml(opts: {
  recordId: string;
  mode?: 'send' | 'followup';
}): Promise<{ html: string; subject: string } | null> {
  const mode = opts.mode ?? 'send';
  const meta = await findConfirmationMetaById(opts.recordId);
  if (!meta) return null;

  let mod = meta.module;
  let anchorId = opts.recordId;
  let record = meta.record;

  if (mod === 'trade_payable' || mod === 'trade_receivable') {
    anchorId = await resolveTradeAnchorId(opts.recordId, mod);
    const am = await findConfirmationMetaById(anchorId);
    if (!am || (am.module !== 'trade_payable' && am.module !== 'trade_receivable')) return null;
    record = am.record;
    mod = am.module;
  }

  const jwtRecordId = mod === 'trade_payable' || mod === 'trade_receivable' ? anchorId : record.id;
  const baseSubject = generateEmailSubject(record.entityName, record.category);
  const subject = mode === 'followup' ? `Reminder: ${baseSubject}` : baseSubject;

  let invoiceTableHtml = '';
  if (mod === 'trade_payable' || mod === 'trade_receivable') {
    const grp = await loadTradeGroupRows(anchorId, mod);
    invoiceTableHtml = buildTradeInvoiceTableHtml(grp.map((r) => rowToInvoiceLine(r)));
  }

  const withMagic = async (): Promise<string> => {
    try {
      const newNonce = randomUUID();
      const baseUrl = getAppBaseUrl();
      const typ = mod === 'confirm_msme' ? 'msme' : 'trade';
      const token = await signEmailActionToken({
        recordId: jwtRecordId,
        nonce: newNonce,
        module: mod,
        typ,
      });
      const ctx: EmailMagicLinkContext = { baseUrl, token };
      if (mode === 'followup') {
        return generateFollowupEmailHtml(
          record.entityName,
          record.category,
          record.sentAt || new Date(),
          ctx,
          { invoiceTableHtml }
        );
      }
      return generateEmailHtml(record.entityName, record.category, ctx, { invoiceTableHtml });
    } catch (e) {
      console.warn('[Confirmation] Preview magic links disabled:', e);
      if (mode === 'followup') {
        return generateFollowupEmailHtml(
          record.entityName,
          record.category,
          record.sentAt || new Date(),
          undefined,
          { invoiceTableHtml }
        );
      }
      return generateEmailHtml(record.entityName, record.category, undefined, { invoiceTableHtml });
    }
  };

  const html = await withMagic();
  return { html, subject };
}

// Sanitize a string to be safe for use as a file/folder name
function sanitizePath(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

// Get the base path for email saves
export function getEmailBasePath(basePath: string = 'emails'): string {
  // If it's an absolute path, use it as-is; otherwise resolve relative to project root
  if (path.isAbsolute(basePath)) {
    return basePath;
  }
  return path.join(process.cwd(), basePath);
}

// Build folder paths for an entity+category+bank "thread" — all related emails share ONE folder.
// Structure: emails/{Entity}/{Category}/{BankOrParty}/
// This makes the connection between sent email and response immediately obvious in the file browser.
export function buildFolderPaths(entityName: string, category: string, basePath: string = 'emails', bankName?: string) {
  const base = getEmailBasePath(basePath);
  const entityFolder = sanitizePath(entityName);
  const categoryFolder = sanitizePath(category);
  const bankFolder = sanitizePath(bankName || 'General');
  // Single thread folder — all CONF / FU-N / RESP files live here
  const threadFolder = path.join(base, entityFolder, categoryFolder, bankFolder);
  const threadRelative = path.join(basePath, entityFolder, categoryFolder, bankFolder);
  return {
    sentFolder: threadFolder,
    responsesFolder: threadFolder,
    sentRelative: threadRelative,
    responsesRelative: threadRelative,
    threadFolder,
    threadRelative,
  };
}

// Ensure a directory exists
function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Generate a timestamp prefix for filenames
function timestampPrefix(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}_${hh}-${mm}`;
}

// Save the original confirmation / follow-up email as a PDF.
// All emails for the same entity+category+bank live in ONE folder so the thread is visible at a glance.
export async function saveEmailToSentFolder(
  entityName: string,
  category: string,
  bankName: string,
  subject: string,
  htmlContent: string,
  basePath: string = 'emails',
  label: string = 'CONF'   // CONF | FU-1 | FU-2 …
): Promise<{ filePath: string; relativePath: string; filenameBase: string }> {
  const { threadFolder, threadRelative } = buildFolderPaths(entityName, category, basePath, bankName);
  ensureDir(threadFolder);
  const ts = timestampPrefix();
  const filename = `${ts}_${label}.pdf`;
  const fullPath = path.join(threadFolder, filename);
  const fullHtml = wrapEmailHtml(subject, htmlContent, {
    entityName, category, bankName, type: 'sent', label,
  });
  await htmlToPdf(fullHtml, fullPath);
  return { filePath: fullPath, relativePath: path.join(threadRelative, filename), filenameBase: `${ts}_${label}` };
}

// Save a response as PDF — stored in the SAME folder as the sent email so connection is obvious.
export async function saveEmailToResponsesFolder(
  entityName: string,
  category: string,
  fromEmail: string,
  subject: string,
  htmlContent: string,
  basePath: string = 'emails',
  bankName: string = ''   // used to route into the correct thread folder
): Promise<{ filePath: string; relativePath: string; filenameBase: string }> {
  const { threadFolder, threadRelative } = buildFolderPaths(entityName, category, basePath, bankName);
  ensureDir(threadFolder);
  const safeSender = sanitizePath(fromEmail || 'response');
  const ts = timestampPrefix();
  const filenameBase = `${ts}_RESP_from-${safeSender}`;
  const filename = `${filenameBase}.pdf`;
  const fullPath = path.join(threadFolder, filename);
  const fullHtml = wrapEmailHtml(subject, htmlContent, {
    entityName, category, fromEmail, bankName, type: 'received',
  });
  await htmlToPdf(fullHtml, fullPath);
  return { filePath: fullPath, relativePath: path.join(threadRelative, filename), filenameBase };
}

// Wrap raw email body in a full print-ready HTML document
function wrapEmailHtml(
  subject: string,
  body: string,
  meta: {
    entityName: string;
    category: string;
    bankName?: string;
    fromEmail?: string;
    type: 'sent' | 'received';
    label?: string;
  }
): string {
  const typeLabel = meta.type === 'sent'
    ? (meta.label && meta.label !== 'CONF' ? `Reminder Email (${meta.label})` : 'Confirmation Email Sent')
    : 'Response Received';
  const typeColor = meta.type === 'sent'
    ? (meta.label && meta.label !== 'CONF' ? '#d97706' : '#2563eb')
    : '#16a34a';
  const threadNote = meta.type === 'received'
    ? `<div class="ref-banner">📂 All emails for this confirmation (sent + follow-ups + responses) are in this same folder.</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; background: #f8fafc; color: #111827; }
    .header { background: ${typeColor}; color: white; padding: 18px 28px; }
    .header h1 { margin: 0 0 6px; font-size: 17px; font-weight: 700; }
    .header .meta { font-size: 12px; opacity: 0.9; line-height: 1.6; }
    .ref-banner { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; padding: 8px 14px; font-size: 12px; margin: 12px 20px 0; border-radius: 6px; }
    .content { background: white; margin: 16px 20px 20px; padding: 24px 28px; border-radius: 8px; border: 1px solid #e5e7eb; }
    .subject-line { font-size: 15px; font-weight: 700; color: #111; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 2px solid #e5e7eb; }
    .print-btn { display: block; text-align: center; margin: 0 20px 20px; padding: 10px; background: #1d4ed8; color: white; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; font-family: inherit; }
    @media print {
      .print-btn { display: none; }
      body { background: white; }
      .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .content { border: none; margin: 0; padding: 16px; box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${typeLabel}</h1>
    <div class="meta">
      <strong>Entity:</strong> ${meta.entityName}&emsp;
      <strong>Category:</strong> ${meta.category}
      ${meta.bankName ? `&emsp;<strong>Bank/Party:</strong> ${meta.bankName}` : ''}
      ${meta.fromEmail ? `&emsp;<strong>From:</strong> ${meta.fromEmail}` : ''}
    </div>
  </div>
  ${threadNote}
  <div class="content">
    <div class="subject-line">📧 ${subject}</div>
    ${body}
  </div>
  <button class="print-btn" onclick="window.print()">🖨️ Save as PDF / Print</button>
</body>
</html>`;
}

/** Sibling .eml path for a saved confirmation PDF (same folder, same basename). */
export function emlPathBesidePdf(pdfFullPath: string): string {
  return pdfFullPath.replace(/\.pdf$/i, '.eml');
}

// Read a saved email file (for viewing in the UI)
export function readEmailFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export interface ConfirmationFilter extends ListConfirmationFilter {}

// List confirmation records with optional filters (shared workspace; module-scoped workspaces pass module)
export async function listConfirmationRecords(filter: ConfirmationFilter): Promise<ListUnifiedConfirmationResult> {
  const mod =
    filter.module != null
      ? Array.isArray(filter.module)
        ? filter.module
        : [filter.module]
      : undefined;
  return listUnifiedConfirmationRecords({
    userId: filter.userId,
    entityName: filter.entityName,
    category: filter.category,
    module: mod,
    status: filter.status,
    search: filter.search,
    responseChannel: filter.responseChannel,
    listMode: filter.listMode,
    page: filter.page,
    pageSize: filter.pageSize,
  });
}

export type { ListUnifiedConfirmationResult };

// Build file attachments array from a record's attachment path
function buildAttachments(attachmentPath: string | null, attachmentName: string | null): MailAttachment[] {
  if (!attachmentPath || !attachmentName) return [];
  try {
    const fileBuffer = fs.readFileSync(attachmentPath);
    const ext = path.extname(attachmentName).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    return [{
      name: attachmentName,
      contentBytes: fileBuffer.toString('base64'),
      contentType: contentTypeMap[ext] || 'application/octet-stream',
    }];
  } catch {
    console.warn(`[Confirmation] Could not read attachment at ${attachmentPath}`);
    return [];
  }
}

// After sending, search Sent Items to capture both the message ID and conversationId.
// conversationId is what we use to find replies later.
async function fetchSentMessage(
  config: EmailConfig,
  subject: string,
  _sentAfter: Date
): Promise<{ messageId: string; conversationId: string } | null> {
  try {
    const accessToken = await GraphMailService.getAccessToken(config);
    const userPrincipal = encodeURIComponent(config.fromEmail);

    // Use $search scoped to SentItems — avoids InefficientFilter errors that occur with
    // combined $filter on subject + sentDateTime.  $search cannot be combined with $orderby,
    // so we sort client-side.
    const searchTerm = subject.replace(/"/g, '').substring(0, 80);
    const url = `https://graph.microsoft.com/v1.0/users/${userPrincipal}/mailFolders/SentItems/messages`
      + `?$search="subject:${searchTerm}"`
      + `&$top=5&$select=id,conversationId,subject,sentDateTime`;

    console.log('[Confirmation] fetchSentMessage $search URL:', url);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[Confirmation] fetchSentMessage HTTP ${res.status}:`, errBody);
      return null;
    }

    const data = await res.json();
    const messages: any[] = data.value || [];

    // Pick the most recent one whose subject exactly matches
    const exactMatch = messages.find((m: any) => m.subject === subject);
    const msg = exactMatch || messages[0];

    if (!msg) {
      console.warn('[Confirmation] fetchSentMessage: no message found in SentItems for subject:', subject);
      return null;
    }

    console.log('[Confirmation] Captured sent message — id:', msg.id, 'conversationId:', msg.conversationId, 'subject:', msg.subject);
    return { messageId: msg.id, conversationId: msg.conversationId };
  } catch (err) {
    console.error('[Confirmation] fetchSentMessage exception:', err);
    return null;
  }
}

/** Best-effort: save Graph MIME next to the PDF (same basename, .eml). */
async function trySaveEmlBesidePdf(
  config: EmailConfig,
  messageId: string | undefined,
  pdfFullPath: string,
  filenameBase: string
): Promise<void> {
  if (!messageId?.trim()) return;
  const mime = await GraphMailService.getMessageMimeValue(config, messageId);
  if (!mime?.length) {
    console.warn('[Confirmation] No MIME returned for message id; EML not saved');
    return;
  }
  const emlPath = path.join(path.dirname(pdfFullPath), `${filenameBase}.eml`);
  try {
    fs.writeFileSync(emlPath, mime);
    console.log('[Confirmation] Saved EML:', emlPath);
  } catch (err) {
    console.warn('[Confirmation] Failed to write EML file:', err);
  }
}

// Send a confirmation email for a record
export async function sendConfirmation(
  recordId: string,
  userId: string,
  configId?: string,
  customEmailBody?: string
): Promise<{ success: boolean; error?: string }> {
  const meta = await findConfirmationMetaById(recordId);
  if (!meta) return { success: false, error: 'Record not found' };

  let mod = meta.module;
  let anchorId = recordId;
  let record = meta.record;

  if (mod === 'trade_payable' || mod === 'trade_receivable') {
    anchorId = await resolveTradeAnchorId(recordId, mod);
    const anchorMeta = await findConfirmationMetaById(anchorId);
    if (!anchorMeta || (anchorMeta.module !== 'trade_payable' && anchorMeta.module !== 'trade_receivable')) {
      return { success: false, error: 'Record not found' };
    }
    mod = anchorMeta.module;
    record = anchorMeta.record;
  }

  const config = configId
    ? await EmailConfigService.getConfigById(configId)
    : await EmailConfigService.getActiveConfig();
  if (!config) return { success: false, error: 'No active email configuration found' };

  const settings = await getOrCreateSettings(userId);
  const subject = generateEmailSubject(record.entityName, record.category);

  let invoiceTableHtml = '';
  if (mod === 'trade_payable' || mod === 'trade_receivable') {
    const grp = await loadTradeGroupRows(anchorId, mod);
    const lines = grp.map((r) => rowToInvoiceLine(r));
    invoiceTableHtml = buildTradeInvoiceTableHtml(lines);
  }

  const jwtRecordId = mod === 'trade_payable' || mod === 'trade_receivable' ? anchorId : record.id;

  let htmlBody: string;
  let nonceForSend: string | null = null;

  if (customEmailBody) {
    htmlBody = customEmailBody;
  } else {
    const canMagic = mod === 'trade_payable' || mod === 'trade_receivable' || mod === 'confirm_msme';
    if (canMagic) {
      try {
        const newNonce = randomUUID();
        const baseUrl = getAppBaseUrl();
        const typ = mod === 'confirm_msme' ? 'msme' : 'trade';
        const token = await signEmailActionToken({
          recordId: jwtRecordId,
          nonce: newNonce,
          module: mod,
          typ,
        });
        const ctx: EmailMagicLinkContext = { baseUrl, token };
        if (mod === 'confirm_msme') {
          htmlBody = generateConfirmMsmeEmailHtml(record.entityName, ctx);
        } else {
          htmlBody = generateEmailHtml(record.entityName, record.category, ctx, {
            invoiceTableHtml,
          });
        }
        nonceForSend = newNonce;
      } catch (e) {
        console.warn('[Confirmation] Email magic links disabled:', e);
        htmlBody =
          mod === 'trade_payable' || mod === 'trade_receivable'
            ? generateEmailHtml(record.entityName, record.category, undefined, { invoiceTableHtml })
            : generateEmailHtml(record.entityName, record.category);
      }
    } else {
      htmlBody = generateEmailHtml(record.entityName, record.category);
    }
  }

  const toList = record.emailTo.split(',').map((e) => e.trim()).filter(Boolean);
  const ccList = record.emailCc
    ? record.emailCc.split(',').map((e) => e.trim()).filter(Boolean)
    : undefined;

  const attachments = buildAttachments(record.attachmentPath, record.attachmentName);


  const sendTime = new Date();

  try {
    await GraphMailService.sendMail(config, {
      to: toList,
      subject,
      htmlBody,
      cc: ccList,
      attachments,
      saveToSentItems: true,
    });

    // Fetch the sent message details — we store conversationId in sentMessageId
    // so we can find all replies in the same thread later.
    await new Promise((r) => setTimeout(r, 2500));
    const sentMsg = await fetchSentMessage(config, subject, sendTime);

    // Save to folder with CONF prefix
    const { filePath, filenameBase } = await saveEmailToSentFolder(
      record.entityName,
      record.category,
      record.bankName || 'email',
      subject,
      htmlBody,
      settings.emailSaveBasePath,
      'CONF'
    );

    await trySaveEmlBesidePdf(config, sentMsg?.messageId, filePath, filenameBase);

    // Thread folder path (single folder for all emails in this confirmation)
    const { threadRelative } = buildFolderPaths(
      record.entityName,
      record.category,
      settings.emailSaveBasePath,
      record.bankName || undefined
    );

    // Store "messageId::conversationId" so we have both:
    //   - messageId → needed to send follow-up as a thread reply via createReply
    //   - conversationId → needed for reply detection (finding responses in inbox)
    const sentMessageIdValue = sentMsg
      ? `${sentMsg.messageId}::${sentMsg.conversationId}`
      : undefined;

    await patchConfirmationRaw(mod, jwtRecordId, {
      status: CONFIRMATION_STATUSES.SENT,
      sentAt: sendTime,
      sentMessageId: sentMessageIdValue,
      sentEmailFilePath: filePath,
      emailsSentFolderPath: threadRelative,
      responsesFolderPath: threadRelative,
      emailConfigId: config.id,
      ...(nonceForSend ? { emailActionNonce: nonceForSend, emailActionConsumedAt: null } : {}),
    });

    if (mod === 'trade_payable' || mod === 'trade_receivable') {
      const grp = await loadTradeGroupRows(anchorId, mod);
      const linePatchBase = {
        status: CONFIRMATION_STATUSES.SENT,
        sentAt: sendTime,
        sentEmailFilePath: filePath,
        emailsSentFolderPath: threadRelative,
        responsesFolderPath: threadRelative,
        emailConfigId: config.id,
      };
      for (const line of grp) {
        if (line.id === jwtRecordId) continue;
        await patchConfirmationRaw(mod, line.id, linePatchBase);
      }
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to send email' };
  }
}

// Send a follow-up email for a record — sent as a reply in the original email thread
export async function sendFollowup(
  recordId: string,
  userId: string,
  customEmailBody?: string
): Promise<{ success: boolean; error?: string }> {
  const meta = await findConfirmationMetaById(recordId);
  if (!meta) return { success: false, error: 'Record not found' };
  let record = meta.record;
  let mod = meta.module;
  let anchorId = recordId;

  if (mod === 'trade_payable' || mod === 'trade_receivable') {
    anchorId = await resolveTradeAnchorId(recordId, mod);
    const am = await findConfirmationMetaById(anchorId);
    if (!am || (am.module !== 'trade_payable' && am.module !== 'trade_receivable')) {
      return { success: false, error: 'Record not found' };
    }
    record = am.record;
    mod = am.module;
  }

  const jwtRecordId = mod === 'trade_payable' || mod === 'trade_receivable' ? anchorId : record.id;

  if (record.status === CONFIRMATION_STATUSES.RESPONSE_RECEIVED) {
    return { success: false, error: 'Response already received for this record' };
  }
  if (record.status === CONFIRMATION_STATUSES.NOT_SENT) {
    return { success: false, error: 'Original email has not been sent yet' };
  }

  const config = record.emailConfigId
    ? await EmailConfigService.getConfigById(record.emailConfigId)
    : await EmailConfigService.getActiveConfig();
  if (!config) return { success: false, error: 'No active email configuration found' };

  const settings = await getOrCreateSettings(userId);
  let invoiceTableHtml = '';
  if (mod === 'trade_payable' || mod === 'trade_receivable') {
    const grp = await loadTradeGroupRows(anchorId, mod);
    invoiceTableHtml = buildTradeInvoiceTableHtml(grp.map((r) => rowToInvoiceLine(r)));
  }

  let followupHtmlBody: string;
  let nonceForSend: string | null = null;

  if (customEmailBody) {
    followupHtmlBody = customEmailBody;
  } else {
    const canMagic = mod === 'trade_payable' || mod === 'trade_receivable' || mod === 'confirm_msme';
    if (canMagic) {
      try {
        const newNonce = randomUUID();
        const baseUrl = getAppBaseUrl();
        const typ = mod === 'confirm_msme' ? 'msme' : 'trade';
        const token = await signEmailActionToken({
          recordId: jwtRecordId,
          nonce: newNonce,
          module: mod,
          typ,
        });
        const ctx: EmailMagicLinkContext = { baseUrl, token };
        followupHtmlBody = generateFollowupEmailHtml(
          record.entityName,
          record.category,
          record.sentAt || new Date(),
          ctx,
          { invoiceTableHtml }
        );
        nonceForSend = newNonce;
      } catch (e) {
        console.warn('[Confirmation] Follow-up magic links disabled:', e);
        followupHtmlBody = generateFollowupEmailHtml(
          record.entityName,
          record.category,
          record.sentAt || new Date(),
          undefined,
          { invoiceTableHtml }
        );
      }
    } else {
      followupHtmlBody = generateFollowupEmailHtml(
        record.entityName,
        record.category,
        record.sentAt || new Date(),
        undefined,
        { invoiceTableHtml }
      );
    }
  }

  const toList = record.emailTo.split(',').map((e) => e.trim()).filter(Boolean);
  const ccList = record.emailCc
    ? record.emailCc.split(',').map((e) => e.trim()).filter(Boolean)
    : undefined;

  const attachments = buildAttachments(record.attachmentPath, record.attachmentName);
  const sendTime = new Date();

  // Determine the original message ID to reply to.
  // Prefer the most recent message: if a prior follow-up was sent, reply to that;
  // otherwise reply to the original confirmation.
  const priorParsed = parseSentMessageId(record.followupMessageId) ?? parseSentMessageId(record.sentMessageId);
  const replyToId = priorParsed?.messageId || null;

  try {
    if (replyToId) {
      // --- Reply in-thread via Graph createReply ---
      console.log(`[Confirmation] Sending follow-up as reply to message ${replyToId}`);
      await GraphMailService.replyToMessage(config, replyToId, {
        to: toList,
        htmlBody: followupHtmlBody,
        cc: ccList,
        attachments,
        saveToSentItems: true,
      });
    } else {
      // --- Fallback: new email if no prior message ID available ---
      const subject = `Reminder: ${generateEmailSubject(record.entityName, record.category)}`;
      console.log('[Confirmation] No prior message ID; sending follow-up as new email');
      await GraphMailService.sendMail(config, {
        to: toList,
        subject,
        htmlBody: followupHtmlBody,
        cc: ccList,
        attachments,
        saveToSentItems: true,
      });
    }

    // Capture the follow-up message ID/conversationId from Sent Items
    await new Promise((r) => setTimeout(r, 2500));
    const originalSubject = generateEmailSubject(record.entityName, record.category);
    const followupMsg = await fetchSentMessage(config, `RE: ${originalSubject}`, sendTime)
      ?? await fetchSentMessage(config, originalSubject, sendTime);

    const followupMessageIdValue = followupMsg
      ? `${followupMsg.messageId}::${followupMsg.conversationId}`
      : undefined;

    // Follow-up count (this send increments it)
    const newFollowupCount = (record.followupCount ?? 0) + 1;
    const fuLabel = `FU-${newFollowupCount}`;

    const { filePath, filenameBase } = await saveEmailToSentFolder(
      record.entityName,
      record.category,
      record.bankName || 'followup',
      `Reminder ${newFollowupCount}: ${originalSubject}`,
      followupHtmlBody,
      settings.emailSaveBasePath,
      fuLabel
    );

    await trySaveEmlBesidePdf(config, followupMsg?.messageId, filePath, filenameBase);

    // Append to followupsJson history
    const existingHistory: Array<{ sentAt: string; messageId: string | null; filePath: string; subject: string; followupNumber: number }> =
      record.followupsJson ? JSON.parse(record.followupsJson) : [];
    existingHistory.push({
      sentAt: sendTime.toISOString(),
      messageId: followupMessageIdValue ?? null,
      filePath,
      subject: `Reminder ${newFollowupCount}: ${originalSubject}`,
      followupNumber: newFollowupCount,
    });

    await patchConfirmationRaw(mod, jwtRecordId, {
      status: CONFIRMATION_STATUSES.FOLLOWUP_SENT,
      followupSentAt: sendTime,
      followupMessageId: followupMessageIdValue,
      followupEmailFilePath: filePath,
      followupCount: newFollowupCount,
      followupsJson: JSON.stringify(existingHistory),
      ...(nonceForSend ? { emailActionNonce: nonceForSend, emailActionConsumedAt: null } : {}),
    });

    if (mod === 'trade_payable' || mod === 'trade_receivable') {
      const grp = await loadTradeGroupRows(anchorId, mod);
      for (const line of grp) {
        if (line.id === jwtRecordId) continue;
        await patchConfirmationRaw(mod, line.id, {
          status: CONFIRMATION_STATUSES.FOLLOWUP_SENT,
          followupSentAt: sendTime,
        });
      }
    }

    console.log(`[Confirmation] Reminder #${newFollowupCount} sent for "${record.entityName}" — file: ${path.basename(filePath)}`);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to send reminder' };
  }
}

// Parse the combined "messageId::conversationId" stored in sentMessageId / followupMessageId
function parseSentMessageId(value: string | null): { messageId: string; conversationId: string } | null {
  if (!value) return null;
  if (value.includes('::')) {
    const [messageId, conversationId] = value.split('::');
    return { messageId, conversationId };
  }
  // Legacy: only conversationId was stored (no '::')
  return { messageId: '', conversationId: value };
}

// Determine whether a message was sent by the mailbox owner.
// Graph sometimes returns from.emailAddress.address as an internal X500 path
// (e.g. /O=EXCHANGELABS/OU=.../CN=HARDIK) instead of the SMTP address.
function isFromSelf(msg: any, fromEmail: string): boolean {
  const addr = (msg.from?.emailAddress?.address || '').toLowerCase();
  const name = (msg.from?.emailAddress?.name || '').toLowerCase();
  const self = fromEmail.toLowerCase();
  const selfLocal = self.split('@')[0];

  if (addr === self) return true;
  // X500 / internal routing address — check if it contains the mailbox local part
  if (addr.startsWith('/o=') && addr.includes(selfLocal)) return true;
  // Sometimes sender field is populated differently
  if (msg.sender?.emailAddress?.address?.toLowerCase() === self) return true;
  // Display name matching as last resort (e.g. "Hardik Savla" vs "hardiksavla@hsdr.in")
  if (name && name.includes(selfLocal)) return true;
  return false;
}

// Check Graph inbox for replies — all users' records; grouped by mailbox (emailConfigId / active config).
export async function checkRepliesForConfirmations(): Promise<number> {
  const where = {
    status: { in: [CONFIRMATION_STATUSES.SENT, CONFIRMATION_STATUSES.FOLLOWUP_SENT, CONFIRMATION_STATUSES.RESPONSE_RECEIVED] },
    sentAt: { not: null },
  };
  const whereTp = {
    ...where,
    emailThreadAnchorId: null as null,
  };
  const whereTr = {
    ...where,
    emailThreadAnchorId: null as null,
  };
  const [tp, tr, ms] = await Promise.all([
    prisma.tradePayableConfirmation.findMany({ where: whereTp }),
    prisma.tradeReceivableConfirmation.findMany({ where: whereTr }),
    prisma.msmeConfirmation.findMany({ where }),
  ]);
  const pendingRecords: ConfirmationWithModule[] = [
    ...tp.map((record) => ({ record, module: 'trade_payable' as ModuleKey })),
    ...tr.map((record) => ({ record, module: 'trade_receivable' as ModuleKey })),
    ...ms.map((record) => ({ record, module: 'confirm_msme' as ModuleKey })),
  ];

  if (pendingRecords.length === 0) {
    console.log('[Confirmation] No pending records to check for replies.');
    return 0;
  }

  const groups = new Map<string, { config: EmailConfig; bundle: ConfirmationWithModule[] }>();
  for (const item of pendingRecords) {
    const config = item.record.emailConfigId
      ? await EmailConfigService.getConfigById(item.record.emailConfigId)
      : await EmailConfigService.getActiveConfig();
    if (!config) {
      console.warn(`[Confirmation] No email config for record ${item.record.id}; skipping`);
      continue;
    }
    let g = groups.get(config.id);
    if (!g) {
      g = { config, bundle: [] };
      groups.set(config.id, g);
    }
    g.bundle.push(item);
  }

  if (groups.size === 0) return 0;

  let total = 0;
  for (const { config, bundle } of groups.values()) {
    total += await checkRepliesForMailboxGroup(config, bundle);
  }
  return total;
}

async function checkRepliesForMailboxGroup(config: EmailConfig, pendingItems: ConfirmationWithModule[]): Promise<number> {
  let repliesFound = 0;

  let accessToken: string;
  try {
    accessToken = await GraphMailService.getAccessToken(config);
  } catch (err) {
    console.error('[Confirmation] Failed to get access token for reply check:', err);
    return 0;
  }

  const userPrincipal = encodeURIComponent(config.fromEmail);

  const earliestSentAt = pendingItems.reduce((earliest, x) => {
    const d = x.record.sentAt ? new Date(x.record.sentAt) : new Date();
    return d < earliest ? d : earliest;
  }, new Date());

  const windowIso = earliestSentAt.toISOString();

  let inboxMessages: any[] = [];
  try {
    const inboxUrl = `https://graph.microsoft.com/v1.0/users/${userPrincipal}/mailFolders/Inbox/messages`
      + `?$filter=receivedDateTime ge ${windowIso}`
      + `&$orderby=receivedDateTime desc&$top=100`
      + `&$select=id,subject,from,sender,receivedDateTime,bodyPreview,hasAttachments,conversationId`;

    console.log('[Confirmation] Fetching inbox messages since', windowIso, 'for mailbox', config.fromEmail);
    const inboxRes = await fetch(inboxUrl, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (!inboxRes.ok) {
      const errBody = await inboxRes.text();
      console.error(`[Confirmation] Inbox fetch HTTP ${inboxRes.status}:`, errBody);
    } else {
      const inboxData = await inboxRes.json();
      inboxMessages = inboxData.value || [];
      console.log(`[Confirmation] Found ${inboxMessages.length} inbox message(s) since ${windowIso}`);

      inboxMessages.slice(0, 5).forEach((m: any, i: number) => {
        console.log(`  [${i}] subject="${m.subject}" from="${m.from?.emailAddress?.address}" convId=${m.conversationId?.substring(0, 20)}...`);
      });
    }
  } catch (err) {
    console.error('[Confirmation] Error fetching inbox messages:', err);
  }

  for (const { record, module } of pendingItems) {
    try {
      const settings = await getOrCreateSettings(record.userId);
      const sentAt = record.sentAt ? new Date(record.sentAt) : new Date(0);
      const baseSubject = generateEmailSubject(record.entityName, record.category);
      const entityNameLower = record.entityName.toLowerCase();

      // Build set of already-captured response message IDs to avoid duplicates
      const capturedIds = new Set<string>();
      if (record.responseMessageId) capturedIds.add(record.responseMessageId);
      try {
        const existing: Array<{ messageId: string }> = JSON.parse(record.responsesJson ?? '[]');
        existing.forEach((r) => r.messageId && capturedIds.add(r.messageId));
      } catch { /* ignore */ }

      // Common filter: must be after sentAt, must NOT be from self, must not be already captured.
      const isValidReply = (m: any) => {
        if (new Date(m.receivedDateTime) <= sentAt) return false;
        if (isFromSelf(m, config.fromEmail)) return false;
        if (capturedIds.has(m.id)) return false;
        return true;
      };

      const sortNewestFirst = (a: any, b: any) =>
        new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime();

      let replyMsg: any = null;

      // ---------- Strategy 1: match by conversationId ----------
      // sentMessageId stores "messageId::conversationId" (or legacy: just conversationId)
      const sentParsed = parseSentMessageId(record.sentMessageId);
      if (sentParsed?.conversationId) {
        const conversationId = sentParsed.conversationId;
        const matches = inboxMessages.filter((m: any) => m.conversationId === conversationId && isValidReply(m));
        matches.sort(sortNewestFirst);
        if (matches.length > 0) {
          replyMsg = matches[0];
          console.log(`[Confirmation] Strategy 1 hit for "${record.entityName}": conversationId match`);
        }
      }

      // ---------- Strategy 2: match by subject keyword in pre-fetched inbox ----------
      if (!replyMsg) {
        const matches = inboxMessages.filter((m: any) => {
          const subj = (m.subject || '').toLowerCase();
          return (subj.includes(entityNameLower) || subj.includes(baseSubject.toLowerCase())) && isValidReply(m);
        });
        matches.sort(sortNewestFirst);
        if (matches.length > 0) {
          replyMsg = matches[0];
          console.log(`[Confirmation] Strategy 2 hit for "${record.entityName}": inbox subject match from ${replyMsg.from?.emailAddress?.address}`);
        }
      }

      // ---------- Strategy 3: $search scoped to INBOX ONLY ----------
      // $search cannot use $orderby — we sort client-side.
      if (!replyMsg) {
        const searchKeyword = record.entityName.replace(/"/g, '').substring(0, 50);
        // Scope to Inbox folder specifically to avoid matching Sent Items
        const searchUrl = `https://graph.microsoft.com/v1.0/users/${userPrincipal}/mailFolders/Inbox/messages`
          + `?$search="subject:${searchKeyword}"`
          + `&$top=25`
          + `&$select=id,subject,from,sender,receivedDateTime,bodyPreview,hasAttachments,conversationId`;

        console.log(`[Confirmation] Strategy 3 $search Inbox for "${record.entityName}"`);
        const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });

        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const candidates = (searchData.value || []).filter(isValidReply);
          candidates.sort(sortNewestFirst);
          if (candidates.length > 0) {
            replyMsg = candidates[0];
            console.log(`[Confirmation] Strategy 3 hit for "${record.entityName}" from ${replyMsg.from?.emailAddress?.address}`);
          }
        } else {
          const errBody = await searchRes.text();
          console.warn(`[Confirmation] Strategy 3 HTTP ${searchRes.status}:`, errBody);
        }
      }

      if (!replyMsg) {
        console.log(`[Confirmation] No reply found for "${record.entityName}" / ${record.category}`);
        continue;
      }

      // ---------- Fetch full message details: body, uniqueBody, attachments ----------
      let bodyContent = replyMsg.bodyPreview || '';       // full thread body (saved to file)
      let bodyContentType = 'text';
      let uniqueBodyHtml: string | undefined;             // reply-only HTML (shown inline in UI)
      let uniqueBodyText: string | undefined;             // reply-only plain text
      let hasAttachments = !!replyMsg.hasAttachments;
      let attachmentsJson: string | undefined;

      // The sender SMTP address — resolve from the full message (may differ from pre-fetch)
      let fromEmail = replyMsg.from?.emailAddress?.address || '';
      let fromName = replyMsg.from?.emailAddress?.name || '';

      try {
        const fullMsgRes = await fetch(
          `https://graph.microsoft.com/v1.0/users/${userPrincipal}/messages/${replyMsg.id}?$select=body,uniqueBody,from,sender,subject,receivedDateTime,hasAttachments`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (fullMsgRes.ok) {
          const fullMsg = await fullMsgRes.json();
          hasAttachments = !!fullMsg.hasAttachments;

          // Prefer sender.emailAddress (SMTP) over from.emailAddress (which can be X500)
          const senderAddr = fullMsg.sender?.emailAddress?.address || '';
          const senderName = fullMsg.sender?.emailAddress?.name || '';
          const fromAddr = fullMsg.from?.emailAddress?.address || '';
          const fromDisplayName = fullMsg.from?.emailAddress?.name || '';

          if (senderAddr && senderAddr.includes('@')) {
            fromEmail = senderAddr;
            fromName = senderName || fromDisplayName;
          } else if (fromAddr && fromAddr.includes('@')) {
            fromEmail = fromAddr;
            fromName = fromDisplayName;
          } else {
            fromEmail = senderAddr || fromAddr;
            fromName = senderName || fromDisplayName;
          }

          console.log(`[Confirmation] Full message from: ${fromName} <${fromEmail}>`);

          // Full body (thread) → saved to disk so the file has the complete email trail
          const fullBody = fullMsg.body?.content?.trim();
          if (fullBody) {
            bodyContent = fullBody;
            bodyContentType = fullMsg.body?.contentType || 'html';
          }

          // uniqueBody (reply-only text) → stored in DB for the inline Response tab display
          const uniqueContent = fullMsg.uniqueBody?.content?.trim();
          if (uniqueContent && uniqueContent.length > 0) {
            const uIsHtml = (fullMsg.uniqueBody?.contentType || '').toLowerCase() === 'html';
            if (uIsHtml) uniqueBodyHtml = uniqueContent;
            else uniqueBodyText = uniqueContent;
          }
        }
      } catch (err) {
        console.warn('[Confirmation] Failed to fetch full message body:', err);
      }

      // ---------- Fetch attachment metadata & download files to thread folder ----------
      if (hasAttachments) {
        try {
          const attRes = await fetch(
            `https://graph.microsoft.com/v1.0/users/${userPrincipal}/messages/${replyMsg.id}/attachments`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (attRes.ok) {
            const attData = await attRes.json();
            const { threadFolder } = buildFolderPaths(record.entityName, record.category, settings.emailSaveBasePath, record.bankName || undefined);
            const attachDir = path.join(threadFolder, 'attachments');
            ensureDir(attachDir);

            const list = (attData.value || []).map((a: any) => {
              // Save file-type attachments to disk
              if (a.contentBytes && a.name) {
                try {
                  const safeName = sanitizePath(a.name);
                  const attPath = path.join(attachDir, `${timestampPrefix()}_RESP_${safeName}`);
                  fs.writeFileSync(attPath, Buffer.from(a.contentBytes, 'base64'));
                  return { id: a.id, name: a.name, contentType: a.contentType, size: a.size, savedPath: attPath };
                } catch { /* best-effort */ }
              }
              return { id: a.id, name: a.name, contentType: a.contentType, size: a.size };
            });
            attachmentsJson = JSON.stringify(list);
          }
        } catch {
          // best-effort
        }
      }

      // ---------- Save to folder and update DB ----------
      // Response goes into the SAME thread folder as the confirmation email:
      //   emails/{Entity}/{Category}/{BankName}/
      // This makes the connection obvious when browsing files.
      const { filePath, filenameBase } = await saveEmailToResponsesFolder(
        record.entityName, record.category,
        fromEmail || 'unknown', replyMsg.subject || '',
        bodyContent, settings.emailSaveBasePath,
        record.bankName || ''
      );

      await trySaveEmlBesidePdf(config, replyMsg.id, filePath, filenameBase);

      const isBodyHtml = bodyContentType.toLowerCase() === 'html';

      // For DB inline display: prefer uniqueBody if captured, else fall back to full body
      const dbHtml = uniqueBodyHtml ?? (isBodyHtml ? bodyContent : undefined);
      const dbText = uniqueBodyText ?? (!isBodyHtml ? bodyContent : undefined);

      // Append to responsesJson history so multiple replies are all captured
      const existingResponses: Array<Record<string, unknown>> =
        record.responsesJson ? JSON.parse(record.responsesJson) : [];
      existingResponses.push({
        receivedAt: replyMsg.receivedDateTime,
        messageId: replyMsg.id,
        subject: replyMsg.subject,
        fromEmail,
        fromName,
        htmlBody: dbHtml ?? null,
        body: dbText ?? null,
        filePath,
        hasAttachments,
        attachmentsJson: attachmentsJson ?? null,
      });

      await patchConfirmationRaw(module, record.id, {
        status: CONFIRMATION_STATUSES.RESPONSE_RECEIVED,
        responseReceivedAt: new Date(replyMsg.receivedDateTime),
        responseMessageId: replyMsg.id,
        responseSubject: replyMsg.subject,
        responseBody: dbText ?? null,
        responseHtmlBody: dbHtml ?? null,
        responseFromEmail: fromEmail,
        responseFromName: fromName,
        responseEmailFilePath: filePath,
        responseHasAttachments: hasAttachments,
        responseAttachmentsJson: attachmentsJson,
        responsesJson: JSON.stringify(existingResponses),
      });

      repliesFound++;
      console.log(`[Confirmation] Reply #${existingResponses.length} captured for "${record.entityName}" / ${record.category} from ${fromName} <${fromEmail}>`);
    } catch (err) {
      console.error(`[Confirmation] Error checking reply for record ${record.id}:`, err);
    }
  }

  return repliesFound;
}

// Get or create AppSettings for a user
export async function getOrCreateSettings(userId: string) {
  let settings = await prisma.appSettings.findUnique({ where: { userId } });
  if (!settings) {
    settings = await prisma.appSettings.create({
      data: { userId },
    });
  }
  return settings;
}

// Update AppSettings for a user
export async function updateSettings(userId: string, data: {
  autoReplyCheck?: boolean;
  replyCheckIntervalMinutes?: number;
  emailSaveBasePath?: string;
}) {
  return prisma.appSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

// Diagnostic: fetch raw inbox messages visible to the reply-check logic
export async function debugInboxScan(since?: string): Promise<{
  error?: string;
  pendingRecords: Array<{ id: string; entityName: string; status: string; sentAt: string | null; sentMessageId: string | null }>;
  inboxMessages: Array<{ id: string; subject: string; from: string; receivedDateTime: string; conversationId: string }>;
}> {
  const where = {
    status: { in: [CONFIRMATION_STATUSES.SENT, CONFIRMATION_STATUSES.FOLLOWUP_SENT] },
    sentAt: { not: null },
  };
  const sel = { id: true, entityName: true, status: true, sentAt: true, sentMessageId: true } as const;
  const [tp, tr, ms] = await Promise.all([
    prisma.tradePayableConfirmation.findMany({ where, select: sel }),
    prisma.tradeReceivableConfirmation.findMany({ where, select: sel }),
    prisma.msmeConfirmation.findMany({ where, select: sel }),
  ]);
  const pendingRecords = [...tp, ...tr, ...ms];

  const config = await EmailConfigService.getActiveConfig();
  if (!config) return { error: 'No active email config', pendingRecords: pendingRecords.map(r => ({ ...r, sentAt: r.sentAt?.toISOString() ?? null })), inboxMessages: [] };

  let accessToken: string;
  try {
    accessToken = await GraphMailService.getAccessToken(config);
  } catch (err: any) {
    return { error: `Token error: ${err.message}`, pendingRecords: pendingRecords.map(r => ({ ...r, sentAt: r.sentAt?.toISOString() ?? null })), inboxMessages: [] };
  }

  const windowIso = since || (pendingRecords.reduce((earliest, r) => {
    const d = r.sentAt ? new Date(r.sentAt) : new Date();
    return d < earliest ? d : earliest;
  }, new Date())).toISOString();

  const inboxUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.fromEmail)}/mailFolders/Inbox/messages`
    + `?$filter=receivedDateTime ge ${windowIso}`
    + `&$orderby=receivedDateTime desc&$top=50`
    + `&$select=id,subject,from,sender,receivedDateTime,conversationId`;

  const res = await fetch(inboxUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const errBody = await res.text();
    return { error: `Inbox fetch ${res.status}: ${errBody}`, pendingRecords: pendingRecords.map(r => ({ ...r, sentAt: r.sentAt?.toISOString() ?? null })), inboxMessages: [] };
  }

  const data = await res.json();
  const inboxMessages = (data.value || []).map((m: any) => ({
    id: m.id,
    subject: m.subject,
    from: m.from?.emailAddress?.address || '',
    fromName: m.from?.emailAddress?.name || '',
    sender: m.sender?.emailAddress?.address || '',
    receivedDateTime: m.receivedDateTime,
    conversationId: m.conversationId,
  }));

  return {
    pendingRecords: pendingRecords.map(r => ({ ...r, sentAt: r.sentAt?.toISOString() ?? null })),
    inboxMessages,
  };
}

// Distinct entity names across the shared workspace (optionally scoped by module)
export async function getEntityNames(module?: string, userId?: string): Promise<string[]> {
  if (!module || !['trade_payable', 'trade_receivable', 'confirm_msme'].includes(module)) {
    return getDistinctEntityNames(undefined, userId);
  }
  return getDistinctEntityNames(module as ModuleKey, userId);
}
