# Architecture decisions

## ADR-001 — Modular monolith with a separate worker

Accepted for MVP. NestJS modules organize identity, catalog, procurement, fulfillment, payments and operations. PostgreSQL transactions coordinate stock and payment changes; an outbox bridges to BullMQ and sockets. This avoids distributed transaction failure modes and reduces initial hosting complexity. The trade-off is shared release cadence; extraction requires measured scale or ownership need.

## ADR-002 — One TypeScript stack, PostgreSQL authoritative

Accepted. Next.js/React frontend, NestJS API, BullMQ worker, Redis, PostgreSQL/PostGIS, Docker and Terraform. Core schema remains portable to file-backed PGlite for local/test operation where Docker/psql are missing. PostGIS stays a separate mandatory production migration. PGlite tests do not prove PostGIS behavior or production concurrency characteristics; PostgreSQL integration remains a release gate.

## ADR-003 — Stock and money are transactional decimal data

Accepted. SQL quantities use `NUMERIC(12,3)`; wire quantities are decimal strings. Monetary minor units are integers, with bounds within JavaScript's exact integer range. Half-up rounding applies per line, then line totals sum. Reserved inventory is unavailable immediately; cancellation and pickup update it exactly once. Price and complete source-lot facts are immutable order snapshots.

## ADR-004 — Providers handle regulated custody and messaging

Accepted. Build domain order, invoice, ledger and dispute rules. Buy payment processing, authorized fund-holding/release, messaging transport and managed infrastructure. The MVP sandbox records simulated balance effects only. No real payment provider is selected until launch-country support, marketplace payout eligibility, reconciliation and cost are reviewed. The system must never label a sandbox or unsupported payout delay as real regulated escrow.

## ADR-005 — Explicit offline intent and server authority

Accepted. IndexedDB stores drafts and pending submissions; idempotency provides safe retry after uncertain network outcomes. Pending does not equal confirmed. Seven-day server key retention exceeds the 24-hour offline submission window. Browser cache is isolated by actor/organization and purged on logout. Stock, prices, verification and freshness are rechecked server-side at acceptance.

## ADR-006 — Participant authorization and private location data

Accepted. Role gates plus organization/participant conditions are required on every entity lookup and transition. Public supplier/partner cards exclude license documents and contact email. Public listing/lot coordinates are coarse; detailed source and shipment coordinates require transaction access. Broad object serialization is prohibited. An administrator's exceptional mutation requires reason and audit.

## ADR-007 — Repository deployment stays on a Node-compatible host

Accepted. The approved NestJS/worker architecture is packaged as Docker services and targeted at AWS. A site-hosting Worker runtime cannot run the approved Node backend unchanged. Any hosted frontend preview must use the actual supported API deployment or be labeled a preview; it does not replace the integration artifact.

## ADR-008 — Demo boundaries and evidence

Accepted. PHP and Philippine example locations are demo assumptions, not a compliance conclusion. Demo seeds are opt-in and unavailable in production. Third-party credentials are environment/secret-manager values, never source defaults. Every completion statement links to runnable code, a test result or documentation; an unexecuted deploy template is described as a template. Existing user files and deletions are preserved.

## Change control

Version 1.0.0 contracts were approved by the Principal before implementation began. A proposed change identifies affected DTO/OpenAPI/event/database/UI/tests, explains the reason and preserves backward compatibility where feasible. The Principal decides conflicts and records the outcome here before dependent work changes. V1/V2 feature labels are not implementation promises for MVP.
