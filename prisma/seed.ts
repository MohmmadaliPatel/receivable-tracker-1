import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.FORCE_SEED) {
    console.log('❌ Refusing to run seed in production (would create/overwrite predictable or unwanted admin). Set FORCE_SEED=1 to override (and immediately rotate password + secrets).');
    process.exit(0);
  }

  console.log('🌱 Starting database seed...');

  // Create default admin user with a one-time random password (printed only to console on first run / when upserted).
  const defaultUsername = 'admin@taxteck.com';
  const defaultPassword = crypto.randomBytes(12).toString('base64url'); // strong, meets policy; rotate immediately after login.
  
  const hashedPassword = await bcrypt.hash(defaultPassword, 12); // cost 12 (OWASP baseline 2024+; tune for CPU; was 10)

  const user = await prisma.user.upsert({
    where: { username: defaultUsername },
    update: {
      password: hashedPassword,
      role: 'admin',
    },
    create: {
      username: defaultUsername,
      password: hashedPassword,
      name: 'Administrator',
      email: 'admin@example.com',
      role: 'admin',
    },
  });

  console.log('✅ Default user created/updated:', user.username);
  console.log('   Username:', defaultUsername);
  console.log('   Password:', defaultPassword);
  console.log('   ⚠️  IMMEDIATELY change this password after first login (and never commit or share it).');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
