# HarvestLink

A working local B2B marketplace for farmers, fishers, buyers, logistics partners, and administrators. It uses Next.js, NestJS, and durable SQL storage. Payments in this release are simulations; no money moves.

## Run it

Use Node.js 22.12 or newer (verified here with Node 24). From this directory:

```sh
npm ci
npm run setup
npm run dev
```

Open **http://127.0.0.1:3100**. Use this exact address: another application already uses localhost:3000 on the development machine. The API listens at 127.0.0.1:4000.

Run `npm run demo:credentials` in your terminal to see the generated local password. Accounts are `buyer@harvestlink.demo`, `supplier@harvestlink.demo`, `fisher@harvestlink.demo`, `logistics@harvestlink.demo`, and `admin@harvestlink.demo`. The ignored `.env.local` holds local secrets. Setup preserves existing secrets and records. Demo data persists in `.data/harvestlink`.

If the Windows sandbox reports `uv_os_get_passwd` from the TypeScript loader, use `npm run dev:compiled`. It runs the same application from compiled JavaScript. Stop the development process with Ctrl+C. Do not run two APIs against the same local PGlite directory.

## Explore

- [Demo walkthrough](docs/demo-walkthrough.md): follow a real transaction through all roles.
- [User guide](docs/user-guide.md): listings, bulk orders, offline submissions, and delivery.
- [Developer guide](docs/developer-guide.md): commands, source layout, contracts, and tests.
- [Architecture](docs/architecture.md), [API reference](docs/api-reference.md), [API specification](contracts/openapi.yaml), [database](docs/database.md).
- [Admin runbook](docs/admin-runbook.md), [operations](docs/operations.md), [security review](docs/security-report.md).
- [Delivery status](docs/delivery-status.md), [test report](docs/test-report.md), [integration decisions](docs/integration-log.md).

## Release scope

Implemented: verified supplier workflows, traceable lots, RFQs/quotes, transactional bulk orders, delivery coordination, manual temperature readings, sandbox invoices/payments/refunds/disputes, draft supply agreements, role-scoped analytics, audit history, and an offline order queue.

Commercial deployment is blocked in code. Live payment/escrow providers, messaging, private document uploads, automated recurring fulfillment, partial deliveries, and production operations require further implementation and verification. Docker and AWS infrastructure are provided but have not been deployed. The release reports distinguish tested behavior from planned work.
