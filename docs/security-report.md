# Independent implementation security review

Reviewer: SecurityAgent. Date: 2026-11-05 (Asia/Manila). Scope: local synthetic-data demonstration; API, SQL, browser session/offline code, and prepared deployment controls. Review occurred during integration of contract amendments 1.0.2–1.0.3. This is a targeted engineering review, not a penetration-test certification or commercial launch approval.

## Decision

Commercial deployment is **not approved**. The compiled API entrypoint deliberately refuses `NODE_ENV=production`. No live payment adapter, signed provider webhook endpoint, document upload pipeline, deployed encrypted environment, or exercised recovery procedure is available. Local demo approval remains the Principal's decision after the active findings below are resolved or explicitly scoped.

## Observed findings

| ID | Severity / status | Reproduction and impact | Required resolution |
|---|---|---|---|
| S-01 | High transaction integrity; RESOLVED in local tests | Queue an order at price A, change the listing to price B before submission, then reconnect. The reviewed request included only listing ID and quantity; `buildOrder` used B without asking the buyer. A stale/offline screen could therefore create an order at a higher price. No real funds are involved in the sandbox. | Required expected unit price in each direct-order intent; compare under listing lock; return `409 PRICE_CHANGED` without reservation/order on mismatch. Preserve quote-acceptance's negotiated price. Implemented in contract 1.0.3; the API regression and browser offline-price scenario pass. |
| S-02 | Medium operational correctness; RESOLVED in browser regression | Browser requested Socket.IO `polling` while server allowed `websocket`; browser deduplicated `eventId` while events contain `id`. API socket tests did not exercise this browser configuration. The UI can miss immediate operational updates. | WebSocket transport and event id now match. Next slash normalization and the proxy destination were corrected to retain /socket.io/. The real-browser test observes distinct events and status refreshes; API negative socket tests and periodic refresh remain. Event bursts are grouped to reduce repeated reads. |
| S-03 | Medium shared-device privacy; RESOLVED in browser regression | Sign in, save a pending draft, disconnect, then choose Sign out. `Workspace.logout` awaits the network before clearing local session/drafts; network failure leaves the private workspace available. The user receives an explicit failure message, but cannot locally lock the workspace while disconnected. | Local signout clears memory/drafts first and persists a pending-revocation marker. Browser regression passes offline lockout, reconnect revocation, reload without automatic signin, and account switch. |

The Principal had already corrected refresh-cookie route dispatch, logistics access to commercial order/payment data and financial analytics, and the total available-plus-reserved inventory cap before this audit. Their tests are included in the independently executed suite; these are not newly discovered open findings.

## Principal remediation update

The original finding descriptions below preserve the audited behavior. Principal follow-up tests now resolve S-01, S-02, and S-03 for the local demo. Final integration status is recorded in [test report](test-report.md); this does not imply commercial approval. Latest core coverage is 99.27% lines and 87.45% branches with 30 API/database tests passing.

## Evidence actually examined or executed

- Independently ran `npm test` with host execution permission: **29 tests passed, 0 failed, 38.4 seconds**. The initial sandbox attempt stopped during `tsx` bootstrap with Windows `uv_os_get_passwd ENOMEM`; no application test executed in that attempt. Host execution resolved the runner limitation. The successful run overlapped integration and predates completion of the S-01 price amendment; it is not final verification of that amendment.
- Executed the compiled production entrypoint in a child process with `NODE_ENV=production`; asserted exit status 1 and the explicit production-disabled message. **PASS**, before database connection or HTTP listen.
- Read assertion bodies in [API integration tests](../apps/api/test/integration.test.ts) and [database tests](../db/database.test.ts). They exercise wrong-audience/tampered JWTs, invalid role assignment, refresh reuse, suspension, resource denial, idempotency conflicts, stock races/rollback, RFQ price snapshots, fulfillment, ledger balance, dispute permissions, audit immutability, and expiry. These are meaningful business assertions, not just response-success smoke checks.
- Reviewed [native PostgreSQL report](../artifacts/native-postgres-report.json): five passing checks for 12 simultaneous retries, changed payload, overselling, deferred ledger balance, and append-only audit on PostgreSQL 18.6. This is another agent's supplied artifact, not independently rerun here. It does not prove the restricted production runtime role or cloud PostGIS path.
- Reviewed the local coverage artifact: **99.12% lines, 87.21% branches** over included API modules. The configured coverage scope excludes `main.ts` and `database.ts`; those exclusions and subsequent edits prevent treating this as whole-system or final-release coverage.
- Browser offline-session race protection was source-reviewed in [api.ts](../apps/web/lib/api.ts) and [offline.ts](../apps/web/lib/offline.ts). This audit did **not** independently execute browser E2E; a later QA report must provide that evidence.

## Verified design in the reviewed implementation

| Boundary | Evidence and limit |
|---|---|
| Authentication | JWT verifies HS256, issuer, audience, expiry; every HTTP authentication re-reads session/user/organization state. Refresh values are random, only SHA-256 digests persist, rotation occurs in a transaction, replay revokes the family. Passwords use salted scrypt. Privileged MFA and recovery are absent. |
| Browser credentials / CSRF | Access JWT is module-memory only. Refresh cookie is HttpOnly, host-only, SameSite=Lax and Secure when production options are used. Login/register/refresh/logout require exact configured Origin; missing/untrusted Origin fails. Production HTTP transport is not deployed or approved. |
| Tenant/resource access | Public registration cannot request admin. Private order/payment/dispute/agreement access checks roles and organization participants. Catalog locations are coarse; precise source snapshots require order participant access per ADR-006. Assigned logistics uses shipment projections; financial order routes deny logistics and analytics totals are null. |
| Retry / inventory | Idempotency scope includes organization, user, operation and key; canonical payload fingerprint rejects changed content. The record, business mutation, audit and outbox share a transaction. Sorted listing locks and SQL constraints prevent oversell; reservation return is protected against total-capacity overflow. Records are currently retained, so no active cleanup can silently discard intent identity. Future retention must preserve deduplication. |
| Simulated finance | Sandbox-only ledger actions lock the order/payment and append balanced entries; a deferred SQL trigger rejects imbalance. Final refund/release transitions and disputes cannot be replayed into a second ledger effect. Provider signature/reconciliation controls are unimplemented because no live provider endpoint exists. |
| Provenance / validation | Lot dates, quantity precision, seafood storage metadata and state transitions are validated. SQL is parameterized; dynamic identifiers derive from server code/allowlists. Order lot/price snapshots, audit and ledger reject update/delete. Temperature input is recorded as manual, never falsely promoted to verified sensor evidence. |
| Disabled uploads | Profile changes reject non-null certificate document URLs. No upload/download capability is exposed; there is no working scanner or signed-document flow to certify. |
| Local credential generation | Setup creates random JWT and demo-password values in ignored `.env.local`; role buttons only select email. Local demo database files and shared-device storage are not claimed to be encrypted at rest. |

## Commercial blockers, limited to the delivered system

1. Keep the S-01/S-02/S-03 regressions as release gates. They now pass locally; hosted transport and shared-device field testing remain required.
2. Implement provider eligibility/configuration, signed raw-body webhooks, replay/account/amount validation, durable event deduplication, and reconciliation before handling live payments. Sandbox ledger entries are simulated and are not proof of custody or escrow.
3. Implement and test production session/recovery/privileged-auth controls, distributed throttling, bounded database pagination, and multi-instance worker delivery. The current limiter and maintenance loop are per-process; health honestly reports Redis unavailable.
4. Deploy and verify TLS, least-privilege runtime credentials, database/object/backup encryption, private logs, and restore/incident drills. Terraform validation is configuration evidence only. The runtime role SQL exists but a runtime-role negative integration run was not supplied.
5. If documents are enabled, first add private object access, format/size limits, quarantine/scanning, expiring authorized downloads, and a retention policy. Keep the absent capability disabled until then.
6. Record successful final browser tests, dependency/secret scan, container build/start and load evidence; reviewed CI YAML is not evidence of a completed CI run. The web response configuration has basic headers but no tested application CSP yet.

Principal local-demo signoff: **APPROVED for the local sandbox MVP — 2026-11-05**. Principal commercial signoff: **NOT APPROVED**. See [checklist](security-checklist.md), [threat model](security-threat-model.md), and [operations limitations](operations.md).

## 6 November 2026 — location discovery review

Location is opt-in, requested once per user action, rounded to two decimals, and retained only in authenticated workspace memory. Cancellation and teardown invalidate late callbacks; ranking changes invalidate late catalog responses. Nearest sorting uses public one-decimal supplier coordinates. API regression tests verify that discovery does not persist coordinates in profiles, audit events, or the outbox. Same-origin geolocation is explicitly allowed by Permissions-Policy; camera and microphone remain disabled. Development request logging excludes catalog URLs. Hosted proxy/APM query redaction remains a deployment gate described in [operations](operations.md).
