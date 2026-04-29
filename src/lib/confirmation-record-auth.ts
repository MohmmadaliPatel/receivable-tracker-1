import type { SessionData } from '@/lib/simple-auth';
import { canMutateRecord } from '@/lib/module-access';
import {
  findUnifiedById,
  type UnifiedConfirmationRecord,
} from '@/lib/confirmation-repository';
import type { ModuleKey } from '@/lib/module-types';

export function canAccessConfirmationRecord(session: SessionData, record: { module: ModuleKey | string | null }): boolean {
  if (session.role === 'admin') return true;
  if (!record.module) return false;
  return canMutateRecord(session, record.module as ModuleKey);
}

export async function fetchConfirmationOrForbidden(
  session: SessionData,
  recordId: string
): Promise<{ ok: true; record: UnifiedConfirmationRecord } | { ok: false; status: 403 | 404 }> {
  const record = await findUnifiedById(recordId);
  if (!record) return { ok: false, status: 404 };
  if (!canAccessConfirmationRecord(session, record)) return { ok: false, status: 403 };
  return { ok: true, record };
}
