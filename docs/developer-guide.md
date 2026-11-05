# Developer guide

Start with [START_HERE](../START_HERE.md). The root lockfile pins dependencies. No credentials belong in tracked files.

## Source map

| Location | Responsibility |
| --- | --- |
| `apps/web/app` | Responsive Next.js workspace and role screens |
| `apps/web/lib/api.ts` | Memory access token, serialized refresh, session isolation, deferred logout |
| `apps/web/lib/offline.ts` | IndexedDB drafts and durable, owner-scoped submission queue |
| `apps/api/src/server.ts` | Nest bootstrap, contract-bound HTTP routes, headers, throttling, Socket.IO |
| `apps/api/src/auth.ts` | Password hashing, JWT validation, hashed refresh rotation and revocation |
| `apps/api/src/marketplace.ts` | Transactional business operations and maintenance |
| `apps/api/src/database.ts` | PostgreSQL/PGlite connection and migration adapters |
| `db` | Versioned SQL, explicit demo seed, restricted-role template |
| `contracts` | OpenAPI source/generator, DTOs, events |
| `tests` | Real-browser acceptance tests and local/k6 load scenarios |
| `infra`, `.github` | Terraform and CI/release configuration |

## Verification commands

```sh
npm run check:contracts
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run test:e2e
npm run test:native
npm run test:spatial
```

On Windows where the sandboxed TypeScript loader cannot query host user information, `npm run test:compiled` and `npm run test:coverage:compiled` compile first and execute the same tests. Coverage excludes the startup entrypoint and database adapter; database behavior has its own integration tests. CI enforces 80% core line and branch coverage.

Browser tests use installed Edge on this machine and Chromium in CI. They create synthetic fixtures and must run against a demo environment. The bounded Node load harness is `node tests/load/local-load.mjs`; run it separately from browser tests to avoid sharing the local IP rate limit. The k6 script is a separate artifact and is not evidence of an executed k6 test.

Native transaction tests create an isolated hidden PostgreSQL process on Windows. Elsewhere, set `TEST_DATABASE_URL` to an empty disposable database. The script refuses a database containing application tables. Native tests intentionally exclude PostGIS; the spatial test executes the spatial migration using the experimental PGlite PostGIS extension. CI additionally defines native PostGIS verification.

## Contract changes

Edit `contracts/generate_openapi.py` and corresponding `contracts/domain.ts`, regenerate using `python contracts/generate_openapi.py`, and validate. Update callers, tests, and the Principal decision log together. The OpenAPI document uses JSON syntax, which is valid YAML.

Every direct order supplies a stable Idempotency-Key and expectedUnitPriceMinor per item. The server computes totals from locked records; changed prices produce a conflict. Quantities use decimal strings, money uses integer PHP minor units in the demo. Do not use floating-point arithmetic for settlement.

## Storage and execution

With no DATABASE_URL, local mode uses file-backed PGlite. Native PostgreSQL/PostGIS is the deployed target. Use the separate migration credentials before starting a restricted runtime with RUN_MIGRATIONS=false. See [database.md](database.md) for privileges and retention.

The current API executes database-backed maintenance periodically in its own process. Redis/BullMQ are prepared dependencies, not an active distributed worker. Health correctly reports Redis false. Production startup refuses operation until the release blockers are resolved; removing that gate is not a substitute for implementing those controls.
