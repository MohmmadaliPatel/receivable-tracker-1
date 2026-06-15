import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/require-admin';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { validatePassword } from '@/lib/password-policy';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

// PATCH /api/users/[id] — update user (admin only)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const meta = requestMeta(request);
  const { id } = await params;
  const body = await request.json();
  const { name, email, role, password, accessTradePayable, accessTradeReceivable, accessConfirmMsme } = body;

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (id === admin.userId && role && role !== 'admin') {
    return NextResponse.json({ error: 'Cannot remove your own admin role' }, { status: 400 });
  }

  if (password) {
    const policy = validatePassword(password);
    if (!policy.valid) {
      return NextResponse.json({ error: policy.errors.join('; ') }, { status: 400 });
    }
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name || null;
  if (email !== undefined) data.email = email || null;
  if (role !== undefined) data.role = role === 'admin' ? 'admin' : 'user';
  if (accessTradePayable !== undefined) data.accessTradePayable = !!accessTradePayable;
  if (accessTradeReceivable !== undefined) data.accessTradeReceivable = !!accessTradeReceivable;
  if (accessConfirmMsme !== undefined) data.accessConfirmMsme = !!accessConfirmMsme;
  if (password) {
    data.password = await bcrypt.hash(password, 12); // cost 12 (OWASP baseline 2024+; tune for CPU; was 10)
    // Admin password reset clears all lockout state (including the "third lockout -> admin required" flag and historical count).
    data.failedLoginAttempts = 0;
    data.lockedUntil = null;
    data.lockoutCount = 0;
    data.adminResetRequired = false;
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      role: true,
      accessTradePayable: true,
      accessTradeReceivable: true,
      accessConfirmMsme: true,
      createdAt: true,
    },
  });

  if (password) {
    // On admin password reset, invalidate ALL sessions for the target user (forces re-auth everywhere).
    await prisma.session.deleteMany({ where: { userId: id } });
  }

  await writeAuditLog({
    action: 'USER_UPDATE',
    success: true,
    userId: admin.userId,
    username: admin.username,
    resource: id,
    ...meta,
    details: {
      targetUsername: user.username,
      role: user.role,
      passwordChanged: !!password,
    },
  });

  return NextResponse.json({ user });
}

// DELETE /api/users/[id] — delete user (admin only)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const meta = requestMeta(request);
  const { id } = await params;

  if (id === admin.userId) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  await prisma.user.delete({ where: { id } });

  await writeAuditLog({
    action: 'USER_DELETE',
    success: true,
    userId: admin.userId,
    username: admin.username,
    resource: id,
    ...meta,
    details: { deletedUsername: existing.username },
  });

  return NextResponse.json({ success: true });
}
