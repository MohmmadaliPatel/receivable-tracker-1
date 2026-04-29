import { prisma } from '@/lib/prisma';
import type { ExcelMappedRow } from '@/lib/module-excel-maps';
import { baseCreatePayloadForExcel, excelSheetToRowObjects } from '@/lib/module-excel-maps';
import type { ModuleKey } from '@/lib/module-types';
import { normalizeSapCode } from '@/lib/confirmation-repository';
import { assignTradeEmailThreadAnchors } from '@/lib/trade-email-group';
import { normalizeTradeCustId } from '@/lib/trade-composite-cust';
import {
  upsertVendorMasterFromListingRow,
  upsertSupplierMasterFromListingRow,
} from '@/lib/party-masters';

import { parseCSV } from '@/lib/csv-encoding';

export type TradeListingModuleKey = 'trade_payable' | 'trade_receivable';

export function parseTradeListingFile(buffer: Buffer, filenameLower: string): Record<string, string>[] {
  if (filenameLower.endsWith('.csv')) {
    return parseCSV(buffer.toString('utf-8'));
  }
  if (filenameLower.endsWith('.xlsx') || filenameLower.endsWith('.xls')) {
    return excelSheetToRowObjects(buffer);
  }
  throw new Error('Unsupported file type. Use .csv or .xlsx');
}

export async function buildEntityContactFkMap(): Promise<Map<string, string>> {
  const contacts = await prisma.entityContact.findMany({
    where: { sapCustomerCode: { not: null } },
    select: { id: true, sapCustomerCode: true },
  });
  const m = new Map<string, string>();
  for (const c of contacts) {
    if (c.sapCustomerCode) m.set(c.sapCustomerCode, c.id);
  }
  return m;
}

/** Shared TP/TR listing import: upsert party masters, insert confirmations with correct FK shape per model. */
export async function importTradeListingFromMapped(args: {
  moduleKey: TradeListingModuleKey;
  userId: string;
  mapped: ExcelMappedRow[];
  mode: 'append' | 'replace';
  fkMap: Map<string, string>;
}): Promise<{ imported: number }> {
  const { moduleKey, userId, mapped, mode, fkMap } = args;

  if (mode === 'replace') {
    if (moduleKey === 'trade_payable') {
      await prisma.tradePayableConfirmation.deleteMany({ where: { userId } });
    } else {
      await prisma.tradeReceivableConfirmation.deleteMany({ where: { userId } });
    }
  }

  const masterIdByNorm = new Map<string, string>();
  for (const m of mapped) {
    const cust = m.custId?.trim();
    const norm = cust ? normalizeTradeCustId(cust) : '';
    if (!norm) continue;
    if (moduleKey === 'trade_payable') {
      const id = await upsertVendorMasterFromListingRow(
        m as Parameters<typeof upsertVendorMasterFromListingRow>[0]
      );
      if (id) masterIdByNorm.set(norm, id);
    } else {
      const id = await upsertSupplierMasterFromListingRow(
        m as Parameters<typeof upsertSupplierMasterFromListingRow>[0]
      );
      if (id) masterIdByNorm.set(norm, id);
    }
  }

  const masterIds = [...new Set(masterIdByNorm.values())];
  const vendorMasters =
    moduleKey === 'trade_payable'
      ? await prisma.vendorMaster.findMany({ where: { id: { in: masterIds } } })
      : [];
  const supplierMasters =
    moduleKey === 'trade_receivable'
      ? await prisma.supplierMaster.findMany({ where: { id: { in: masterIds } } })
      : [];
  const vendorById = new Map(vendorMasters.map((x) => [x.id, x]));
  const supplierById = new Map(supplierMasters.map((x) => [x.id, x]));

  const key = moduleKey as ModuleKey;

  if (moduleKey === 'trade_payable') {
    const data = mapped.map((m) => {
      const p = baseCreatePayloadForExcel(m, key, userId);
      const norm = p.custId ? normalizeTradeCustId(String(p.custId)) : '';
      const mid = norm ? masterIdByNorm.get(norm) ?? null : null;
      let emailTo = (p.emailTo ?? '').trim();
      let emailCc = p.emailCc ?? null;
      if (mid) {
        const vm = vendorById.get(mid);
        if (vm?.emailTo?.trim() && !emailTo) emailTo = vm.emailTo.trim();
        if (vm?.emailCc?.trim() && !emailCc) emailCc = vm.emailCc.trim();
      }
      return {
        ...p,
        emailTo,
        emailCc,
        entityContactId: p.custId != null ? fkMap.get(normalizeSapCode(String(p.custId))) ?? null : null,
        vendorMasterId: mid,
      };
    });
    const created = await prisma.tradePayableConfirmation.createMany({ data });
    await assignTradeEmailThreadAnchors(userId, 'trade_payable');
    return { imported: created.count };
  }

  const data = mapped.map((m) => {
    const p = baseCreatePayloadForExcel(m, key, userId);
    const norm = p.custId ? normalizeTradeCustId(String(p.custId)) : '';
    const mid = norm ? masterIdByNorm.get(norm) ?? null : null;
    let emailTo = (p.emailTo ?? '').trim();
    let emailCc = p.emailCc ?? null;
    if (mid) {
      const sm = supplierById.get(mid);
      if (sm?.emailTo?.trim() && !emailTo) emailTo = sm.emailTo.trim();
      if (sm?.emailCc?.trim() && !emailCc) emailCc = sm.emailCc.trim();
    }
    return {
      ...p,
      emailTo,
      emailCc,
      entityContactId: p.custId != null ? fkMap.get(normalizeSapCode(String(p.custId))) ?? null : null,
      supplierMasterId: mid,
    };
  });
  const created = await prisma.tradeReceivableConfirmation.createMany({ data });
  await assignTradeEmailThreadAnchors(userId, 'trade_receivable');
  return { imported: created.count };
}
