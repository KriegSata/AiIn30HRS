# Verification report

Recorded 5 November 2026, Asia/Manila. This report distinguishes executed checks from supplied test plans. The final combined **10-scenario browser run is pending** after the simplified menu, filtering/pagination, and live-update proxy revisions. Targeted browser checks and the revised Next.js build have passed; Principal local-demo signoff awaits the combined result.

## Executed checks

| Check | Recorded result | Command and evidence |
| --- | --- | --- |
| API and database integration | **30 passed, 0 failed**: 19 API tests and 11 database tests, after the expected-price amendment | `npm run test:compiled`; [API tests](../apps/api/test/integration.test.ts), [database tests](../db). Principal-observed command result; isolated PGlite SQL databases |
| Core API coverage | **99.27% lines/statements, 87.45% branches, 97.81% functions** | `npm run test:coverage:compiled`; [coverage summary](../artifacts/api-coverage-summary.json) |
| OpenAPI | **Passed**: contract v1.0.3, 38 operations, 40 schemas | `npm run check:contracts`; [specification](../contracts/openapi.yaml), [validator](../scripts/check-contracts.mjs) |
| TypeScript and builds | **Passed**; the final Next.js build includes revised menus, pagination, and the live-update proxy | `npm run typecheck`, `npm run build:api`, `npm run build:web`; Principal-observed command results |
| Browser acceptance | **Final combined 10-scenario run pending**. Targeted revised-menu, search/filter, pagination, and transaction checks passed | `npm run test:e2e -- --workers=1`; [Playwright JSON](../artifacts/qa-e2e-report.json), [scenarios](../tests/e2e/marketplace.spec.ts). The JSON is replaced by each run; a targeted result is not a full-suite result |
| Automated accessibility | **No violations reported** in the scanned login, five demo role landing pages, and product dialog | axe WCAG A/AA checks within browser tests; [login result](../artifacts/qa-axe-login.json), [buyer result](../artifacts/qa-axe-buyer.json), [dialog result](../artifacts/qa-axe-product-dialog.json), remaining `artifacts/qa-axe-*.json` |
| Native PostgreSQL | **5 passed** on the final API revision, PostgreSQL 18.6 | `npm run test:native`; [current native report](../artifacts/native-postgres-report.json), generated 11:48 Asia/Manila |
| Spatial migrations | **5 passed** using the experimental PGlite PostGIS extension | `npm run test:spatial`; [spatial report](../artifacts/spatial-report.json) |
| Terraform configuration | **Valid**, zero errors or warnings; no resources provisioned | `terraform -chdir=infra/terraform validate`; [validation result](../infra/terraform-validation.json), [operations record](operations.md) |
| Generated local credential scan | **No exact generated credential values found** in 98 tracked/unignored files | [scan result](../artifacts/secret-check.json). This is a scoped exact-value check, not a general secret scanner |
| Dependency audit | **Passed: zero reported vulnerabilities** at all severities in the successful current registry check | `npm audit --json`; [audit result](../artifacts/dependency-audit.json), generated 11:48 Asia/Manila |
| Bounded local load | **Passed: 70 measured requests, concurrency 4, zero errors**; all ten idempotent replays returned their original order and all reservations were returned | `node tests/load/local-load.mjs`; [load result](../artifacts/qa-load-report.json), [harness](../tests/load/local-load.mjs) |

Coverage is aggregate coverage of `auth`, `core`, `mappers`, `marketplace`, and `server`; it excludes the startup entrypoint and database adapter. The aggregate exceeds the required 80% core line/branch target. It does not establish complete branch coverage of every module. Database migrations and persistence have separate integration tests. The compiled commands execute the same test sources and avoid the Windows sandbox TypeScript-loader error encountered in this environment.

The current native PostgreSQL checks cover concurrent retry deduplication, changed-payload rejection, oversell prevention, balanced ledger constraints, and append-only audit protection. The successful approved rerun supersedes the earlier Windows restricted-token startup failure; [that earlier attempt](../artifacts/native-postgres-latest-attempt.json) is historical, despite its filename. Native PostgreSQL assertions do not cover PostGIS. The separate spatial run checks migration execution, coordinate ordering, radius filtering, three GiST indexes, and generated geography updates; it does not verify managed/native PostGIS deployment.

The bounded local load measured p95 latency of **89.84 ms for search**, **271.63 ms for order creation**, and **53.23 ms for idempotent replay**. This was a local development API with embedded PostgreSQL, not k6 or a production capacity test. Authentication and cleanup were outside the latency measurements. The current successful dependency audit supersedes the earlier network-blocked attempt; it reports known registry findings at execution time and is not a guarantee against unknown vulnerabilities.

## Browser findings

The recorded passing scenarios cover:

- Authentication and all five demo-account landing pages, including both supplier identities.
- Buyer search, cold-chain filters, source details, keyboard dialog behavior, and a 390 × 844 mobile layout.
- A full supplier listing → buyer order → sandbox payment → carrier delivery → buyer settlement journey.
- Offline order queuing, exactly-once reconnect submission, and clearing pending private data at signout.
- Changed-price conflict after offline submission without a new order or stock reservation.
- Administrator verification and dispute refund with recorded audit evidence.
- Offline signout, shared-device lockout, and server-session revocation after reconnect.

An earlier combined run passed seven scenarios and failed **“browser receives distinct authorized live events and refreshes order status”** while waiting for the WebSocket-ready signal through the web proxy. The Principal revised the proxy and simplified navigation. Subsequent targeted menu/transaction and filter/pagination checks passed; the combined ten-scenario run must confirm the live-update correction and regressions before local-demo approval. API-level socket authentication alone cannot clear a browser failure.

Automated accessibility checks and keyboard assertions are useful evidence, but they do not establish full WCAG 2.1 AA conformance. Manual screen-reader trials, zoom, real-device checks, and farmer/fisher field acceptance remain unexecuted. [UAT journeys](uat.md) describe those checks; they are test plans, not completed user research.

## Pending and unexecuted checks

| Check | Present state |
| --- | --- |
| Final browser/navigation regression | Combined ten-scenario run pending after reviewed corrections; update the linked browser artifact and this report together |
| k6 load | [k6 scenario](../tests/load/marketplace.k6.js) supplied; **not executed**. No production throughput or latency claim |
| Docker and remote CI | Configuration supplied; Docker is unavailable on this workstation and remote CI has not run |
| Hosted security, encryption, TLS, least-privilege runtime, and recovery | Prepared configuration/review only; no deployed environment or restoration drill |
| Payments, messaging, document uploads, and sensor providers | Live integrations are absent; sandbox/manual behavior cannot validate external providers |

## Reproduce and approve

Follow [the setup guide](../START_HERE.md), use generated demo credentials, and run the commands in [the developer guide](developer-guide.md). Browser and load scenarios create synthetic records and belong in a disposable demo environment. Reports must never contain passwords or tokens.

The Principal owns integration signoff. **Local-demo signoff is pending the final combined browser result and review. Commercial release is not approved**, and production startup is explicitly disabled. See [security findings](security-report.md), [security checklist](security-checklist.md), and [delivery status](delivery-status.md) for the remaining gates.
