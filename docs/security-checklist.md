# Security release checklist

Reviewed 2026-11-05 (Asia/Manila) by SecurityAgent. See [independent report](security-report.md) for findings and exact evidence.

Statuses: **PASS** means observed source plus relevant executed assertions; **PARTIAL** means evidence covers only stated scope; **PENDING** means not verified; **DISABLED** means absent capability with an enforced boundary. No local PASS approves commercial release.

## Contract and release authority

The Principal approved contract freeze 1.0.0 and subsequent amendments in [integration log](integration-log.md). Amendment 1.0.3 addresses S-01 expected-price validation. Principal architecture signoff: **APPROVED for MVP implementation**. Principal local-demo release signoff: **APPROVED for the local sandbox MVP — 2026-11-05**. Commercial release: **NOT APPROVED**.

## Delivered controls

| ID | Requirement | Status / evidence |
|---|---|---|
| C01 | Roles plus organization/resource relationships; narrow logistics projection | **PASS (local)** — API negative tests; source review of orders, shipments, payments, agreements and analytics. Coarse public coordinates, private transaction source details per ADR-006. |
| C02 | Short access JWT, hashed rotating refresh, family reuse revocation, current suspension checks | **PASS (local)** — auth integration tests; JWT issuer/audience/algorithm and database session checks. |
| C03 | Memory access token, HttpOnly refresh cookie, exact Origin checks | **PASS (local)** — source and cookie/origin assertions. Secure-cookie/HTTPS hosted path remains unexecuted. |
| C04 | No admin self-registration or client-assigned ownership/approval | **PASS (local)** — strict DTO and registration/profile tests. |
| C05 | Idempotency organization/user/operation scope and immutable fingerprint | **PASS (local)** — duplicate/concurrent retry and payload-conflict tests; no active idempotency cleanup. |
| C06 | No negative/oversold stock; transactional rollback; total capacity leaves room for returned reservations | **PASS (local)** — SQL constraints and API/database tests; native concurrency artifact reviewed separately. |
| C07 | Offline price changes require buyer review | **PASS (local) — S-01** — contract 1.0.3 locked expected-price comparison; API and browser offline-price regressions pass. |
| C08 | Offline account isolation, no credentials/private API responses cached | **PARTIAL** — source-reviewed identity/generation checks and static-only service worker; browser E2E not independently executed in this audit. |
| C09 | Offline signout clears local private data and prevents cookie auto-login | **PASS (local) — S-03** — immediate local clear, pending revocation marker, offline/reconnect/reload/account-switch browser assertions pass. |
| C10 | Authorized real-time updates reach browser | **PASS (local) — S-02** — transport/id and slash-preserving proxy fixed; browser receives distinct authorized events and refreshes order states; API unauthorized socket checks pass. |
| C11 | Simulated financial effects atomic, balanced, irreversible when terminal | **PASS (sandbox only)** — fulfilled-order/dispute/refund tests plus deferred SQL balance and immutable ledger tests. |
| C12 | Provider webhooks, real funds and payout reconciliation | **DISABLED** — no provider endpoint; sandbox schema only. No commercial payment approval. |
| C13 | Production cannot silently start with demo infrastructure | **PASS (fail closed)** — independent compiled-entrypoint test exits 1; production startup deliberately unavailable. |
| C14 | Malicious document upload cannot reach private storage | **DISABLED** — no upload route; non-null document URL rejected. Upload scan/storage pipeline not implemented. |
| C15 | Strict values/transitions, parameterized queries, limited bodies/queries | **PARTIAL** — validation/state tests pass; 128KB HTTP body limit; pagination currently slices full query results. |
| C16 | Append-only audit/ledger/commercial source snapshots; traceability and recall holds | **PASS (local)** — API/SQL tests. Runtime-role privilege test and retention procedure remain pending. |
| C17 | Restricted production identity, encrypted data/backups, secrets, TLS | **PARTIAL** — runtime-role SQL and infrastructure configuration reviewed; no hosted execution or encryption verification. Local PGlite/demo data is not claimed encrypted. |
| C18 | Durable outbox, retry recovery, distributed limiter/worker | **PARTIAL** — local transactional outbox/expiry tests pass; multi-process worker and distributed limits absent. |
| C19 | Core line/branch coverage >=80% with meaningful business assertions | **PASS (core scope)** — Principal final API coverage 99.27% lines/87.45% branches, excluding main/database; 30 API/database tests pass after final price amendment. This is aggregate core coverage. |
| C20 | MFA/recovery, CSP, dependency/secret review, load/browser tests, restore drill | **PENDING commercial gates** — no blanket security claim from prepared CI or Terraform validation. Record final QA/DevOps evidence separately. |

## Signoff record

- Independently executed tests: npm test, 29 passed / 0 failed; compiled production entrypoint rejection passed.
- Initial restricted-runner ENOMEM was resolved by host execution; it was not an application assertion failure.
- Native PostgreSQL evidence: [five-check artifact](../artifacts/native-postgres-report.json), reviewed but not independently rerun.
- Findings and reproducible steps: [S-01, S-02, S-03](security-report.md).
- Final integration: Principal reviewed the Alibaba-style storefront, accepted the independent UI review, and observed the final build plus all 10 browser scenarios passing. See [test report](test-report.md) for scope and artifacts. No repository commit or commercial deployment is claimed.
- Accepted exception record, if any, must include environment, impact, owner, compensating control, expiry, and Principal decision.

