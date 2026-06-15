import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/require-admin';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { validatePassword } from '@/lib/password-policy';
import { writeAuditLog, requestMeta } from '@/lib/audit-log';

// GET /api/users — list all users (admin only)
export async function GET() {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const users = await prisma.user.findMany({
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
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ users });
}

// POST /api/users — create new user (admin only)
export async function POST(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const meta = requestMeta(request);
  const body = await request.json();
  const {
    username,
    password,
    name,
    email,
    role,
    accessTradePayable,
    accessTradeReceivable,
    accessConfirmMsme,
  } = body;

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
  }

  const policy = validatePassword(password);
  if (!policy.valid) {
    return NextResponse.json({ error: policy.errors.join('; ') }, { status: 400 });
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, ...(email ? [{ email }] : [])] },
  });
  if (existing) {
    return NextResponse.json({ error: 'Username or email already exists' }, { status: 409 });
  }

  const hashedPassword = await bcrypt.hash(password, 12); // cost 12 (OWASP baseline 2024+; tune for CPU; was 10)

  const user = await prisma.user.create({
    data: {
      username,
      password: hashedPassword,
      name: name || null,
      email: email || null,
      role: role === 'admin' ? 'admin' : 'user',
      accessTradePayable: accessTradePayable !== undefined ? !!accessTradePayable : true,
      accessTradeReceivable: accessTradeReceivable !== undefined ? !!accessTradeReceivable : true,
      accessConfirmMsme: accessConfirmMsme !== undefined ? !!accessConfirmMsme : true,
    },
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

  await writeAuditLog({
    action: 'USER_CREATE',
    success: true,
    userId: admin.userId,
    username: admin.username,
    resource: user.id,
    ...meta,
    details: { createdUsername: user.username, role: user.role },
  });

  return NextResponse.json({ user }, { status: 201 });
}
