import { NextAuthOptions } from "next-auth"
import AzureADProvider from "next-auth/providers/azure-ad"
import CredentialsProvider from "next-auth/providers/credentials"

// LEGACY / DEMO ONLY — This NextAuth configuration (and DEMO_MODE / AZURE_* envs) powers an older Outlook delta-sync demo path.
// It is NOT used by the main application:
// - Primary login: src/app/api/auth/login + src/lib/simple-auth.ts (DB sessions, bcrypt, lockout, RBAC).
// - Email sending/fetching/forwarding/replies: EmailConfig rows + src/lib/graph-mail-service.ts + email-fetch/forward/tracking (client-credentials, app-only; no delegated user tokens).
// - Public confirmation links: jose HS256 JWTs (email-action-jwt) + public verify routes.
// DEMO_MODE and the Azure provider here have no effect on the above flows or on EmailConfig validation/activation/cron.
// See also: README Legacy note, env examples, src/app/api/auth/[...nextauth]/route.ts, and src/lib/email-service.ts (the only other DEMO check, also legacy-only).

// Utility function to refresh access token
async function refreshAccessToken(token: any) {
  try {
    const url = `https://login.microsoftonline.com/common/oauth2/v2.0/token`
    
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
      body: new URLSearchParams({
        client_id: process.env.AZURE_CLIENT_ID!,
        client_secret: process.env.AZURE_CLIENT_SECRET!,
        scope: "openid profile email https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/User.Read offline_access",
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    })

    const tokens = await response.json()

    if (!response.ok) {
      throw tokens
    }

    return {
      ...token,
      accessToken: tokens.access_token,
      accessTokenExpires: Date.now() + tokens.expires_in * 1000,
      refreshToken: tokens.refresh_token ?? token.refreshToken,
    }
  } catch (error) {
    console.error("Error refreshing access token", error)
    return {
      ...token,
      error: "RefreshAccessTokenError",
    }
  }
}

// Demo mode provider for testing without Azure AD setup
const DemoProvider = CredentialsProvider({
  name: "demo",
  credentials: {
    email: { label: "Email", type: "email", placeholder: "demo@example.com" },
    password: { label: "Password", type: "password", placeholder: "demo123" }
  },
  async authorize(credentials) {
    // Demo authentication - accept any email/password combination
    if (credentials?.email && credentials?.password) {
      return {
        id: "demo-user-1",
        email: credentials.email,
        name: "Demo User",
        image: "https://via.placeholder.com/32x32?text=DU"
      }
    }
    return null
  }
})

export const authOptions: NextAuthOptions = {
  providers: [
    // Demo provider for testing without Azure AD (LEGACY only — see file header).
    ...(process.env.DEMO_MODE === 'true' ? [DemoProvider] : []),

    // Azure AD provider (only if credentials are provided) (LEGACY only — does not affect main simple-auth or Graph EmailConfig).
    ...(process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET ? [
      AzureADProvider({
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
        tenantId: "common", // Use "common" for multi-tenant (any Microsoft account)
        authorization: {
          params: {
            scope: "openid profile email https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/User.Read offline_access"
          }
        }
      })
    ] : []),
  ],
  callbacks: {
    async session({ session, token }) {
      console.log("SESSION Callback - SESSION:", session);
      console.log("SESSION Callback - TOKEN:", token);

      // Send properties to the client
      if (token.accessToken) {
        session.accessToken = token.accessToken as string
      }
      if (token.error) {
        (session as any).error = token.error as string
      }
      
      // Set user ID from token
      if (session?.user && token?.sub) {
        session.user.id = token.sub
      }
      
      return session
    },
    async jwt({ token, account, profile }) {
      console.log("JWT Callback - TOKEN:", token);
      console.log("JWT Callback - ACCOUNT:", account);
      console.log("JWT Callback - PROFILE:", profile);

      // Persist the OAuth access_token and refresh_token to the token right after signin
      if (account) {
        console.log("Initial sign in detected, storing tokens");
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.accessTokenExpires = account.expires_at ? account.expires_at * 1000 : Date.now() + 3600 * 1000
        return token
      }
      
      // Return previous token if the access token has not expired yet
      if (Date.now() < (token.accessTokenExpires as number)) {
        console.log("Token still valid, returning existing token");
        return token
      }

      // Access token has expired, try to update it
      console.log("Token expired, attempting refresh");
      return await refreshAccessToken(token)
    },
  },
  session: {
    strategy: "jwt",
  },
}