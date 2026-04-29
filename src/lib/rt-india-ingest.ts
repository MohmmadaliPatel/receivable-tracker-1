/**
 * Ingest uploaded RT India workbook Sheet1 (Customer SAP code + billing emails) into
 * `entity_contacts`, `VendorMaster`, and `SupplierMaster`, then hydrate TP/TR/MSME rows
 * using masters + legacy EntityContact resolution.
 */
import * as fs from 'fs';
import { prisma } from '@/lib/prisma';
import { normalizeSapCode } from '@/lib/confirmation-repository';
import { normalizeTradeCustId, TRADE_COMPOSITE_SEP } from '@/lib/trade-composite-cust';
import { pickMatchingPartyMaster, upsertPartyMastersFromRtRow } from '@/lib/party-masters';

function cell(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** Normalize workbook TO lines into comma-separated list usable by outbound send */
function normalizeEmailList(raw: string): string {
  if (!raw.trim()) return '';
  return raw
    .replace(/\s*<\s*/g, ' <')
    .replace(/\r\n/g, '\n')
    .split(/\n|;|,/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}

function readWorkbookRows(filePath: string): Record<string, unknown>[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`RT India workbook not found at ${filePath}`);
  }
  const buffer = fs.readFileSync(filePath);
  return readWorkbookRowsFromBuffer(buffer);
}

/** Parse Sheet1 from in-memory workbook (same format as `public/RT India - Email Automation.xlsx`). */
export function readWorkbookRowsFromBuffer(buffer: Buffer): Record<string, unknown>[] {
  const XLSX = require('xlsx') as typeof import('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const names = wb.SheetNames;
  const sheet1 = wb.Sheets[names.includes('Sheet1') ? 'Sheet1' : names[0]];
  if (!sheet1) throw new Error('No sheet found in workbook');
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet1, {
    raw: false,
    defval: '',
  }) as Record<string, unknown>[];
}

export type RtIndiaIngestMode = 'full' | 'vendor_only' | 'supplier_only';

export async function syncRtIndiaContacts(
  filePath: string,
  mode: RtIndiaIngestMode = 'full'
): Promise<{
  contactsUpserted: number;
  tradePayablesUpdated: number;
  tradeReceivablesUpdated: number;
  msmeUpdated: number;
}> {
  if (!filePath?.trim()) {
    throw new Error('RT India upload requires a workbook file path');
  }

  const updateVendorMaster = mode === 'full' || mode === 'vendor_only';
  const updateSupplierMaster = mode === 'full' || mode === 'supplier_only';
  const hydrateTp = mode === 'full' || mode === 'vendor_only';
  const hydrateTr = mode === 'full' || mode === 'supplier_only';
  const hydrateMsme = mode === 'full' || mode === 'supplier_only';

  const rows = readWorkbookRows(filePath);

  let contactsUpserted = 0;

  for (const row of rows) {
    const codeRaw = cell(row, 'Customer Code in SAP', 'Customer Code');
    const code = codeRaw ? normalizeSapCode(codeRaw) : '';
    if (!code) continue;

    const projectName = cell(row, 'Project Name') || null;
    const region = cell(row, 'Region') || null;
    const personName = cell(row, 'Person Name') || null;
    const toRaw = cell(row, 'TO', 'To ');
    const ccRaw = cell(row, 'CC', 'Cc');
    const ccNorm = normalizeEmailList(ccRaw);
    const emailTo = normalizeEmailList(toRaw) || ccNorm || '';

    await prisma.entityContact.upsert({
      where: { sapCustomerCode: code },
      create: {
        sapCustomerCode: code,
        projectName,
        region,
        personName,
        emailTo,
        emailCc: ccNorm || null,
        source: 'rt_india_sheet1',
      },
      update: {
        projectName,
        region,
        personName,
        emailTo,
        emailCc: ccNorm || null,
      },
    });
    contactsUpserted++;

    await upsertPartyMastersFromRtRow({
      code,
      emailTo,
      emailCc: ccNorm || null,
      projectName,
      region,
      personName,
      updateVendor: updateVendorMaster,
      updateSupplier: updateSupplierMaster,
    });
  }

  const contacts = await prisma.entityContact.findMany({
    select: { id: true, sapCustomerCode: true, emailTo: true, emailCc: true },
  });
  const idBySapCode = new Map(
    contacts
      .filter((c): c is typeof c & { sapCustomerCode: string } => !!c.sapCustomerCode?.trim())
      .map((c) => [c.sapCustomerCode, c])
  );

  function resolveContactForCustId(custId: string):
    | { id: string; emailTo: string; emailCc: string | null }
    | undefined {
    const full = normalizeTradeCustId(custId);
    let ec = idBySapCode.get(full);
    if (ec) return ec;
    const sepIdx = full.indexOf(TRADE_COMPOSITE_SEP);
    if (sepIdx > 0) {
      ec = idBySapCode.get(full.slice(0, sepIdx));
      if (ec) return ec;
    }
    const legacy = normalizeSapCode(custId);
    return idBySapCode.get(legacy);
  }

  const vendors = await prisma.vendorMaster.findMany();
  const suppliers = await prisma.supplierMaster.findMany();

  let tradePayablesUpdated = 0;
  let tradeReceivablesUpdated = 0;
  let msmeUpdated = 0;

  if (hydrateTp) {
    const tps = await prisma.tradePayableConfirmation.findMany({
      select: { id: true, custId: true },
    });
    for (const r of tps) {
      if (!r.custId?.trim()) continue;
      const vm = pickMatchingPartyMaster(vendors, r.custId);
      const ec = resolveContactForCustId(r.custId);
      const emailTo = (vm?.emailTo?.trim() || ec?.emailTo?.trim() || '').trim();
      const emailCc = vm?.emailCc ?? ec?.emailCc ?? null;
      if (!emailTo && !ec && !vm) continue;
      await prisma.tradePayableConfirmation.update({
        where: { id: r.id },
        data: {
          entityContactId: ec?.id ?? null,
          vendorMasterId: vm?.id ?? null,
          emailTo: emailTo || '',
          ...(emailCc != null ? { emailCc } : { emailCc: null }),
        },
      });
      tradePayablesUpdated++;
    }
  }

  if (hydrateTr) {
    const trs = await prisma.tradeReceivableConfirmation.findMany({
      select: { id: true, custId: true },
    });
    for (const r of trs) {
      if (!r.custId?.trim()) continue;
      const sm = pickMatchingPartyMaster(suppliers, r.custId);
      const ec = resolveContactForCustId(r.custId);
      const emailTo = (sm?.emailTo?.trim() || ec?.emailTo?.trim() || '').trim();
      const emailCc = sm?.emailCc ?? ec?.emailCc ?? null;
      if (!emailTo && !ec && !sm) continue;
      await prisma.tradeReceivableConfirmation.update({
        where: { id: r.id },
        data: {
          entityContactId: ec?.id ?? null,
          supplierMasterId: sm?.id ?? null,
          emailTo: emailTo || '',
          ...(emailCc != null ? { emailCc } : { emailCc: null }),
        },
      });
      tradeReceivablesUpdated++;
    }
  }

  if (hydrateMsme) {
    const mss = await prisma.msmeConfirmation.findMany({ select: { id: true, custId: true } });
    for (const r of mss) {
      if (!r.custId?.trim()) continue;
      const sm = pickMatchingPartyMaster(suppliers, r.custId);
      const ec = resolveContactForCustId(r.custId);
      const emailTo = (sm?.emailTo?.trim() || ec?.emailTo?.trim() || '').trim();
      const emailCc = sm?.emailCc ?? ec?.emailCc ?? null;
      if (!emailTo && !ec && !sm) continue;
      await prisma.msmeConfirmation.update({
        where: { id: r.id },
        data: {
          entityContactId: ec?.id ?? null,
          supplierMasterId: sm?.id ?? null,
          emailTo: emailTo || '',
          ...(emailCc != null ? { emailCc } : { emailCc: null }),
        },
      });
      msmeUpdated++;
    }
  }

  return {
    contactsUpserted,
    tradePayablesUpdated,
    tradeReceivablesUpdated,
    msmeUpdated,
  };
}
