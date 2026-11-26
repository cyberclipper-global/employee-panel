# Security, sign-in and deployment

This document covers the admin panel **and** the employee panel (the same file
is in both repositories). It explains what changed, what you must configure,
and the exact order to deploy in.

## What changed

| Area | Before | Now |
|---|---|---|
| Sign-in | Company ID + Unique ID only, checked in the browser. `123`/`123` logged into a real admin account. | **Email + one-time code**, checked on the server: the person types their registered email, receives a 6-digit code (valid 10 minutes, single use, 5 attempts) and is signed in. No IDs, passwords or captcha. If one email belongs to several companies/accounts, the person picks one. Backdoor removed. |
| Sessions | Browser-readable cookies; the admin cookie was encrypted with a key shipped to the browser; employees could mint a session for any ID through `/api/createSession`. | HttpOnly, signed cookies (`cc_admin_session`, `employeeSession`) issued only after the full sign-in. An admin can sign an employee out everywhere. Logout really ends the session. |
| Identity in URLs | `?token=` was AES-encrypted with the hard-coded key `cyberclipperSecretKey123!` and contained the admin's sign-in ID. | Pages get the company/user ID from the server session. `?token=s` is a meaningless marker kept for compatibility. The hard-coded key is gone from the code. |
| Database access | Browsers read and wrote Firestore with the public config. With open rules, anyone on the internet could read or change any company's data. | After sign-in the browser receives a Firebase **custom token** whose claims say which company (and employee) it is. **Firestore rules** (`firebase/firestore.rules`) restrict every read/write to that company and, for employees, to their own records. Credentials, CRM data and password vaults are server-only. |
| API routes | Most routes accepted `companyId`/`employeeId` from the request with no login. `/api/get-token` gave an admin token for any company. | Every route requires a session (or a server-to-server secret), checks that the IDs in the request match the session, and blocks cross-site requests. Integration endpoints verify JWT signatures (before, some only decoded them). Test/debug routes were removed. |
| Password vault | Encrypted in the browser with the hard-coded key. | Encrypted on the server (`/api/vault`). Old entries are converted automatically the first time they are opened. |
| Speed / cost | 47 live listeners, re-created on every page change; unbounded lists; the admin DWR page read every report of every employee one after another. | Identical listeners are shared and kept briefly across page changes; growing lists are capped; DWR reads run in parallel and only fetch recent reports (single documents where possible). |

## How people sign in

1. Open the login page and type the registered email address.
2. A 6-digit code arrives by email (company document `email` for admins,
   employee document `email` for employees).
3. Type the code → signed in.

**Before go-live:**

- Every company and employee record must have the person's real email,
  otherwise they cannot sign in.
- Run the one-time backfill so emails saved with capital letters also match
  (it adds a lower-case copy, `emailLower`):

```bash
cd cyberclipper-admin-panel && ADMIN_SERVICE_ACCOUNT='<json>' EMPLOYEE_SERVICE_ACCOUNT='<json>' node scripts/backfill-email-lower.mjs
```

- Deploy the Firestore **indexes** (employee sign-in looks employees up by
  email across companies and needs them; see "Deployment order").

To stop someone from signing in, remove or change the email on their record.
**Passwords & Security → Sign an employee out everywhere** ends their current
sessions immediately.

## Employee Firebase project

The employee panel uses the Firebase project **`employee-27679`** (it moved
from `employee-panel-7a54c`). After switching:

1. Vercel (employee panel **and** admin panel): set `EMPLOYEE_SERVICE_ACCOUNT`
   to the service-account JSON of `employee-27679` (Firebase console →
   Project settings → Service accounts → Generate new private key). Redeploy
   both. If the old JSON is still there, the employee panel shows an error
   naming the wrong project.
2. Firebase console of `employee-27679`: create the **Firestore database**
   and click **Authentication → Get started**.
3. Copy the old data: employee-panel repository → Actions →
   **Copy employee data to new Firebase project** → Run workflow (secrets
   `OLD_EMPLOYEE_SERVICE_ACCOUNT` = old JSON, `EMPLOYEE_SERVICE_ACCOUNT` = new
   JSON). Existing documents in the new project are never overwritten; it
   can be run again safely. (Or locally: `node scripts/migrate-employee-project.mjs`.)
4. Publish the rules: Actions → **Deploy Firestore rules**. Indexes: admin
   panel → Leads → Settings → **Set up database indexes** (give the new
   service account the "Cloud Datastore Index Admin" role) or Actions →
   **Deploy Firestore indexes**.

## Environment variables (Vercel)

Vercel → project → **Settings → Environment Variables** (Production and, if
used, Preview). Redeploy after changing them.

Generate random values on your own computer:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Admin panel

| Variable | Status | Value |
|---|---|---|
| `ADMIN_SERVICE_ACCOUNT` | existing | Service-account JSON of `admin-panel-bae8d` |
| `EMPLOYEE_SERVICE_ACCOUNT` | existing | Service-account JSON of `employee-27679` |
| `AUTH_SESSION_SECRET` | **new, required** | 48+ random characters (base64url command) |
| `AUTH_ENCRYPTION_KEY` | **new, required** | 32 random bytes base64 (first command). **Same value in both panels.** Encrypts vault entries and other server secrets. |
| `CRM_PHONE_ENCRYPTION_KEY` | from Leads release | Same value in both panels |
| `JWT_SECRET` | existing, **now required** | 32+ random characters. Signs product-integration tokens. If yours is shorter, replace it (existing integration tokens then need to be fetched again). |
| `INTERNAL_API_SECRET` | **new, required** | 32+ random characters. **Same value in both panels.** Used for server-to-server calls. |
| `LEGACY_VAULT_KEY` | **new, temporary** | `cyberclipperSecretKey123!` — only so old vault entries can be converted. Remove it once users have opened their vaults. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `FROM_EMAIL` | existing, **now required** | Sign-in codes are emailed; without working SMTP nobody can sign in. |
| `APP_BASE_URL` | optional | Admin panel URL used in the sign-up email. |
| `EMPLOYEE_PANEL_URL`, `INTERN_PANEL_URL` | optional | Targets of the shareable sign-in links. |
| `LOGIN_LINK_SECRET` | optional | If the intern system verifies signed links, set it to the secret configured there. |
| `NEXTAUTH_URL` | existing | Admin panel URL, used for internal calls. |

### Employee panel

| Variable | Status | Value |
|---|---|---|
| `SESSION_SECRET` | existing, **now 32+ characters** | Signs `employeeSession`. Changing it signs everyone out once. |
| `ADMIN_SERVICE_ACCOUNT` | existing | Service-account JSON of `admin-panel-bae8d` |
| `EMPLOYEE_SERVICE_ACCOUNT` | **new for this project** | Service-account JSON of `employee-27679` (the same value the admin panel already has) |
| `INTERN_SERVICE_ACCOUNT` | existing | Unchanged |
| `AUTH_ENCRYPTION_KEY`, `CRM_PHONE_ENCRYPTION_KEY`, `INTERNAL_API_SECRET` | see above | **Same values as the admin panel** |
| `LEGACY_VAULT_KEY` | **new, temporary** | `cyberclipperSecretKey123!` (see above) |
| `SMTP_*` | existing, **now required** | As above |
| `NEXTAUTH_URL` | existing | **Admin panel** URL (internal Cloudinary delete call) |
| `PLIVO_*` | from Leads release | See CRM_SETUP.md |

Never prefix secrets with `NEXT_PUBLIC_`. `NEXT_PUBLIC_FIREBASE_EMULATOR`
must **not** be set in production (it is only for local testing).

## Firebase console (both projects)

1. **Authentication → Get started** in `admin-panel-bae8d` and in
   `employee-27679`. No sign-in provider needs to be enabled; custom
   tokens only need Authentication to be initialised.
2. The service accounts in the env vars sign the custom tokens locally; no
   extra IAM role is needed.

## Deployment order (important)

1. Set all environment variables above in **both** Vercel projects.
2. Deploy **both** apps (this branch).
3. Sign in once as an admin and as an employee to check the flow.
   Run the email backfill script (see "How people sign in") and deploy the
   **indexes right away** — employee sign-in needs them (takes a few minutes
   to build):

```bash
cd cyberclipper-admin-panel/firebase && firebase deploy --only firestore:indexes --project admin-panel-bae8d
```

```bash
cd employee-panel/firebase && firebase deploy --only firestore:indexes --project employee-27679
```

4. Then publish the Firestore rules (until now the old open rules keep
   working, so nothing breaks in between):

```bash
cd cyberclipper-admin-panel/firebase && firebase deploy --only firestore --project admin-panel-bae8d
```

```bash
cd employee-panel/firebase && firebase deploy --only firestore --project employee-27679
```

   Test in the Firebase console Rules Playground if you have other apps that
   read these projects directly from a browser: they will be blocked.
5. After a few weeks, remove `LEGACY_VAULT_KEY`.

### Things that intentionally stopped working

- Signing in with Company ID / Admin ID / Employee ID, passwords, 2FA apps and the captcha (replaced by email + code).
- The `123` / `123` login shortcut.
- The HR deep link that opened the admin **Employees** page without an admin
  login (HR uses the employee panel's Employees page).
- Employee self sign-up in the employee panel (`/auth/signup` now redirects to
  login; employees are created by the admin).
- Calling the panels' APIs from other websites without a session, except the
  documented integration endpoints (`get-client-token`, `verify-access`,
  `map-path-to-product`, `login-attempts`, `products/*`), which need a valid
  signed client token. External systems that call the webhook/sync routes
  must send `x-internal-secret: $INTERNAL_API_SECRET`.
- Old `/api/createSession`, `/api/verifySession`, `/api/decryptLoginToken`,
  `/api/get-token` for other companies, test endpoints (`/api/hello`,
  `/api/test-*`), `/api/migrate-domains`.

## Tests

Unit tests (both repositories):

```bash
npm test
```

Integration tests (admin panel repository; needs Java 11+ and the employee
panel checked out next to it). Starts the Firebase emulators, a fake SMTP
server and both apps, then tests email + code sign-in, code limits, session revocation,
API protection, Firestore rules, vault and the Leads/calling flow:

```bash
npm run test:integration
```
