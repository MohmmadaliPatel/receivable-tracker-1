import { prisma } from '@/lib/prisma';
import { normalizeTradeCustId } from '@/lib/trade-composite-cust';
import { normalizeSapCode } from '@/lib/confirmation-repository';

type AnchorLike = {
  entityContactId: string | null;
  emailTo: string;
  emailCc?: string | null;
  entityName: string;
  custId: string | null;
  reportingFiscalYear?: number | null;
  reportingFiscalQuarter?: number | null;
};

/** Upsert one MSME row for a trade anchor; returns true if a row was written (had an email). */
async function upsertMsmeForAnchor(userId: string, a: AnchorLike): Promise<boolean> {
  const ec = a.entityContactId
    ? await prisma.entityContact.findUnique({ where: { id: a.entityContactId } })
    : null;

  const emailTo = (ec?.emailTo?.trim() || a.emailTo?.trim() || '').trim();
  if (!emailTo) return false;

  const emailCc = ec?.emailCc ?? a.emailCc ?? null;
  const entityName = (ec?.payeeName?.trim() || a.entityName || 'Customer').trim();
  const custId = a.custId ?? ec?.sapCustomerCode ?? null;
  const entityContactId = ec?.id ?? a.entityContactId ?? null;

  const orClause: Array<{ entityContactId: string } | { custId: string }> = [];
  if (entityContactId) orClause.push({ entityContactId });
  if (custId) orClause.push({ custId });
  if (orClause.length === 0) return false;

  const existing = await prisma.msmeConfirmation.findFirst({
    where: {
      userId,
      OR: orClause,
    },
  });

  const fiscalData = {
    ...(a.reportingFiscalYear != null ? { reportingFiscalYear: a.reportingFiscalYear } : {}),
    ...(a.reportingFiscalQuarter != null ? { reportingFiscalQuarter: a.reportingFiscalQuarter } : {}),
  };

  if (existing) {
    await prisma.msmeConfirmation.update({
      where: { id: existing.id },
      data: {
        entityName,
        custId,
        entityContactId,
        emailTo,
        emailCc,
        ...fiscalData,
      },
    });
  } else {
    await prisma.msmeConfirmation.create({
      data: {
        userId,
        entityName,
        category: 'Confirm MSME',
        custId,
        entityContactId,
        emailTo,
        emailCc,
        ...fiscalData,
      },
    });
  }
  return true;
}

/**
 * MSME list from trade **anchors** (email thread roots). Merges Trade Payable and Trade Receivable
 * by normalized composite `custId`; when the same key exists in both, **Receivable** wins (customer master).
 * Emails come from linked EntityContact or the anchor row (after RT India / party master hydration).
 */
export async function syncMsmeFromTradeAnchors(userId: string): Promise<{ upserted: number }> {
  const tp = await prisma.tradePayableConfirmation.findMany({
    where: { userId, emailThreadAnchorId: null },
    select: {
      entityContactId: true,
      emailTo: true,
      emailCc: true,
      entityName: true,
      custId: true,
      reportingFiscalYear: true,
      reportingFiscalQuarter: true,
    },
  });
  const tr = await prisma.tradeReceivableConfirmation.findMany({
    where: { userId, emailThreadAnchorId: null },
    select: {
      entityContactId: true,
      emailTo: true,
      emailCc: true,
      entityName: true,
      custId: true,
      reportingFiscalYear: true,
      reportingFiscalQuarter: true,
    },
  });

  const byCust = new Map<string, AnchorLike>();
  for (const r of tp) {
    const raw = r.custId?.trim();
    if (!raw) continue;
    const k = normalizeTradeCustId(raw);
    if (!k) continue;
    byCust.set(k, {
      entityContactId: r.entityContactId,
      emailTo: r.emailTo,
      emailCc: r.emailCc,
      entityName: r.entityName,
      custId: r.custId,
      reportingFiscalYear: r.reportingFiscalYear,
      reportingFiscalQuarter: r.reportingFiscalQuarter,
    });
  }
  for (const r of tr) {
    const raw = r.custId?.trim();
    if (!raw) continue;
    const k = normalizeTradeCustId(raw);
    if (!k) continue;
    /** Receivable overwrites Payable for the same composite key (customer master preference). */
    byCust.set(k, {
      entityContactId: r.entityContactId,
      emailTo: r.emailTo,
      emailCc: r.emailCc,
      entityName: r.entityName,
      custId: r.custId,
      reportingFiscalYear: r.reportingFiscalYear,
      reportingFiscalQuarter: r.reportingFiscalQuarter,
    });
  }

  let upserted = 0;
  for (const a of byCust.values()) {
    if (await upsertMsmeForAnchor(userId, a)) upserted++;
  }

  return { upserted };
}

/** @deprecated Use syncMsmeFromTradeAnchors — kept for clear naming in older call sites. */
export async function syncMsmeFromTradeReceivableAnchors(userId: string): Promise<{ upserted: number }> {
  return syncMsmeFromTradeAnchors(userId);
}

/** Confirm MSME rows from SupplierMaster (non-empty emailTo); TR listing is no longer the source of truth. */
export async function syncMsmeFromSupplierMaster(userId: string): Promise<{ upserted: number }> {
  const suppliers = await prisma.supplierMaster.findMany({
    where: { NOT: { emailTo: '' } },
  });

  let upserted = 0;
  for (const sm of suppliers) {
    const emailTo = sm.emailTo.trim();
    if (!emailTo) continue;

    const entityName = sm.partyName?.trim()
      ? `${sm.companyCode} · ${sm.partyName}`.trim()
      : sm.companyCode;

    const custId = sm.custId ?? sm.normalizedKey;

    const orClause: Array<{ supplierMasterId: string } | { custId: string }> = [{ supplierMasterId: sm.id }];
    const custKeys = new Set<string>();
    if (sm.normalizedKey) custKeys.add(sm.normalizedKey);
    if (sm.custId) custKeys.add(sm.custId);
    for (const c of custKeys) {
      orClause.push({ custId: c });
    }

    const existing = await prisma.msmeConfirmation.findFirst({
      where: { userId, OR: orClause },
    });

    const ec = sm.sapCustomerCode
      ? await prisma.entityContact.findUnique({
          where: { sapCustomerCode: sm.sapCustomerCode },
          select: { id: true },
        })
      : null;

    const data = {
      entityName,
      custId,
      supplierMasterId: sm.id,
      entityContactId: ec?.id ?? null,
      emailTo,
      emailCc: sm.emailCc ?? null,
    };

    if (existing) {
      await prisma.msmeConfirmation.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.msmeConfirmation.create({
        data: {
          userId,
          category: 'Confirm MSME',
          ...data,
        },
      });
    }
    upserted++;
  }

  return { upserted };
}

/** Confirm MSME from VendorMaster; uses EntityContact when vendor row has no TO/CC. */
export async function syncMsmeFromVendorMaster(userId: string): Promise<{ upserted: number }> {
  const vendors = await prisma.vendorMaster.findMany();
  const contacts = await prisma.entityContact.findMany({
    select: { id: true, sapCustomerCode: true, emailTo: true, emailCc: true },
  });
  const idBySap = new Map(
    contacts
      .filter((c): c is typeof c & { sapCustomerCode: string } => !!c.sapCustomerCode?.trim())
      .map((c) => [c.sapCustomerCode, c])
  );

  function contactForVendor(vm: (typeof vendors)[0]) {
    if (vm.sapCustomerCode?.trim()) {
      const hit = idBySap.get(vm.sapCustomerCode.trim());
      if (hit) return hit;
    }
    const code = normalizeSapCode(vm.companyCode);
    if (code) {
      const hit = idBySap.get(code);
      if (hit) return hit;
    }
    return null;
  }

  let upserted = 0;
  for (const vm of vendors) {
    const ec = contactForVendor(vm);
    const emailTo = (vm.emailTo?.trim() || ec?.emailTo?.trim() || '').trim();
    const emailCc = vm.emailCc?.trim() ? vm.emailCc.trim() : ec?.emailCc ?? null;

    const entityName = vm.partyName?.trim()
      ? `${vm.companyCode} · ${vm.partyName}`.trim()
      : vm.companyCode;

    const custId = vm.custId ?? vm.normalizedKey;

    const orClause: Array<{ vendorMasterId: string } | { custId: string }> = [{ vendorMasterId: vm.id }];
    const custKeys = new Set<string>();
    if (vm.normalizedKey) custKeys.add(normalizeTradeCustId(vm.normalizedKey));
    if (vm.custId) custKeys.add(normalizeTradeCustId(vm.custId));
    for (const c of custKeys) {
      orClause.push({ custId: c });
    }

    const existing = await prisma.msmeConfirmation.findFirst({
      where: { userId, OR: orClause },
    });

    const data = {
      entityName,
      custId,
      vendorMasterId: vm.id,
      supplierMasterId: null,
      entityContactId: ec?.id ?? null,
      emailTo,
      emailCc,
    };

    if (existing) {
      await prisma.msmeConfirmation.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.msmeConfirmation.create({
        data: {
          userId,
          category: 'Confirm MSME',
          ...data,
        },
      });
    }
    upserted++;
  }

  return { upserted };
}

/** Confirm MSME from Vendor master only. */
export async function syncMsmeFromPartyMasters(userId: string): Promise<{
  upserted: number;
  fromVendors: number;
}> {
  const v = await syncMsmeFromVendorMaster(userId);
  return { upserted: v.upserted, fromVendors: v.upserted };
}
