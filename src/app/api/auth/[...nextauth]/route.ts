import NextAuth from "next-auth"
import { authOptions } from "@/lib/auth"

// LEGACY NextAuth route handler. Not used by the active UI (simple-auth login at /api/auth/login, EmailConfig Graph flows, public confirmations, RBAC, audit, cron, etc.).
// DEMO_MODE / AZURE_* only affect this legacy path. See src/lib/auth.ts header for details and cross-references.
const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
