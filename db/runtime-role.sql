-- Run as the database administrator after migrations, never with application credentials.
-- Attach this NOLOGIN group to an externally provisioned login/IAM principal. No secrets in SQL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='harvestlink_runtime') THEN
    CREATE ROLE harvestlink_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO harvestlink_runtime', current_database());
END;
$$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO harvestlink_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, organization_certificates, users, refresh_sessions, lots, listings, rfqs, quotes, orders, order_items, shipments, temperature_readings, payments, ledger_entries, disputes, agreements, idempotency_keys, audit_events, outbox_events, notification_deliveries TO harvestlink_runtime;
REVOKE UPDATE, DELETE ON audit_events, ledger_entries, order_items FROM harvestlink_runtime;
GRANT SELECT ON schema_migrations TO harvestlink_runtime;
-- Runtime startup must call openDatabase({migrate:false}); run db/run.ts with the migration principal first.
-- The login granted harvestlink_runtime must neither own these tables nor have membership in the owner role.
