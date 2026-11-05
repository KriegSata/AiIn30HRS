# Independent implementation security review

Reviewer: SecurityAgent. Date: 2026-11-05 (Asia/Manila). Scope: local synthetic-data demonstration; API, SQL, browser session/offline code, and prepared deployment controls. Review occurred during integration of contract amendments 1.0.2–1.0.3. This is a targeted engineering review, not a penetration-test certification or commercial launch approval.

## Decision

Commercial deployment is **not approved**. The compiled API entrypoint deliberately refuses `NODE_ENV=production`. No live payment adapter, signed provider webhook endpoint, document upload pipeline, deployed encrypted environment, or exercised recovery procedure is available. Local demo approval remains the Principal's decision after the active findings below are resolved or explicitly scoped.

## Observed findings

| ID | Severity / status | Reproduction and impact | Required resolution |
|---|---|---|---|
| S-01 | High transaction integrity; Principal accepted fix, regression verification pending | Queue an order at price A, change the listing to price B before submission, then reconnect. The reviewed request included only listing ID and quantity; `buildOrder` used B without asking the buyer. A stale/offline screen could therefore create an order at a higher price. No real funds are involved in the sandbox. | Required expected unit price in each direct-order intent; compare under listing lock; return `409 PRICE_CHANGED` without reservation/order on mismatch. Preserve quote-acceptance's negotiated price. Principal is implementing contract 1.0.3 and a regression test. |
| S-02 | Medium operational correctness; reported to FrontendAgent via Principal | Browser requested Socket.IO `polling` while server allowed `websocket`; browser deduplicated `eventId` while events contain `id`. API socket tests did not exercise this browser configuration. The UI can miss immediate operational updates. | Align transport/proxy and event ID; browser must observe multiple authorized events, retain polling refresh fallback, and reject unauthorized event access. |
| S-03 | Medium shared-device privacy; Principal notified | Sign in, save a pending draft, disconnect, then choose Sign out. `Workspace.logout` awaits the network before clearing local session/drafts; network failure leaves the private workspace available. The user receives an explicit failure message, but cannot locally lock the workspace while disconnected. | Always clear local private state; persist a local signed-out/pending-revocation marker that prevents refresh-cookie auto-login until remote logout completes. Verify offline signout and reconnect/account switch. |

The Principal had already corrected refresh-cookie route dispatch, logistics access to commercial order/payment data and financial analytics, and the total available-plus-reserved inventory cap before this audit. Their tests are included in the independently executed suite; these are not newly discovered open findings.

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

1. Address S-01 and S-03 with automated retry/account-switch evidence; exercise the corrected browser socket path for S-02.
2. Implement provider eligibility/configuration, signed raw-body webhooks, replay/account/amount validation, durable event deduplication, and reconciliation before handling live payments. Sandbox ledger entries are simulated and are not proof of custody or escrow.
3. Implement and test production session/recovery/privileged-auth controls, distributed throttling, bounded database pagination, and multi-instance worker delivery. The current limiter and maintenance loop are per-process; health honestly reports Redis unavailable.
4. Deploy and verify TLS, least-privilege runtime credentials, database/object/backup encryption, private logs, and restore/incident drills. Terraform validation is configuration evidence only. The runtime role SQL exists but a runtime-role negative integration run was not supplied.
5. If documents are enabled, first add private object access, format/size limits, quarantine/scanning, expiring authorized downloads, and a retention policy. Keep the absent capability disabled until then.
6. Record successful final browser tests, dependency/secret scan, container build/start and load evidence; reviewed CI YAML is not evidence of a completed CI run. The web response configuration has basic headers but no tested application CSP yet.

Principal local-demo signoff: **PENDING final remediation evidence**. Principal commercial signoff: **NOT APPROVED**. See [checklist](security-checklist.md), [threat model](security-threat-model.md), and [operations limitations](operations.md).
