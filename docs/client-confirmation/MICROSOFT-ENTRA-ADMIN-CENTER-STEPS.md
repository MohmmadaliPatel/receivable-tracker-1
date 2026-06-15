# Microsoft Entra Admin Center — App Registration & Credential Steps for Taxteck Email Auto

**Purpose**  
The application sends, fetches, replies to, and forwards email **exclusively via Microsoft Graph using the client credentials (app-only) flow**. No delegated user login or interactive OAuth is used for the core confirmation workflows. Each `EmailConfig` row stores its own `msTenantId`, `msClientId`, and `msClientSecret`; the app obtains short-lived access tokens at runtime and never stores Graph refresh tokens.

**Exact permissions required**

| Permission | Purpose |
|------------|---------|
| `Mail.Send` | Send confirmation emails and threaded replies |
| `Mail.Read` | Read inbox messages, MIME content, and conversation threading |
| `Mail.ReadWrite` | Create reply drafts and modify messages in the reply workflow |
| `User.Read` | Resolve the configured mailbox (`fromEmail`) in Graph API calls |

All flows use OAuth2 **client credentials** with scope `https://graph.microsoft.com/.default`. The registered app must be granted **Application (app-only)** permissions, and an administrator must click **Grant admin consent** for the tenant.

**Token request (app-only flow):**

```
POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

client_id={clientId}
&client_secret={clientSecret}
&scope=https://graph.microsoft.com/.default
&grant_type=client_credentials
```

**Send mail (example Graph endpoint):**

```
POST https://graph.microsoft.com/v1.0/users/{fromEmail}/sendMail
Authorization: Bearer {access_token}
```

## 10-Step Guide (Entra Admin Center)

1. **Sign in**  
   Go to https://entra.microsoft.com (or https://portal.azure.com → Microsoft Entra ID). Sign in with a Global Administrator or Privileged Role Administrator account for the target tenant.

2. **Navigate to App Registrations**  
   Left nav: **Applications** → **App registrations** → **+ New registration**.

3. **Register the application**  
   - Name: e.g. `Taxteck-Email-Auto-Prod` (or per-environment).  
   - Supported account types: **Accounts in this organizational directory only (Single tenant)** — recommended for least privilege.  
   - Redirect URI: leave blank (this is app-only; no user-facing sign-in redirect).  
   Click **Register**.  
   On the Overview page, note:  
   - **Application (client) ID** → `msClientId`  
   - **Directory (tenant) ID** → `msTenantId`

4. **Add Microsoft Graph Application permissions**  
   Left nav on the app: **API permissions** → **+ Add a permission** → **Microsoft Graph** → **Application permissions** (not Delegated).  
   Search and select exactly:  
   - `Mail.Send`  
   - `Mail.Read`  
   - `Mail.ReadWrite`  
   - `User.Read`  
   Click **Add permissions**.  
   The list should show "Application" type for all four.

5. **Grant admin consent**  
   Still on **API permissions**, click **Grant admin consent for <Your Tenant Name>** (big blue button at the top).  
   Confirm. All four permissions should now show a green "Granted" checkmark under Status.  
   (Without consent the client credentials grant will fail with AADSTS65001 or similar.)

6. **Create a client secret**  
   Left nav: **Certificates & secrets** → **+ New client secret**.  
   - Description: e.g. `Taxteck-Email-Auto-2026-06` (include date/rotation cycle).  
   - Expires: choose per your policy (90/180/365 days; shorter is better).  
   Click **Add**.  
   **Immediately copy the Value** (the long secret string). It will never be shown again.  
   The Secret ID is just metadata; you need the **Value**.

7. **Create the EmailConfig in the application**  
   Log into Taxteck Email Auto as an administrator → **Email Config** (or `/email-config`).  
   - **Add new** (or edit an existing).  
   - Tenant ID: paste the Directory (tenant) ID from step 3.  
   - Client ID: paste the Application (client) ID from step 3.  
   - Client Secret: paste the **Value** you copied in step 6 (it will be echoed back once in the create response for you to copy locally if needed; subsequent GETs return `***`).  
   - From Email: the **exact UPN** (or primary SMTP address) of the mailbox the app should send as / read from. This must be a valid mailbox in the tenant that the app has been granted the Mail.* permissions on (usually the same account or a shared mailbox for which the app has Send As / Full Access via Entra or Exchange).  
   - (Optional) Display name / description for the config.  
   Save. The create response will return the config (with the secret visible **only this once** for immediate copy). After that, list and detail views mask it.

8. **Validate the configuration**  
   In the EmailConfig row, click **Validate**.  
   - Success: `{ valid: true }` (green). An `EMAIL_CONFIG_VALIDATE` audit entry with success=true is written.  
   - Failure: error message (e.g., "AADSTS70002: ... invalid client secret", "The user or administrator has not consented...", "invalid_grant", "fromEmail not found or insufficient privileges", etc.). The audit entry records success=false + the error detail.  
   Fix the Entra app or the values and re-validate until green.

9. **Activate + Test end-to-end**  
   - Toggle **Active** (and optionally **Cron Enabled**) on the config.  
   - Create at least one **Sender** (the from addresses you expect to process).  
   - Use the UI to send a test confirmation (Trade or MSME) to a known recipient.  
   - Verify delivery in the recipient mailbox.  
   - Click the public confirmation link (or reply to the email) and complete the flow (confirm/decline/upload).  
   - Check that replies are fetched/forwarded (if forwarders configured) and that threaded replies (if used) appear correctly.  
   - As admin, go to Audit Logs and confirm the `EMAIL_CONFIG_VALIDATE`, `EMAIL_CONFIG_ACTIVATE`, `PUBLIC_RESPONSE_*`, and any `CRON_*` entries appear with correct IP/UA/resource.

10. **Rotation, monitoring, and decommissioning**  
    - **Rotation cadence**: per your secret policy (e.g., every 90 days or on suspected exposure). In Entra: create a *new* client secret (step 6), update the EmailConfig in the app with the new Value, Validate (step 8), confirm success, then delete the old secret in Entra.  
    - **Monitor**: In Entra → Monitoring → Sign-in logs (filter by the App ID or Service Principal). Look for successful client credentials tokens and any failures (bad secrets, consent issues, etc.).  
    - **Decommission**: Remove the EmailConfig in the app (or set inactive), then delete the app registration in Entra (or at minimum remove its permissions and secrets). Revoke any consents if the app is no longer needed.  
    - **Least privilege reminder**: Do not add broader permissions unless a specific requirement justifies it. The four permissions above are the minimum required for send, fetch, reply, and forward operations.

---

## Common Errors & Troubleshooting

- **"AADSTS70002: Invalid client secret" or "Invalid client secret provided"**  
  You pasted the Secret *ID* instead of the *Value*, or the secret has expired / been deleted. Create a fresh one and paste the new Value.

- **"AADSTS65001: The user or administrator has not consented..."**  
  Admin consent was not granted (step 5). Go back to API permissions and click the consent button for the whole tenant.

- **"The mailbox is either inactive, soft-deleted, or ... fromEmail not valid" / 404 on sendMail**  
  The `fromEmail` value in the EmailConfig must be the exact UPN (usually `user@tenant.onmicrosoft.com` or custom domain) of a mailbox that exists and for which the app has Send As rights. Test by sending a simple message from that mailbox in Outlook/Exchange first.

- **"Access denied" or 403 on Graph calls after token success**  
  Consent was granted but the specific mailbox permissions (Send As / Full Access) may be missing at the Exchange level, or the mailbox is in a different tenant/region. Verify the service principal has the required Exchange Online permissions for the target mailbox.

- **Token request fails with "invalid_grant" or "unauthorized_client"**  
  App registration may have "Accounts in any organizational directory" selected while the mailbox is in a different tenant, or the app is disabled. Use single-tenant + correct tenant ID.

- **Validation passes but no mail arrives / replies not seen**  
  Check the Sender list for the config, the "from" address on the template, spam/junk filters, and that the mailbox actually has a license/Exchange plan. Use Graph Explorer (with the same app credentials) to test `/users/{fromEmail}/messages` and `/users/{fromEmail}/sendMail` directly.

- **"Insufficient privileges to complete the operation" on createReply / MIME**  
  The app needs `Mail.ReadWrite` for drafts/replies and `Mail.Read` for MIME download. Re-check the exact four permissions and re-grant consent after adding any missing one.

- **Production logging:** Client ID and tenant ID may appear in diagnostic logs when `DEBUG=true`. Client secret values must never appear in logs. If a secret is logged, rotate it immediately.

---

## Security Notes (Summary)

- Treat the client secret like a high-value credential: store it only in the app's EmailConfig (masked on read), rotate on schedule or incident, never commit to git or share in tickets.  
- The Entra app should have **no user-facing sign-in** (no redirect URIs, no implicit/flow for users). It is purely for client_credentials.  
- Monitor sign-in logs and Graph throttles.  
- If you ever need to support multiple environments (dev/staging/prod), create separate app registrations (or separate secrets + separate EmailConfig rows) rather than sharing one secret across environments.  
- The application uses **app-only** tokens only — no delegated user login for email operations.

---

*End of Entra steps.*  
After completing these steps you will have a working `EmailConfig` that the application can use for all send/fetch/reply/forward operations via Microsoft Graph app-only.