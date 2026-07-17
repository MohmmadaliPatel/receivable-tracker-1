import { prisma } from '@/lib/prisma';
import {
  buildTradeCompositeCustId,
  normalizeTradeCustId,
  TRADE_COMPOSITE_SEP,
} from '@/lib/trade-composite-cust';
import { mapTradePayableExcelRow, mapTradeReceivableExcelRow } from '@/lib/module-excel-maps';
import { normalizeSapCode } from '@/lib/confirmation-repository';

export type VendorExcelMapped = ReturnType<typeof mapTradePayableExcelRow>;
export type SupplierExcelMapped = ReturnType<typeof mapTradeReceivableExcelRow>;

function keyFromMappedVendor(v: VendorExcelMapped): { normalizedKey: string; companyCode: string; partyName: string; custId: string | null } {
  const en = v.entityName?.trim() || '';
  const parts = en.split(' · ');
  const companyCode = parts[0]?.trim() ?? '';
  const partyName = parts.length > 1 ? parts.slice(1).join(' · ').trim() : '';
  const custId = v.custId ? normalizeTradeCustId(v.custId) : null;
  const normalizedKey =
    custId ||
    (companyCode
      ? normalizeTradeCustId(buildTradeCompositeCustId(companyCode, partyName || undefined) ?? companyCode)
      : '');
  return { normalizedKey, companyCode, partyName, custId };
}

function keyFromMappedSupplier(v: SupplierExcelMapped): { normalizedKey: string; companyCode: string; partyName: string; custId: string | null } {
  const en = v.entityName?.trim() || '';
  const parts = en.split(' · ');
  const companyCode = parts[0]?.trim() ?? '';
  const partyName = parts.length > 1 ? parts.slice(1).join(' · ').trim() : '';
  const custId = v.custId ? normalizeTradeCustId(v.custId) : null;
  const normalizedKey =
    custId ||
    (companyCode
      ? normalizeTradeCustId(buildTradeCompositeCustId(companyCode, partyName || undefined) ?? companyCode)
      : '');
  return { normalizedKey, companyCode, partyName, custId };
}

/** Derive company + party from listing row when custId exists but entityName split fails */
function enrichKeyFromCustId(
  custId: string | null | undefined,
  emailTo?: string
): { normalizedKey: string; companyCode: string; partyName: string; custId: string | null } {
  const raw = custId?.trim() || '';
  if (!raw) return { normalizedKey: '', companyCode: '', partyName: '', custId: null };
  const norm = normalizeTradeCustId(raw);
  const sep = norm.indexOf(TRADE_COMPOSITE_SEP);
  if (sep > 0) {
    return {
      normalizedKey: norm,
      companyCode: norm.slice(0, sep),
      partyName: norm.slice(sep + TRADE_COMPOSITE_SEP.length),
      custId: norm,
    };
  }
  return { normalizedKey: norm, companyCode: norm, partyName: '', custId: norm };
}

export async function upsertVendorMasterFromListingRow(v: VendorExcelMapped): Promise<string | null> {
  const k = keyFromMappedVendor(v);
  let normalizedKey = k.normalizedKey;
  let companyCode = k.companyCode;
  let partyName = k.partyName;
  let custId = k.custId;
  if (!normalizedKey && v.custId) {
    const e = enrichKeyFromCustId(v.custId);
    normalizedKey = e.normalizedKey;
    companyCode = e.companyCode;
    partyName = e.partyName;
    custId = e.custId;
  }
  if (!normalizedKey) return null;

  const emailTo = (v.emailTo ?? '').trim();
  const emailCc = (v.emailCc ?? '').trim() || null;

  const row = await prisma.vendorMaster.upsert({
    where: { normalizedKey },
    create: {
      normalizedKey,
      companyCode: companyCode || normalizedKey,
      partyName: partyName || '',
      custId,
      emailTo,
      emailCc,
      source: 'listing',
    },
    update: {
      companyCode: companyCode || undefined,
      partyName,
      custId: custId ?? undefined,
      ...(emailTo ? { emailTo } : {}),
      ...(emailCc !== undefined ? { emailCc } : {}),
    },
  });
  return row.id;
}

export async function upsertSupplierMasterFromListingRow(v: SupplierExcelMapped): Promise<string | null> {
  const k = keyFromMappedSupplier(v);
  let normalizedKey = k.normalizedKey;
  let companyCode = k.companyCode;
  let partyName = k.partyName;
  let custId = k.custId;
  if (!normalizedKey && v.custId) {
    const e = enrichKeyFromCustId(v.custId);
    normalizedKey = e.normalizedKey;
    companyCode = e.companyCode;
    partyName = e.partyName;
    custId = e.custId;
  }
  if (!normalizedKey) return null;

  const emailTo = (v.emailTo ?? '').trim();
  const emailCc = (v.emailCc ?? '').trim() || null;

  const row = await prisma.supplierMaster.upsert({
    where: { normalizedKey },
    create: {
      normalizedKey,
      companyCode: companyCode || normalizedKey,
      partyName: partyName || '',
      custId,
      emailTo,
      emailCc,
      source: 'listing',
    },
    update: {
      companyCode: companyCode || undefined,
      partyName,
      custId: custId ?? undefined,
      ...(emailTo ? { emailTo } : {}),
      ...(emailCc !== undefined ? { emailCc } : {}),
    },
  });
  return row.id;
}

export async function getVendorMasterIdByNormalizedKey(key: string): Promise<string | null> {
  if (!key) return null;
  const r = await prisma.vendorMaster.findUnique({ where: { normalizedKey: normalizeTradeCustId(key) } });
  return r?.id ?? null;
}

export async function getSupplierMasterIdByNormalizedKey(key: string): Promise<string | null> {
  if (!key) return null;
  const r = await prisma.supplierMaster.findUnique({ where: { normalizedKey: normalizeTradeCustId(key) } });
  return r?.id ?? null;
}

/** Match loaded master rows to a trade listing / MSME composite `custId` (full key, then SAP prefix). */
export function pickMatchingPartyMaster<T extends { normalizedKey: string; sapCustomerCode: string | null; companyCode: string }>(
  rows: T[],
  custId: string
): T | undefined {
  const full = normalizeTradeCustId(custId);
  const direct = rows.find((r) => r.normalizedKey === full);
  if (direct) return direct;
  const sep = full.indexOf(TRADE_COMPOSITE_SEP);
  const prefix = sep > 0 ? full.slice(0, sep) : full;
  const legacy = normalizeSapCode(custId);
  return (
    rows.find((r) => r.normalizedKey === prefix) ||
    rows.find((r) => (r.sapCustomerCode && r.sapCustomerCode === prefix) || r.sapCustomerCode === legacy) ||
    rows.find((r) => r.companyCode === prefix)
  );
}

/** RT Sheet1: SAP code row populating vendor and/or supplier masters (company-only key). */
export async function upsertPartyMastersFromRtRow(
  params: {
    code: string;
    emailTo: string;
    emailCc: string | null;
    projectName: string | null;
    region: string | null;
    personName: string | null;
    /** When false, skip that master (partial RT ingest from vendor/supplier pages). */
    updateVendor?: boolean;
    updateSupplier?: boolean;
  }
): Promise<void> {
  const { code, emailTo, emailCc, projectName, region, personName } = params;
  const updateVendor = params.updateVendor !== false;
  const updateSupplier = params.updateSupplier !== false;
  const normCode = normalizeSapCode(code);
  if (!normCode) return;

  const sharedCreate = {
    companyCode: normCode,
    partyName: '',
    custId: normCode,
    sapCustomerCode: normCode,
    projectName,
    region,
    personName,
    source: 'rt_india_sheet1' as const,
  };

  const rtOnlyUpdate = {
    projectName,
    region,
    personName,
    sapCustomerCode: normCode,
    source: 'rt_india_sheet1' as const,
  };

  if (updateVendor) {
    await prisma.vendorMaster.upsert({
      where: { normalizedKey: normCode },
      create: {
        normalizedKey: normCode,
        ...sharedCreate,
        emailTo,
        emailCc,
      },
      update: {
        ...rtOnlyUpdate,
        ...(emailTo ? { emailTo } : {}),
        ...(emailCc !== undefined ? { emailCc } : {}),
      },
    });
    // Push RT emails onto listing twins (composite company||party keys) that still lack TO.
    if (emailTo) {
      await prisma.vendorMaster.updateMany({
        where: {
          emailTo: '',
          OR: [
            { sapCustomerCode: normCode },
            { normalizedKey: { startsWith: `${normCode}${TRADE_COMPOSITE_SEP}` } },
            { custId: { startsWith: `${normCode}${TRADE_COMPOSITE_SEP}` } },
          ],
        },
        data: {
          emailTo,
          ...(emailCc ? { emailCc } : {}),
          sapCustomerCode: normCode,
        },
      });
    }
  }

  if (updateSupplier) {
    await prisma.supplierMaster.upsert({
      where: { normalizedKey: normCode },
      create: {
        normalizedKey: normCode,
        ...sharedCreate,
        emailTo,
        emailCc,
      },
      update: {
        ...rtOnlyUpdate,
        ...(emailTo ? { emailTo } : {}),
        ...(emailCc !== undefined ? { emailCc } : {}),
      },
    });
    if (emailTo) {
      await prisma.supplierMaster.updateMany({
        where: {
          emailTo: '',
          OR: [
            { sapCustomerCode: normCode },
            { normalizedKey: { startsWith: `${normCode}${TRADE_COMPOSITE_SEP}` } },
            { custId: { startsWith: `${normCode}${TRADE_COMPOSITE_SEP}` } },
          ],
        },
        data: {
          emailTo,
          ...(emailCc ? { emailCc } : {}),
          sapCustomerCode: normCode,
        },
      });
    }
  }
}
