import { prisma } from '@/lib/prisma';
import { normalizeTradeCustId, TRADE_COMPOSITE_SEP } from '@/lib/trade-composite-cust';
import { normalizeSapCode } from '@/lib/confirmation-repository';
import { resolveWorkspaceFiscalForUser } from '@/lib/listing-fiscal-context';

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

function normalizePartyNameKey(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Confirm MSME from VendorMaster; fills TO/CC from RT twin / EntityContact; never blanks existing emails. */
export async function syncMsmeFromVendorMaster(userId: string): Promise<{ upserted: number }> {
  const fiscal = await resolveWorkspaceFiscalForUser(userId, 'trade_payable');
  const vendors = await prisma.vendorMaster.findMany();
  const contacts = await prisma.entityContact.findMany({
    select: { id: true, sapCustomerCode: true, payeeName: true, emailTo: true, emailCc: true },
  });
  const idBySap = new Map(
    contacts
      .filter((c): c is typeof c & { sapCustomerCode: string } => !!c.sapCustomerCode?.trim())
      .map((c) => [normalizeSapCode(c.sapCustomerCode) || c.sapCustomerCode.trim(), c])
  );
  const contactByPayee = new Map<string, (typeof contacts)[0]>();
  for (const c of contacts) {
    if (!c.emailTo?.trim()) continue;
    const nk = normalizePartyNameKey(c.payeeName);
    if (nk && !contactByPayee.has(nk)) contactByPayee.set(nk, c);
  }

  /** RT / email-bearing vendors keyed by SAP code (not org company code composites). */
  const emailVendorBySap = new Map<string, (typeof vendors)[0]>();
  const emailVendorByParty = new Map<string, (typeof vendors)[0]>();
  for (const v of vendors) {
    if (!v.emailTo?.trim()) continue;
    if (v.sapCustomerCode?.trim()) {
      const sap = normalizeSapCode(v.sapCustomerCode) || v.sapCustomerCode.trim();
      emailVendorBySap.set(sap, v);
    }
    // SAP-only master rows use normalizedKey === sap code (no composite separator).
    const nk = normalizeTradeCustId(v.normalizedKey);
    if (nk && !nk.includes(TRADE_COMPOSITE_SEP)) {
      emailVendorBySap.set(nk, v);
    }
    const party = normalizePartyNameKey(v.partyName);
    if (party && !emailVendorByParty.has(party)) emailVendorByParty.set(party, v);
  }

  /** TP anchors that already have TO — recover emails wiped by earlier blank syncs. */
  const tpAnchors = await prisma.tradePayableConfirmation.findMany({
    where: { userId, emailThreadAnchorId: null, NOT: { emailTo: '' } },
    select: { vendorMasterId: true, custId: true, emailTo: true, emailCc: true },
  });
  const tpEmailByVendorId = new Map<string, { emailTo: string; emailCc: string | null }>();
  const tpEmailByCust = new Map<string, { emailTo: string; emailCc: string | null }>();
  for (const t of tpAnchors) {
    const payload = { emailTo: t.emailTo.trim(), emailCc: t.emailCc?.trim() || null };
    if (t.vendorMasterId && !tpEmailByVendorId.has(t.vendorMasterId)) {
      tpEmailByVendorId.set(t.vendorMasterId, payload);
    }
    if (t.custId) {
      const ck = normalizeTradeCustId(t.custId);
      if (ck && !tpEmailByCust.has(ck)) tpEmailByCust.set(ck, payload);
    }
  }

  function contactForVendor(vm: (typeof vendors)[0]) {
    if (vm.sapCustomerCode?.trim()) {
      const sap = normalizeSapCode(vm.sapCustomerCode) || vm.sapCustomerCode.trim();
      const hit = idBySap.get(sap);
      if (hit) return hit;
    }
    // SAP-only vendor rows: companyCode is the account code.
    if (!vm.partyName?.trim()) {
      const code = normalizeSapCode(vm.companyCode);
      if (code) {
        const hit = idBySap.get(code);
        if (hit) return hit;
      }
    }
    const byName = normalizePartyNameKey(vm.partyName);
    if (byName) return contactByPayee.get(byName) ?? null;
    return null;
  }

  function twinVendorWithEmail(vm: (typeof vendors)[0]): (typeof vendors)[0] | null {
    if (vm.sapCustomerCode?.trim()) {
      const sap = normalizeSapCode(vm.sapCustomerCode) || vm.sapCustomerCode.trim();
      const hit = emailVendorBySap.get(sap);
      if (hit && hit.id !== vm.id) return hit;
    }
    const party = normalizePartyNameKey(vm.partyName);
    if (party) {
      const hit = emailVendorByParty.get(party);
      if (hit && hit.id !== vm.id) return hit;
    }
    return null;
  }

  let upserted = 0;
  for (const vm of vendors) {
    const ec = contactForVendor(vm);
    const twin = !vm.emailTo?.trim() ? twinVendorWithEmail(vm) : null;
    const tpHit =
      tpEmailByVendorId.get(vm.id) ||
      (vm.custId ? tpEmailByCust.get(normalizeTradeCustId(vm.custId)) : undefined) ||
      (vm.normalizedKey ? tpEmailByCust.get(normalizeTradeCustId(vm.normalizedKey)) : undefined);

    let emailTo = (
      vm.emailTo?.trim() ||
      twin?.emailTo?.trim() ||
      ec?.emailTo?.trim() ||
      tpHit?.emailTo ||
      ''
    ).trim();
    let emailCc =
      (vm.emailCc?.trim() ||
        twin?.emailCc?.trim() ||
        ec?.emailCc?.trim() ||
        tpHit?.emailCc ||
        '') || null;

    // Backfill listing vendor so masters and future syncs keep the resolved email.
    if (emailTo && !vm.emailTo?.trim()) {
      await prisma.vendorMaster.update({
        where: { id: vm.id },
        data: {
          emailTo,
          ...(emailCc ? { emailCc } : {}),
          ...(twin?.sapCustomerCode && !vm.sapCustomerCode
            ? { sapCustomerCode: twin.sapCustomerCode }
            : {}),
          ...(ec?.sapCustomerCode && !vm.sapCustomerCode
            ? { sapCustomerCode: ec.sapCustomerCode }
            : {}),
        },
      });
    }

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

    // Never wipe a previously saved TO/CC with blanks from a blank listing/hydrate pass.
    if (existing) {
      if (!emailTo && existing.emailTo?.trim()) emailTo = existing.emailTo.trim();
      if (!emailCc && existing.emailCc?.trim()) emailCc = existing.emailCc.trim();
    }

    const fiscalData = {
      reportingFiscalYear: fiscal.reportingFiscalYear,
      reportingFiscalQuarter: fiscal.reportingFiscalQuarter,
    };

    const data = {
      entityName,
      custId,
      vendorMasterId: vm.id,
      supplierMasterId: null,
      entityContactId: ec?.id ?? null,
      emailTo,
      emailCc,
      ...fiscalData,
    };

    if (existing) {
      const keepExistingFiscal =
        existing.reportingFiscalYear != null && existing.reportingFiscalQuarter != null;
      await prisma.msmeConfirmation.update({
        where: { id: existing.id },
        data: {
          entityName,
          custId,
          vendorMasterId: vm.id,
          supplierMasterId: null,
          entityContactId: ec?.id ?? existing.entityContactId ?? null,
          emailTo,
          emailCc,
          ...(keepExistingFiscal
            ? {}
            : {
                reportingFiscalYear: fiscal.reportingFiscalYear,
                reportingFiscalQuarter: fiscal.reportingFiscalQuarter,
              }),
        },
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
