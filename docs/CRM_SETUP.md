# Leads & Calling (CRM) — setup and deployment guide

This guide covers the Lead Management & Calling system that lives in the
**admin panel** (`/leads`) and the **employee panel** (`/my-leads`). The same
file is in both repositories.

## How it works

| Piece | Where | Notes |
|---|---|---|
| Lead data | Firestore project `admin-panel-bae8d` (the one `ADMIN_SERVICE_ACCOUNT` points to) | Collections under `users/{companyId}/`: `crmLeads` (+ `activities` subcollection), `crmFollowups`, `crmCalls`, `crmPhoneIndex`, `crmSettings`, `crmActiveCalls`. Top level: `crmCallTokens`, `crmCallIndex`. |
| Admin APIs | admin panel `pages/api/crm/*` | Need the HttpOnly `cc_crm_admin` cookie, which is issued by `POST /api/crm/session` after the normal admin login. |
| Employee APIs | employee panel `pages/api/crm/*` | Need the existing signed `employeeSession` cookie. Company and employee come from the cookie, never from the request. |
| Calling | employee panel + Plivo | Browser SDK v2.2.21 (served from `/public/vendor/plivo`) and the Plivo Voice REST API. |

All CRM reads and writes go through the server with `firebase-admin`. The
browser never touches the CRM collections directly.

### Phone number privacy

* Numbers are **encrypted** before they are stored (AES-256-GCM, key in
  `CRM_PHONE_ENCRYPTION_KEY`). Firestore only holds ciphertext, a keyed hash
  (used to block duplicates) and a mask such as `XXXXXXXX45`.
* Admin APIs decrypt the number for admins. Employee APIs use an explicit
  allowlist of fields and only ever return the mask. Call logs, activities,
  URLs and logs never contain the number.
* Phone digits are not searchable by employees, so a number cannot be guessed
  digit by digit through search.

### Call flow (why the employee never receives the number)

1. The employee clicks **Call**. The browser calls `POST /api/crm/calls/initiate`
   with the lead id only.
2. The server checks that the lead is assigned to this employee and that the
   employee has no other active call. It creates a call record and a random,
   single-use **call token** that expires after 2 minutes. Only that token is
   returned.
3. The browser (logged in to Plivo with a short-lived access token that
   allows outgoing calls only) dials the token through Plivo WebRTC.
4. Plivo calls our **Answer URL** (`/api/crm/plivo/answer`). The server checks
   Plivo's `X-Plivo-Signature-V3` signature, consumes the token, decrypts the
   lead's number and replies with `<Dial callerId="…"><Number>…</Number></Dial>`.
   The number only travels between our server and Plivo.
5. Plivo reports progress to `/api/crm/plivo/dial-events` (customer answered),
   `/api/crm/plivo/dial-status` (final status and talk time) and the
   Application **Hangup URL** `/api/crm/plivo/hangup`. All are signature-checked
   and idempotent.

Whatever the browser dials is ignored: a call without a valid token is hung up,
so an employee cannot use the dialer to call arbitrary numbers.

**Known limits (be aware):**
* The customer sees your Plivo **caller ID**, not the employee's number.
* The employee talks to the customer, so the customer can say their number
  out loud. Software cannot prevent that.
* Before going live, confirm in the browser DevTools (Network → WS frames of
  the Plivo connection) during a real test call that the customer number does
  not appear in any SIP message. Our server never sends it to the browser,
  and this check confirms Plivo does not echo it either.

---

## 1. Environment variables (Vercel)

Vercel → your project → **Settings → Environment Variables**. Add each value
for **Production** (and Preview if you use preview deployments), then
**redeploy** so the new values take effect.

### Admin panel project

| Variable | New? | Value |
|---|---|---|
| `ADMIN_SERVICE_ACCOUNT` | existing | Service-account JSON for `admin-panel-bae8d` (already set) |
| `EMPLOYEE_SERVICE_ACCOUNT` | existing | Service-account JSON for `employee-panel-7a54c` (already set; used only by the one-time migration of old leads) |
| `CRM_PHONE_ENCRYPTION_KEY` | **new** | 32 random bytes, base64. **Same value in both panels.** |
| `CRM_SESSION_SECRET` | **new** | 48+ random characters. Admin panel only. |
| `CRM_DEFAULT_COUNTRY_CODE` | optional | `91` (default) |

### Employee panel project

| Variable | New? | Value |
|---|---|---|
| `SESSION_SECRET` | existing | Already set (signs `employeeSession`) |
| `ADMIN_SERVICE_ACCOUNT` | existing | Service-account JSON for `admin-panel-bae8d` (already set) |
| `CRM_PHONE_ENCRYPTION_KEY` | **new** | **Exactly the same value as in the admin panel** |
| `CRM_DEFAULT_COUNTRY_CODE` | optional | `91` |
| `PLIVO_AUTH_ID` | **new** | Plivo console → Overview (Account) → **Auth ID** |
| `PLIVO_AUTH_TOKEN` | **new** | Plivo console → Overview (Account) → **Auth Token** |
| `PLIVO_APPLICATION_ID` | **new** | Plivo console → Voice → **Applications** → the app from step 2 → **App ID** |
| `PLIVO_CALLER_ID` | **new** | A Plivo voice number you own, E.164, e.g. `+9180XXXXXXXX` |
| `PLIVO_PHONE_NUMBER` | optional | Used as caller ID only when `PLIVO_CALLER_ID` is empty |
| `PLIVO_WEBHOOK_BASE_URL` | **new** | The employee panel's public URL, `https://…`, **no trailing slash** (your custom domain or `https://<project>.vercel.app`) |
| `PLIVO_RING_TIMEOUT` | optional | Seconds to ring the customer, 10–120 (default 45) |

Generate the secrets on your own computer:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> ⚠️ Never change `CRM_PHONE_ENCRYPTION_KEY` after leads exist: stored numbers
> can no longer be decrypted. Keep a copy in a password manager.
> Never prefix Plivo or CRM variables with `NEXT_PUBLIC_`: that would send
> them to the browser.

## 2. Plivo console setup

1. **Account and KYC.** Calls to Indian mobile numbers need a Plivo account
   enabled for India, completed compliance/KYC, and an Indian number that is
   allowed as caller ID. Check Plivo's current India requirements in the
   console (Phone Numbers / Compliance) and with Plivo support before going
   live.
2. **Buy or verify the caller ID number.** Phone Numbers → Buy (or verify
   an existing number). Put it in `PLIVO_CALLER_ID` in `+91…` format.
3. **Create the Application.** Voice → Applications → *Add new application*:
   * **Answer URL:** `https://<employee-panel-domain>/api/crm/plivo/answer`, method **POST**
   * **Hangup URL:** `https://<employee-panel-domain>/api/crm/plivo/hangup`, method **POST**
   * Leave the Fallback URL empty.
   * Save, then copy the **App ID** into `PLIVO_APPLICATION_ID`.

   Use the same domain as `PLIVO_WEBHOOK_BASE_URL`. The signature check uses
   that variable to rebuild the URL Plivo signed, so the two must match exactly.
4. **Auth credentials.** Copy the **Auth ID** and **Auth Token** from the
   console overview into `PLIVO_AUTH_ID` and `PLIVO_AUTH_TOKEN`.

The dial-status and dial-events URLs are generated by the server from
`PLIVO_WEBHOOK_BASE_URL`. You do not configure them in the console.

No Plivo SIP endpoint per employee is needed: each employee gets a short-lived
access token (`POST /api/crm/calls/token`) scoped to outgoing calls through
this application.

## 3. Firestore indexes

The queries need the composite indexes in
`cyberclipper-admin-panel/firebase/firestore.indexes.json`, created in the
**admin-panel-bae8d** project. Either:

* **Firebase CLI:** copy the file to your Firebase project folder as
  `firestore.indexes.json`, then run the command below. Do not use `--force`,
  which deletes indexes that are not in the file.

```bash
firebase deploy --only firestore:indexes --project admin-panel-bae8d
```

* **Or on demand:** if an index is missing, the Leads screen shows an error
  with a **Create the required database index** link. Open it, click
  **Create**, wait a few minutes, then retry.

## 4. Firestore rules (important)

The panels' existing pages read Firestore directly from the browser with the
public web config. If your rules are open (for example
`allow read, write: if true` on everything), **anyone on the internet can read
and change that data.** For the CRM, phone numbers are encrypted, but names and
emails would still be readable.

Merge `cyberclipper-admin-panel/firebase/firestore.crm.rules` into the rules of
the `admin-panel-bae8d` project. Rules are OR-ed, so a broad wildcard allow
cancels the CRM deny. Replace any `match /{document=**}` allow-all with
explicit rules for the collections the browser really needs. Test in the
Firebase console's Rules Playground before publishing.

## 5. Moving the old leads

Old leads were stored per employee in the employee-panel Firestore. Admin
panel → Leads → **Settings → Run migration** copies them into the new system,
assigned to the employee who created them. It is safe to run more than once.
After checking the copied leads, run it again with **Also remove the
plain-text phone numbers** ticked, so the old records no longer hold readable
numbers.

## 6. Go-live checklist

* [ ] All variables set in both Vercel projects, both redeployed.
* [ ] `CRM_PHONE_ENCRYPTION_KEY` identical in both projects.
* [ ] Firestore indexes created (step 3) and rules updated (step 4).
* [ ] Admin: sign out and sign in again, open **Leads**, create a lead, assign it.
* [ ] Employee: sign in, open **My Leads**, confirm the number shows as `XXXXXXXX45`.
* [ ] Real test call to your own mobile: Call → ringing → connected → mute/unmute → hang up.
* [ ] Call history shows the call with the right duration. The lead timeline shows initiated, connected and ended.
* [ ] A rejected/unanswered test call shows as *No answer* / *Busy* / *Failed*.
* [ ] During the call, DevTools → Network shows no request or WebSocket frame with the full number.
* [ ] Run the migration (step 5).

## API reference (summary)

Admin panel (cookie `cc_crm_admin`, header `x-crm-request: 1` on writes):
`POST|GET|DELETE /api/crm/session`, `GET|POST /api/crm/leads`,
`GET|PATCH|DELETE /api/crm/leads/:id`, `GET|POST /api/crm/leads/:id/activities`,
`POST /api/crm/leads/:id/followups`, `POST /api/crm/leads/assign`,
`POST /api/crm/leads/import`, `GET /api/crm/followups`,
`PATCH /api/crm/followups/:id`, `GET /api/crm/calls`, `GET /api/crm/analytics`,
`GET /api/crm/employees`, `GET|PUT /api/crm/settings`, `POST /api/crm/migrate-legacy`.

Employee panel (cookie `employeeSession`, header `x-crm-request: 1` on writes):
`GET|POST /api/crm/my-leads`, `GET|PATCH|DELETE /api/crm/my-leads/:id`,
`POST /api/crm/my-leads/:id/notes`, `POST /api/crm/my-leads/:id/followups`,
`GET /api/crm/followups`, `PATCH /api/crm/followups/:id`, `GET /api/crm/calls`,
`POST /api/crm/calls/token`, `POST /api/crm/calls/initiate`,
`GET /api/crm/calls/:id`, `POST /api/crm/calls/:id/hangup`,
`POST /api/crm/calls/:id/outcome`.
Plivo webhooks (signature-checked): `/api/crm/plivo/answer`, `/hangup`,
`/dial-status`, `/dial-events`.
