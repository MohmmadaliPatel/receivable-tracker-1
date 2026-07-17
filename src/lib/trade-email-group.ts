import type { TradePayableConfirmation, TradeReceivableConfirmation } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatDrCrAmountDisplay, formatInrAmount, parseInrAmountString, debitCreditLabel } from '@/lib/inr-amount';
import { normalizeTradeCustId } from '@/lib/trade-composite-cust';

export type TradeModule = 'trade_payable' | 'trade_receivable';

export type TradeInvoiceLine = {
  documentDate?: string | null;
  documentNumber?: string | null;
  currencyValue?: string | null;
  bankName?: string | null;
};

/** After listing upload: set first row per customer/supplier code cluster as anchor (`emailThreadAnchorId` null), others point to anchor. */
export async function assignTradeEmailThreadAnchors(userId: string, mod: TradeModule): Promise<void> {
  const rows =
    mod === 'trade_payable'
      ? await prisma.tradePayableConfirmation.findMany({
          where: { userId },
          orderBy: [{ custId: 'asc' }, { createdAt: 'asc' }],
        })
      : await prisma.tradeReceivableConfirmation.findMany({
          where: { userId },
          orderBy: [{ custId: 'asc' }, { createdAt: 'asc' }],
        });

  /** Single-row cluster per empty custId — each is its own anchor. */
  function clusterKey(r: TradePayableConfirmation | TradeReceivableConfirmation): string {
    const c = r.custId?.trim();
    if (!c) return `__solo_${r.id}`;
    return normalizeTradeCustId(c);
  }

  const groups = new Map<string, (TradePayableConfirmation | TradeReceivableConfirmation)[]>();
  for (const r of rows) {
    const k = clusterKey(r);
    let g = groups.get(k);
    if (!g) {
      g = [];
      groups.set(k, g);
    }
    g.push(r);
  }

  for (const list of groups.values()) {
    if (list.length === 0) continue;
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const anchor = list[0];
    if (mod === 'trade_payable') {
      await prisma.tradePayableConfirmation.update({
        where: { id: anchor.id },
        data: { emailThreadAnchorId: null },
      });
      for (let i = 1; i < list.length; i++) {
        const line = list[i] as TradePayableConfirmation;
        if (line.emailThreadAnchorId !== anchor.id) {
          await prisma.tradePayableConfirmation.update({
            where: { id: line.id },
            data: { emailThreadAnchorId: anchor.id },
          });
        }
      }
    } else {
      await prisma.tradeReceivableConfirmation.update({
        where: { id: anchor.id },
        data: { emailThreadAnchorId: null },
      });
      for (let i = 1; i < list.length; i++) {
        const line = list[i] as TradeReceivableConfirmation;
        if (line.emailThreadAnchorId !== anchor.id) {
          await prisma.tradeReceivableConfirmation.update({
            where: { id: line.id },
            data: { emailThreadAnchorId: anchor.id },
          });
        }
      }
    }
  }
}

/** Resolve the email/JWT anchor row id for any line or anchor in a trade group */
export async function resolveTradeAnchorId(recordId: string, mod: TradeModule): Promise<string> {
  if (mod === 'trade_payable') {
    const r = await prisma.tradePayableConfirmation.findUnique({ where: { id: recordId } });
    if (!r) return recordId;
    return r.emailThreadAnchorId ?? r.id;
  }
  const r = await prisma.tradeReceivableConfirmation.findUnique({ where: { id: recordId } });
  if (!r) return recordId;
  return r.emailThreadAnchorId ?? r.id;
}

export type TradeGroupFiscalFilter = {
  reportingFiscalYears?: number[];
  reportingFiscalQuarters?: number[];
};

export async function loadTradeGroupRows(
  recordIdOrAnchorId: string,
  mod: TradeModule,
  fiscal?: TradeGroupFiscalFilter | null
): Promise<Array<TradePayableConfirmation | TradeReceivableConfirmation>> {
  const row =
    mod === 'trade_payable'
      ? await prisma.tradePayableConfirmation.findUnique({ where: { id: recordIdOrAnchorId } })
      : await prisma.tradeReceivableConfirmation.findUnique({ where: { id: recordIdOrAnchorId } });
  if (!row) return [];
  const resolvedAnchorId = row.emailThreadAnchorId ?? row.id;

  const anchor =
    mod === 'trade_payable'
      ? await prisma.tradePayableConfirmation.findUnique({ where: { id: resolvedAnchorId } })
      : await prisma.tradeReceivableConfirmation.findUnique({ where: { id: resolvedAnchorId } });
  if (!anchor) return [];

  const years = (fiscal?.reportingFiscalYears ?? []).filter((y) => Number.isFinite(y));
  const quarters = (fiscal?.reportingFiscalQuarters ?? []).filter((q) => q >= 1 && q <= 4);
  const fiscalWhere: {
    reportingFiscalYear?: number | { in: number[] };
    reportingFiscalQuarter?: number | { in: number[] };
  } = {};
  if (years.length === 1) fiscalWhere.reportingFiscalYear = years[0];
  else if (years.length > 1) fiscalWhere.reportingFiscalYear = { in: years };
  if (quarters.length === 1) fiscalWhere.reportingFiscalQuarter = quarters[0];
  else if (quarters.length > 1) fiscalWhere.reportingFiscalQuarter = { in: quarters };

  if (mod === 'trade_payable') {
    return prisma.tradePayableConfirmation.findMany({
      where: {
        OR: [{ id: resolvedAnchorId }, { emailThreadAnchorId: resolvedAnchorId }],
        userId: anchor.userId,
        ...fiscalWhere,
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }
  return prisma.tradeReceivableConfirmation.findMany({
    where: {
      OR: [{ id: resolvedAnchorId }, { emailThreadAnchorId: resolvedAnchorId }],
      userId: anchor.userId,
      ...fiscalWhere,
    },
    orderBy: [{ createdAt: 'asc' }],
  });
}

export function rowToInvoiceLine(
  r: TradePayableConfirmation | TradeReceivableConfirmation
): TradeInvoiceLine & { id: string } {
  return {
    id: r.id,
    documentDate: r.documentDate ?? null,
    documentNumber: r.documentNumber ?? null,
    currencyValue: r.currencyValue ?? null,
    bankName: r.bankName ?? null,
  };
}

export function buildTradeInvoiceTableHtml(lines: Array<TradeInvoiceLine & { id?: string }>): string {
  if (!lines.length) return '';
  let sumParsed = 0;
  let anyParsed = false;
  for (const l of lines) {
    const v = parseInrAmountString(l.currencyValue ?? null);
    if (v !== null) {
      sumParsed += v;
      anyParsed = true;
    }
  }
  const rows = lines
    .map((l) => {
      const { amountText, dcLabel } = formatDrCrAmountDisplay(l.currencyValue ?? null);
      return (
        `<tr><td style="padding:6px 10px;border:1px solid #ddd;">${escapeHtml(l.documentDate || '—')}</td>` +
        `<td style="padding:6px 10px;border:1px solid #ddd;">${escapeHtml(l.documentNumber || '—')}</td>` +
        `<td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${escapeHtml(amountText)}</td>` +
        `<td style="padding:6px 10px;border:1px solid #ddd;text-align:center;">${escapeHtml(dcLabel)}</td>` +
        `<td style="padding:6px 10px;border:1px solid #ddd;">${escapeHtml(l.bankName || '')}</td></tr>`
      );
    })
    .join('');
  const obAmount = anyParsed ? formatInrAmount(Math.abs(sumParsed)) : '—';
  const obDc = anyParsed ? debitCreditLabel(sumParsed) : '—';
  const footerRow =
    `<tr style="background:#f9fafb;font-weight:600;">` +
    `<td colspan="2" style="padding:8px 10px;border:1px solid #ddd;">Outstanding balance</td>` +
    `<td style="padding:8px 10px;border:1px solid #ddd;text-align:right;">${escapeHtml(obAmount)}</td>` +
    `<td style="padding:8px 10px;border:1px solid #ddd;text-align:center;">${escapeHtml(obDc)}</td>` +
    `<td style="padding:8px 10px;border:1px solid #ddd;"></td></tr>`;
  return `<div style="margin:16px 0;">
<table style="border-collapse:collapse;font-size:13px;width:100%;max-width:720px;">
<thead><tr style="background:#f3f4f6;color:#374151;">
<th style="padding:8px;border:1px solid #ddd;text-align:left;">Document Date</th>
<th style="padding:8px;border:1px solid #ddd;text-align:left;">Document Number</th>
<th style="padding:8px;border:1px solid #ddd;text-align:right;">Amount</th>
<th style="padding:8px;border:1px solid #ddd;text-align:center;">Dr / Cr</th>
<th style="padding:8px;border:1px solid #ddd;text-align:left;">G/L party / ref</th>
</tr></thead><tbody>${rows}${footerRow}</tbody></table></div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
