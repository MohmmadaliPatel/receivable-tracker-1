import { cookies } from 'next/headers';
import { getSession, SessionData } from './simple-auth';

export async function requireAdminSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  if (!sessionToken) return null;
  const session = await getSession(sessionToken);
  if (!session || session.role !== 'admin') return null;
  return session;
}
