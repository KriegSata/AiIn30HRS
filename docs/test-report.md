# Verification report

Recorded 5 November 2026, Asia/Manila. The final combined browser run **passed all 10 scenarios**, with zero failures, skips, or flaky results, in 5.5 minutes. The latest TypeScript/Next.js build and all seven accessibility scans passed. The Principal approved the local MVP demo, including the Alibaba-style sourcing storefront, after reviewing these results. Commercial release remains unapproved.

## Executed checks

| Check | Recorded result | Command and evidence |
| --- | --- | --- |
| API and database integration | **30 passed, 0 failed**: 19 API tests and 11 database tests, after the expected-price amendment | `npm run test:compiled`; [API tests](../apps/api/test/integration.test.ts), [database tests](../db). Principal-observed command result; isolated PGlite SQL databases |
| Core API coverage | **99.27% lines/statements, 87.45% branches, 97.81% functions** | `npm run test:coverage:compiled`; [coverage summary](../artifacts/api-coverage-summary.json) |
| OpenAPI | **Passed**: contract v1.0.3, 38 operations, 40 schemas | `npm run check:contracts`; [specification](../contracts/openapi.yaml), [validator](../scripts/check-contracts.mjs) |
| TypeScript and builds | **Passed**; final Next.js build exited 0 after label corrections and includes the sourcing storefront, photos, filters, and pagination | `npm run typecheck`, `npm run build:api`, `npm run build:web`; Principal-observed command results |
| Browser acceptance | **10 passed, 0 failed, 0 skipped, 0 flaky**; exit 0, 329.96 seconds | `npm run test:e2e -- --max-failures=1`; [final Playwright JSON](../artifacts/qa-e2e-report.json), [scenarios](../tests/e2e/marketplace.spec.ts) |
| Automated accessibility | **Seven scans, zero violations**: login, five demo role landing pages, and product dialog | axe WCAG A/AA checks within browser tests; [login result](../artifacts/qa-axe-login.json), [buyer result](../artifacts/qa-axe-buyer.json), [dialog result](../artifacts/qa-axe-product-dialog.json), remaining `artifacts/qa-axe-*.json` |
| Native PostgreSQL | **5 passed** on the final API revision, PostgreSQL 18.6 | `npm run test:native`; [current native report](../artifacts/native-postgres-report.json), generated 11:48 Asia/Manila |
| Spatial migrations | **5 passed** using the experimental PGlite PostGIS extension | `npm run test:spatial`; [spatial report](../artifacts/spatial-report.json) |
| Terraform configuration | **Valid**, zero errors or warnings; no resources provisioned | `terraform -chdir=infra/terraform validate`; [validation result](../infra/terraform-validation.json), [operations record](operations.md) |
| Generated local credential scan | **No exact generated credential values found** in 104 tracked/unignored non-binary files | [scan result](../artifacts/secret-check.json). This checks current generated `JWT_SECRET` and `DEMO_PASSWORD` values, not arbitrary credentials |
| Dependency audit | **Passed: zero reported vulnerabilities** at all severities in the successful current registry check | `npm audit --json`; [audit result](../artifacts/dependency-audit.json), generated 11:48 Asia/Manila |
| Bounded local load | **Passed: 70 measured requests, concurrency 4, zero errors**; all ten idempotent replays returned their original order and all reservations were returned | `node tests/load/local-load.mjs`; [load result](../artifacts/qa-load-report.json), [harness](../tests/load/local-load.mjs) |
| Product photos | **6 local WebP assets verified**, each served as HTTP 200 `image/webp`; manifest hashes and sizes match | [credits](image-credits.md), [source/size/checksum manifest](image-credits-sources.json), [public attribution](../apps/web/public/products/credits.html) |

Coverage is aggregate coverage of `auth`, `core`, `mappers`, `marketplace`, and `server`; it excludes the startup entrypoint and database adapter. The aggregate exceeds the required 80% core line/branch target. It does not establish complete branch coverage of every module. Database migrations and persistence have separate integration tests. The compiled commands execute the same test sources and avoid the Windows sandbox TypeScript-loader error encountered in this environment.

The current native PostgreSQL checks cover concurrent retry deduplication, changed-payload rejection, oversell prevention, balanced ledger constraints, and append-only audit protection. The successful approved rerun supersedes the earlier Windows restricted-token startup failure; the [attempt summary](../artifacts/native-postgres-latest-attempt.json) records both the successful outcome and earlier restriction. Native PostgreSQL assertions do not cover PostGIS. The separate spatial run checks migration execution, coordinate ordering, radius filtering, three GiST indexes, and generated geography updates; it does not verify managed/native PostGIS deployment.

The bounded local load measured p95 latency of **89.84 ms for search**, **271.63 ms for order creation**, and **53.23 ms for idempotent replay**. This was a local development API with embedded PostgreSQL, not k6 or a production capacity test. Authentication and cleanup were outside the latency measurements. The current successful dependency audit supersedes the earlier network-blocked attempt; it reports known registry findings at execution time and is not a guarantee against unknown vulnerabilities.

## Browser findings

The current storefront uses prominent product search, category shortcuts, sourcing filters, product photos, unit prices, minimum quantities, and supplier details. It retains grid/list views, pagination, product traceability dialogs, and the role workspaces. The six representative photos total 270,520 bytes, load locally, and have visible representative-image labels and accessible alt text. Attribution is linked from the application footer; unknown/new titles retain the illustration fallback.

The final combined browser run passed these ten scenarios:

- Authentication and all five demo-account landing pages, including both supplier identities.
- Buyer search, cold-chain filters, source details, keyboard dialog behavior, and a 390 × 844 mobile layout.
- A full supplier listing → buyer order → sandbox payment → carrier delivery → buyer settlement journey.
- Offline order queuing, exactly-once reconnect submission, and clearing pending private data at signout.
- Changed-price conflict after offline submission without a new order or stock reservation.
- Administrator verification and dispute refund with recorded audit evidence.
- Offline signout, shared-device lockout, and server-session revocation after reconnect.
- Distinct authorized live events reaching the browser and refreshing order status.
- Combined category and supplier-location filters, explicit units for optional price/minimum filters, and reset behavior.
- Loading a second catalog page and filtering a supplier location from that page, using a mocked 101-listing response fixture.

The pagination scenario intercepts listing responses to exercise UI behavior across 101 records; it is not a native database pagination or 101-record load test. The transaction and offline scenarios use the real local API.

The earlier live-update proxy issue is corrected and the final browser event scenario passes. A diagnostic run captured six HTTP 429 responses, including the payment submission, when rapid synthetic account switching exceeded the real **300 API requests per minute** limit on one loopback address. The [rate-limit diagnosis](../artifacts/qa-rate-limit-diagnosis.json) records the request paths and counts. The acceptance harness spaces identity switches by **12 seconds**, retaining the real limiter and business assertions. The final combined suite passed with that pacing. This addresses a shared-IP synthetic burst; it does not establish hosted capacity or remove the need for distributed throttling.

Automated accessibility checks and keyboard assertions are useful evidence, but they do not establish full WCAG 2.1 AA conformance. Manual screen-reader trials, zoom, real-device checks, and farmer/fisher field acceptance remain unexecuted. [UAT journeys](uat.md) describe those checks; they are test plans, not completed user research.

## Unexecuted checks

| Check | Present state |
| --- | --- |
| k6 load | [k6 scenario](../tests/load/marketplace.k6.js) supplied; **not executed**. No production throughput or latency claim |
| Docker and remote CI | Configuration supplied; Docker is unavailable on this workstation and remote CI has not run |
| Hosted security, encryption, TLS, least-privilege runtime, and recovery | Prepared configuration/review only; no deployed environment or restoration drill |
| Payments, messaging, document uploads, and sensor providers | Live integrations are absent; sandbox/manual behavior cannot validate external providers |

## Reproduce and approve

Follow [the setup guide](../START_HERE.md), use generated demo credentials, and run the commands in [the developer guide](developer-guide.md). Browser and load scenarios create synthetic records and belong in a disposable demo environment. Reports must never contain passwords or tokens.

The Principal approved the **local MVP demo, including the sourcing redesign**, after the ten-scenario browser pass, final build, and acceptance review on 5 November 2026. **Commercial release is not approved**, and production startup is explicitly disabled. See [security findings](security-report.md), [security checklist](security-checklist.md), and [delivery status](delivery-status.md) for the remaining gates.
