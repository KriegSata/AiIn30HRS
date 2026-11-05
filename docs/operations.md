# Operations and release runbook

## Delivery status

This repository provides a local demonstration and prepared deployment configuration. No AWS resources have been provisioned, no CI workflow has run remotely, and no public commercial service is available. The API rejects `NODE_ENV=production` because live payment/messaging integrations, distributed controls and the commercial security review remain incomplete. Terraform creates an ECS service with **zero running tasks**; the release workflow deliberately fails until those requirements are implemented and reviewed. Changing `NODE_ENV` to development on a public server is not a deployment workaround.

The local Compose topology contains PostGIS, Redis, a compiled API and a production-built Next.js UI. API mode remains development with sandbox payments and generated demo credentials. The API currently runs its maintenance/outbox loop in-process. Redis is a prepared dependency; provisioning it does not mean BullMQ jobs or distributed throttling are implemented. Do not scale API replicas until those controls are implemented and tested. Private object storage infrastructure is prepared; the application upload/scan integration is a V1 gate.

Executed configuration checks on 5 November 2026: all three YAML files parsed successfully; Terraform 1.13.5 with signed AWS provider 6.72.0 passed provider-backed validation with zero errors/warnings. See [validation output](../infra/terraform-validation.json) and the checked-in provider lockfile. Terraform's official archive SHA256 was verified. Docker is unavailable on this workstation, so container builds/startup and the CI workflow are supplied but not claimed as executed. Validation required no AWS credentials and created no cloud resources.

## Local containers

Install Docker Engine/Desktop with Compose v2 and Node 22.12 or newer. From the repository root in PowerShell:

```powershell
npm run setup
if (-not (Select-String -LiteralPath .env.local -Pattern '^COMPOSE_DB_PASSWORD=' -Quiet)) {
  $demoDatabasePassword = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
  Add-Content -LiteralPath .env.local -Value ("COMPOSE_DB_PASSWORD=" + $demoDatabasePassword)
}
docker compose --env-file .env.local config --quiet
docker compose --env-file .env.local up --build -d --wait
npm run demo:credentials
```

Open <http://127.0.0.1:3100>. Only the web/API ports bind to loopback; PostgreSQL and Redis have no host ports. `.env.local` is ignored by Git and excluded from Docker builds. Never use plain `docker compose config` in shared logs because it renders environment values. `--env-file` supplies Compose interpolation; `env_file` separately passes the application environment to the API. See [Docker interpolation documentation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation).

```powershell
docker compose --env-file .env.local ps
docker compose --env-file .env.local logs --tail 100 api web
Invoke-RestMethod http://localhost:4000/api/v1/health
docker compose --env-file .env.local stop
```

Named volumes preserve database and Redis data across container replacement. `docker compose down` preserves them; adding `--volumes` deletes them and is appropriate only for disposable CI data or an explicitly authorized reset. The Compose database account owns schema objects for local demonstration only. Never reuse that privilege model in a hosted environment.

Both application images run as the Node unprivileged user. Build API and web separately if required:

```powershell
docker build --target api -t harvestlink-api:local .
docker build --target web --build-arg API_INTERNAL_URL=http://api:4000 -t harvestlink-web:local .
docker build --target migration -t harvestlink-migration:local .
```

Next.js rewrites are fixed at build time. For the prepared ECS topology, API and web share a task network: build the web image with `API_INTERNAL_URL=http://127.0.0.1:4000`. Compose uses `http://api:4000`. The ALB routes `/api/*` and `/socket.io/*` directly to the API. Image tags are convenient locally; hosted task definitions require immutable image digests. Base-image digests and GitHub Action commit pins must be selected and verified during the release supply-chain review.

## CI and release controls

[CI](../.github/workflows/ci.yml) defines contract validation, TypeScript checks, unit/database tests, coverage output, a dedicated native PostgreSQL race test, a PostGIS migration check, production builds, dependency audit, browser E2E, Docker build/start probes, and Terraform validation. The test database/password are disposable CI-only fixtures. Application tests do not receive a shared `DATABASE_URL`; native tests use their own empty `TEST_DATABASE_URL` to prevent cross-suite contamination. Evidence is uploaded for 14 days.

The [release review workflow](../.github/workflows/release-review.yml) has no cloud credentials and fails with the actual production blocker. Configure GitHub `staging` and `production` environments, protected branches, required CI checks and reviewer rules in the hosting repository; YAML cannot prove those settings exist. After the V1 gates below are satisfied, add OIDC deployment roles restricted to repository/environment claims, an image registry push, a saved Terraform plan review, a separate migration job, ECS rollout, smoke tests and rollback. Never place static AWS keys in workflows. The present workflow is a release barrier, not a completed cloud deployment pipeline.

## AWS infrastructure preparation

[Terraform JSON](../infra/terraform/main.tf.json) describes a two-zone VPC, public HTTPS load balancer, two NAT gateways, private tasks/database, encrypted PostgreSQL 17, 35-day backups, production Multi-AZ, private versioned KMS-encrypted object storage, log retention, and database/HTTP alarms. NAT gateways, RDS, ALB, storage and logs incur charges even with zero ECS tasks. A budget and account selection must precede provisioning.

Prerequisites are an AWS account/region, DNS domain and validated ACM certificate, an encrypted/versioned S3 state bucket, a monitored SNS topic, an image registry containing reviewed digests, and two Secrets Manager secret containers for the least-privilege runtime database URL and JWT signing secret. Create the secret metadata/ARNs first; populate their values through a protected administrator session after the database endpoint and runtime login exist, before any task is enabled. Examples intentionally contain nonfunctional identifiers. No secret values appear in Terraform inputs or outputs. RDS generates its administrator password directly in Secrets Manager. Runtime database and JWT secrets should use the default Secrets Manager AWS KMS key; if a customer key is selected, add a narrowly scoped `kms:Decrypt` execution-role grant with the Secrets Manager service condition before deployment.

```powershell
Copy-Item infra/terraform/staging.tfvars.example infra/terraform/staging.tfvars
Copy-Item infra/terraform/backend.hcl.example infra/terraform/backend.hcl
# Fill actual non-secret IDs and the encrypted state bucket. Use separate state keys for each environment.
terraform -chdir=infra/terraform init -backend-config=backend.hcl
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform plan -var-file=staging.tfvars -out=staging.tfplan
```

The above prepares a reviewable plan; it does not authorize or perform `apply`. Keep plans and state private because they contain infrastructure metadata. Use short-lived identity credentials; never pass credentials on command lines. Task execution can read only the supplied runtime secret ARNs. The runtime IAM role has no AWS service grants until a reviewed integration needs them. The database accepts only task-security-group traffic and requires TLS. RDS and the document bucket have Terraform destruction protection, and RDS/ALB have service-level deletion protection. See [RDS encryption/password controls](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_instance) and [RDS PostgreSQL TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html).

The infrastructure assumes PostgreSQL 17 and PostGIS are supported in the chosen region. Validate exact engine/extension availability before applying; the provider configuration alone does not establish regional availability. Terraform JSON is the native machine-readable Terraform format; provider validation is required in addition to JSON syntax validation.

## Migrations and credentials

Migrations in `db/migrations` run under a separate migration principal. Install/check the PostGIS extension, apply checksum-verified migrations, then execute [runtime-role.sql](../db/runtime-role.sql) as the schema owner. Provision a separate login, grant only membership in `harvestlink_runtime`, and store that login's TLS database URL in the runtime secret. The runtime login must not own tables, inherit the migration role, or be a superuser. Never grant runtime read access to the RDS administrator secret.

The `migration` image invokes `db/run.ts`; pass `DATABASE_URL` from a dedicated migration secret using a one-off private job. Its `NODE_ENV=production` requires native PostgreSQL and PostGIS, and demo seeding is forbidden. Runtime must use `RUN_MIGRATIONS=false`; the migration job runs before rolling out a reviewed API revision. Mount the region-appropriate RDS CA bundle and configure certificate verification in the database URL/client—do not use `rejectUnauthorized=false`. This hosted TLS connection path is a release test, not something the local loopback demo proves.

Use additive/backward-compatible migrations so the prior application revision remains usable during rollout. Do not edit an already-applied migration. Any destructive data migration needs an explicit restoration/recovery plan. The runtime role's audit/ledger/immutable snapshot restrictions must be covered by native PostgreSQL negative tests before release. Administrator grants are deliberate database/identity operations with an audit record, never public registration or runtime schema ownership.

## Backup and recovery

RDS retains automated backups for 35 days, encrypts storage and snapshots, and creates a final snapshot on approved deletion. Proposed recovery targets are at most 15 minutes of data loss and four hours to restore service; these are **unverified targets**, not achieved guarantees. Document requirements may require longer/cross-region retention or AWS Backup policies after jurisdiction review. Versioned S3 prevents ordinary overwrites from immediately destroying earlier objects; it is not a substitute for independent recovery testing or legal retention rules.

For a local backup, avoid binary redirection through older PowerShell versions:

```powershell
New-Item -ItemType Directory -Force .data/backups | Out-Null
docker compose --env-file .env.local exec -T postgres pg_dump -U harvestlink_demo -d harvestlink -Fc -f /tmp/harvestlink.dump
docker compose --env-file .env.local cp postgres:/tmp/harvestlink.dump .data/backups/harvestlink.dump
```

For a non-destructive restore drill, create a new database and restore the copied archive. Do not overwrite an existing database:

```powershell
docker compose --env-file .env.local exec -T postgres createdb -U harvestlink_demo harvestlink_restorecheck
docker compose --env-file .env.local cp .data/backups/harvestlink.dump postgres:/tmp/harvestlink-restore.dump
docker compose --env-file .env.local exec -T postgres pg_restore -U harvestlink_demo -d harvestlink_restorecheck --exit-on-error /tmp/harvestlink-restore.dump
docker compose --env-file .env.local exec -T postgres psql -U harvestlink_demo -d harvestlink_restorecheck -c "SELECT count(*) FROM orders; SELECT PostGIS_Version();"
```

For managed recovery, restore RDS to a **new** instance at the selected point in time, retain private networking and TLS, verify migrations/lot lineage/ledger consistency, run synthetic participant checks, and then update the runtime secret to the recovered endpoint during a controlled deployment. Revoke active refresh families if compromise triggered recovery. Record backup timestamp, recovered transaction timestamp, restoration duration, lost transaction count, reviewer and evidence. A successful restore drill remains a V1 requirement.

## Observability and incidents

The API emits structured startup, internal-error and maintenance-error logs; request IDs support investigation. ECS log shipping and Container Insights are configured, with alarms for sustained DB CPU, low DB disk, and target 5xx responses. Do not log passwords, refresh tokens, complete request bodies, precise farm coordinates or payment/document contents. The SNS topic must have an actual staffed response route before launch. Request tracing, percentile latency metrics, queue depth, outbox age, payment reconciliation alarms and sensor ingestion alerts remain V1 work; an OpenTelemetry dependency/plan is not an installed tracing system.

On failure: inspect health and request ID; preserve logs; check database connectivity and recent migrations; stop the affected deployment; restore the last reviewed image digest if schema-compatible; verify stock/ledger invariants before restoring writes. For a cold-chain incident, pause affected lots/orders, preserve temperature and custody evidence, and let an authorized administrator review the case. Do not rewrite history to remove an excursion. Payment disputes must remain frozen until the authorized resolution path succeeds.

## Commercial deployment gates

- Select launch jurisdiction/currency and obtain payment-provider eligibility; implement signed webhooks, settlement reconciliation, real fund flow and messaging adapters.
- Implement distributed throttling, maintenance/outbox ownership and real queue workers; prove safe restart and multi-replica behavior before enabling scale-out.
- Complete private document validation/scanning, data retention decisions and sensor provenance; review data export/deletion and recall procedures.
- Validate managed PostgreSQL/PostGIS, TLS CA verification, least-privilege role grants and migration/runtime separation against actual infrastructure.
- Complete coverage thresholds, all-role browser/accessibility UAT, real load targets and restore evidence; resolve high/critical security findings.
- Configure verified domain/TLS, short-lived cloud roles, protected environment gates, registry/scanner and digest/action pins, monitored alerts and budget limits.
- Review a concrete deployment plan, implement automated rollout/rollback, then replace the deliberate release blocker and zero-task setting together with the production startup guard.

Prepared configuration must never be reported as deployed, and a passing local test must never be reported as hosted operational evidence.
