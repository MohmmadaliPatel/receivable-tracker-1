import { prisma } from '@/lib/prisma';
import { normalizeSapCode } from '@/lib/confirmation-repository';
import { normalizeTradeCustId } from '@/lib/trade-composite-cust';
import { resolveWorkspaceFiscalForUser } from '@/lib/listing-fiscal-context';
import { categoryForModule } from '@/lib/module-types';

/**
 * Create/update Trade Payable anchor rows from global Vendor master for this user.
 * Used after RT India upload (masters-only) and when opening the TP workspace.
 */
export async function syncTpFromVendorMaster(userId: string): Promise<{ upserted: number }> {
  const fiscal = await resolveWorkspaceFiscalForUser(userId, 'trade_payable');
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
    if (!emailTo) continue;

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

    const existing = await prisma.tradePayableConfirmation.findFirst({
      where: {
        userId,
        emailThreadAnchorId: null,
        OR: orClause,
      },
    });

    const fiscalData = {
      reportingFiscalYear: fiscal.reportingFiscalYear,
      reportingFiscalQuarter: fiscal.reportingFiscalQuarter,
    };

    const data = {
      entityName,
      custId,
      vendorMasterId: vm.id,
      entityContactId: ec?.id ?? null,
      emailTo,
      emailCc,
      ...fiscalData,
    };

    if (existing) {
      const keepExistingFiscal =
        existing.reportingFiscalYear != null && existing.reportingFiscalQuarter != null;
      await prisma.tradePayableConfirmation.update({
        where: { id: existing.id },
        data: {
          entityName,
          custId,
          vendorMasterId: vm.id,
          entityContactId: ec?.id ?? null,
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
      await prisma.tradePayableConfirmation.create({
        data: {
          userId,
          category: categoryForModule('trade_payable'),
          status: 'not_sent',
          emailThreadAnchorId: null,
          ...data,
        },
      });
    }
    upserted++;
  }

  return { upserted };
}
