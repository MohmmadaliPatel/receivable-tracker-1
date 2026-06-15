import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Explicit trailing slash policy (false is Next default for app router; makes scanners see consistent 404/redirects
  // instead of ambiguous directory-like responses on file paths).
  trailingSlash: false,
  // Never ship browser source maps in production builds. Reduces "Suspicious Comments" / information disclosure
  // surface in client bundles (the 23 Informational instances in this dev scan were React/Next internals in turbopack chunks).
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Basic CSP for Next.js + TipTap (rich text). 'unsafe-inline'/'unsafe-eval' retained for Tailwind, TipTap editor, and Next dev/build tooling.
          // Added explicit object-src/base-uri/frame-ancestors/form-action to address CSP "no fallback" and wildcard findings from scanners (e.g. ZAP).
          // img-src still allows https: for potential external assets in rendered content/PDFs; can be further restricted after review.
          // connect-src limited to self + Microsoft Graph/login (required for EmailConfig flows).
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://graph.microsoft.com https://login.microsoftonline.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self';",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
