import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/simple-auth';
import { prisma } from '@/lib/prisma';
import { userCanAccessModule } from '@/lib/module-access';
import { categoryForModule } from '@/lib/module-types';
import type { ModuleKey } from '@/lib/module-types';
import { parseCSV } from '@/lib/csv-encoding';
import { mapRoundTripCsvRow } from '@/lib/module-round-trip';
import { normalizeSapCode } from '@/lib/confirmation-repository';

import { parseModuleSegment } from '../../_utils';

async function auth() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  return await getSession(sessionToken);
}

async function fkForCustId(custId: string | null | undefined): Promise<string | null> {
  if (!custId?.trim()) return null;
  const code = normalizeSapCode(custId);
  const e = await prisma.entityContact.findUnique({ where: { sapCustomerCode: code }, select: { id: true } });
  return e?.id ?? null;
}

// POST /api/modules/[segment]/import — CSV round-trip (same columns as export)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ segment: string }> }
) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { segment } = await params;
  const key = parseModuleSegment(segment) as ModuleKey | null;
  if (!key) return NextResponse.json({ error: 'Invalid module' }, { status: 400 });
  if (!userCanAccessModule(user, key)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const text = Buffer.from(await file.arrayBuffer()).toString('utf-8');
  let rows: Record<string, string>[];
  try {
    rows = parseCSV(text);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Invalid CSV: ${msg}` }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'File is empty' }, { status: 400 });
  }

  let created = 0;
  let updated = 0;

  try {
    await prisma.$transaction(async (tx) => {
      for (const raw of rows) {
        const m = mapRoundTripCsvRow(raw);
        if (!m) continue;

        if (m.id) {
          const fk = await fkForCustId(m.custId ?? null);
          if (key === 'trade_payable') {
            const existing = await tx.tradePayableConfirmation.findUnique({ where: { id: m.id } });
            if (!existing) throw new Error(`Unknown id: ${m.id}`);
            await tx.tradePayableConfirmation.update({
              where: { id: m.id },
              data: {
                entityName: m.entityName || existing.entityName,
                emailTo: m.emailTo,
                emailCc: m.emailCc || null,
                bankName: m.bankName || null,
                custId: m.custId || null,
                remarks: m.remarks || null,
                entityContactId: fk,
              },
            });
          } else if (key === 'trade_receivable') {
            const existing = await tx.tradeReceivableConfirmation.findUnique({ where: { id: m.id } });
            if (!existing) throw new Error(`Unknown id: ${m.id}`);
            await tx.tradeReceivableConfirmation.update({
              where: { id: m.id },
              data: {
                entityName: m.entityName || existing.entityName,
                emailTo: m.emailTo,
                emailCc: m.emailCc || null,
                bankName: m.bankName || null,
                custId: m.custId || null,
                remarks: m.remarks || null,
                entityContactId: fk,
              },
            });
          } else {
            const existing = await tx.msmeConfirmation.findUnique({ where: { id: m.id } });
            if (!existing) throw new Error(`Unknown id: ${m.id}`);
            await tx.msmeConfirmation.update({
              where: { id: m.id },
              data: {
                entityName: m.entityName || existing.entityName,
                emailTo: m.emailTo,
                emailCc: m.emailCc || null,
                bankName: m.bankName || null,
                custId: m.custId || null,
                remarks: m.remarks || null,
                entityContactId: fk,
              },
            });
          }
          updated++;
        } else if (m.entityName) {
          const fk = await fkForCustId(m.custId ?? null);
          const cat = categoryForModule(key);
          const shared = {
            entityName: m.entityName,
            category: cat,
            bankName: m.bankName || null,
            accountNumber: null,
            custId: m.custId || null,
            emailTo: m.emailTo,
            emailCc: m.emailCc || null,
            remarks: m.remarks || null,
            userId: user.userId,
            entityContactId: fk,
          };
          if (key === 'trade_payable') {
            await tx.tradePayableConfirmation.create({ data: shared });
          } else if (key === 'trade_receivable') {
            await tx.tradeReceivableConfirmation.create({ data: shared });
          } else {
            await tx.msmeConfirmation.create({
              data: { ...shared, msmeHasCertificate: null, msmeCertificateFilesJson: null },
            });
          }
          created++;
        }
      }
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg || 'Import failed' }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    created,
    updated,
    totalRows: rows.length,
  });
}
