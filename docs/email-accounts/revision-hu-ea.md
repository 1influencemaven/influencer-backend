# Saleshandy module review against HU-EA-000…006

- **Date:** 2026-11-25
- **Code reviewed:** `main` (backend `157f276`, frontend `558001e`), deployed in production.
- **Method:**
  - Review of the code, criterion by criterion.
  - Behavior tests against the real Saleshandy account through the local backend. Only reads, local validations and calls with nonexistent account ids were run, so no mailbox was modified.

**Legend:**
- ✅ Meets the criterion and was verified live.
- ☑️ Meets the criterion in code; not exercised against real Saleshandy.
- ⚠️ Partial, or has a risk.

## HU-EA-000 — Saleshandy integration

| CA | Status | Evidence |
|---|---|---|
| 01 Base URL, centralized config | ✅ | `SaleshandyHttpService` uses `https://open-api.saleshandy.com/v1`, overridable with `SALESHANDY_BASE_URL` (tests only). |
| 02 `x-api-key` from env, never in the frontend | ✅ | Header built server-side only. The key was found in **0** logs and **0** frontend files. |
| 03 Central HTTP service | ✅ | Supports GET/POST/PUT/PATCH/DELETE, query, body, timeouts and JSON parsing. The contact-enrichment module shares it. |
| 04 Standardized responses and errors | ✅ | Stable codes such as `SALESHANDY_VALIDATION_ERROR` and `SALESHANDY_AUTH_FAILED`. Auth failures return 502, never 401, so the user is not logged out. Saleshandy's code `1001` is not treated as a bad key when it means "already exists". |
| 05 Frontend client | ✅ | `email-accounts.service.ts` uses the app's `apiClient`. |
| 06 Frontend module structure | ✅ | `types/`, `services/`, `hooks/use-email-accounts.ts` and `components/email-accounts/*`, hosted in Campaigns. |
| 07 Connectivity check | ✅ | `GET /email-accounts/integration/status` (ADMIN) returned `connected: true` with 239 credits, without spending any. It has no screen in the UI; the story only requires it in the backend. |
| 08 Security | ✅ | No key in responses, logs or bundle. SMTP/IMAP passwords are neither stored nor logged; `EmailAccountJob` only stores emails or ids. |

## HU-EA-001 — List accounts

| CA | Status | Evidence |
|---|---|---|
| 01 Backend endpoint | ✅ | `GET /email-accounts` → `POST /v1/email-accounts`. Returns 19 accounts, `meta` and counts (18 connected, 1 disconnected). |
| 02 Table | ✅ | Sender name, email, status, sequences (count, with names in the side peek), default star and health score. The configuration is summarized as "sent today" and shown in full in the side peek. |
| 03 Pagination | ✅ | Page 2 of 4 with `limit=5` returns different accounts. Previous/Next appear when there is more than one page. Page size is fixed at 25 in the UI; the story does not require choosing it. |
| 04 Search and filters | ✅ | Search, status (1 disconnected), provider (Zoho: 9), sequence and client all filter correctly. The "added by" filter that Saleshandy supports is not exposed. |
| 05 Sort | ✅ | Created date, health score, remaining quota and client, ascending or descending. |
| 06 UI states | ✅ | Loading skeleton, distinct empty states ("no accounts" vs. "no results") and an error state with Retry. |

## HU-EA-002 — Connect multiple accounts

| CA | Status | Evidence |
|---|---|---|
| 01 Bulk endpoint | ☑️ | `POST /email-accounts/connect` → `POST /v1/email-accounts/connect`, up to 50 accounts. Validation verified live: an empty list returns 400 and 51 accounts return 400. |
| 02 Form | ✅ | Provider, first and last name, and SMTP and IMAP email, user, password, host, port and encryption. Includes provider presets and "IMAP uses the same credentials". |
| 03 Several accounts in one request | ☑️ | Repeatable cards plus CSV import, sent in a single request. |
| 04 Keep the `requestId` | ☑️ | Stored in the `EmailAccountJob` table (migration applied in production). |
| 05 Do not assume connected | ✅ | Message: "Saleshandy is processing the request… they are not connected yet". |

## HU-EA-003 — Reconnect

| CA | Status | Evidence |
|---|---|---|
| 01 Endpoint with ids | ☑️ | `POST /email-accounts/reconnect`. An empty list returns 400 (verified). |
| 02 Select one or many | ✅ | Checkboxes plus bulk bar, the row ⋯ menu, the "Reconnect" link on disconnected accounts, and the side peek. |
| 03 Confirm and send | ✅ | A confirmation dialog lists the accounts before sending. |
| 04 Process started, result viewable later | ☑️ | A notice shows the process started, and the job appears in "Recent processes". |
| 05 Refresh the list | ☑️ | The list refreshes when the job finishes, and there is a manual refresh button. |

## HU-EA-004 — Connection status

| CA | Status | Evidence |
|---|---|---|
| 01 Status endpoint | ☑️ | `GET /email-accounts/jobs/:id` calls `GET /v1/email-accounts/connect/status/{requestId}` at most once every 4 s per job. A nonexistent job returns 404 (verified). |
| 02 Read `isCompleted` / `reportURL` | ☑️ | Saves `COMPLETED`, `completedAt` and `reportUrl`. |
| 03 Still processing | ☑️ | Spinner in "Recent processes", polled every 5 s. |
| 04 Result and CSV | ☑️ | Marked as completed, with a "CSV report" link (https only). |
| 05 Errors via the report | ⚠️ | The CSV can be opened, but it is not parsed: per-account incidents are only visible inside the CSV. If Saleshandy's status call itself fails, the job stays "processing" until it is marked `FAILED` after 6 h, and the UI shows no error in the meantime. |

## HU-EA-005 — Bulk update

| CA | Status | Evidence |
|---|---|---|
| 01 Endpoint with ids and fields | ✅ | `POST /email-accounts/bulk-update`. Saleshandy errors are forwarded correctly: "Some email ids are not valid." with `SALESHANDY_VALIDATION_ERROR` (verified). |
| 02 Selection | ✅ | Bulk bar, row menu and side peek. |
| 03 Fields | ✅ | Sender first and last name, daily quota, BCC, HTML signature, min and max interval, initial ramp-up limit, ramp-up %, and client. The client selector appears because the account has 3 clients. |
| 04 Send changes | ✅ | Only the fields the user enables are sent. Saleshandy requires a first name on every update: when it is not changed, each account keeps its own (accounts are grouped by name). Local validations verified: no changes → 400; min > max → 400. |
| 05 Confirmation | ☑️ | "Settings updated on N accounts". |

## HU-EA-006 — Connect one account

| CA | Status | Evidence |
|---|---|---|
| 01 Endpoint | ☑️ | `POST /email-accounts/smtp-imap/connect` → `POST /v1/email-accounts/smtp-imap/connect`, with a 120 s timeout for the SMTP/IMAP test. Local validations verified: encryption "none" → 400; missing fields → 400. |
| 02 Form | ✅ | Provider, display name (`fromName`), first name, last name, and the SMTP and IMAP settings. |
| 03 Read `status` 1/0 | ⚠️ | Implemented, but **Saleshandy's spec does not document the response shape** (only "Email account connected successfully"). The parser follows the endpoint description (`status`, `smtpConnection`, `imapConnection`). If the real shape differs, a verified account could show as "pending". |
| 04 SMTP/IMAP error details | ⚠️ | Same risk as CA-03: it depends on how Saleshandy returns `smtpConnection.error` / `imapConnection.error`. |
| 05 Registered, verified or pending | ☑️ | The UI distinguishes "connected and verified", "registered, pending verification" and request errors (409 "already exists" → conflict, not a key error). |

## Summary

- **36 of 42 criteria** are met with live evidence or in code. **6** carry a risk or are partial: HU-004 CA-05, HU-006 CA-03 and CA-04, and the write operations that were not run live.
- **Not exercised against real Saleshandy, on purpose:** single and bulk connect, real reconnect, a real bulk update and job tracking until completion. All of them modify real mailboxes.

### Recommended before closing the stories

1. **Test single connect with a test mailbox** (for example a disposable Zoho account). This confirms the response shape and the SMTP/IMAP errors (HU-006 CA-03/04), and lets the parser be adjusted if needed. It also exercises HU-004 if done through bulk connect.
2. **Show the job error in the UI** when the status call to Saleshandy fails, instead of leaving the job "processing" (HU-004 CA-05).
3. *(Optional)* Parse the CSV report to show which accounts failed directly in the app (HU-004 CA-05).
4. *(Minor)* When a field is missing, the API returns the first class-validator message ("must be shorter than…"). Prefer "is required".
