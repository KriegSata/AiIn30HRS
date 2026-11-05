-- PostgreSQL core schema. PostGIS is a separate required native PostgreSQL migration.
CREATE TABLE organizations (
  id UUID PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('supplier','buyer','logistics','admin')),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected','suspended')),
  contact_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
  location_label TEXT NOT NULL, latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90), longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  license_number TEXT, description TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE INDEX organizations_verification_idx ON organizations(verification_status,created_at);
CREATE TABLE organization_certificates (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id), name TEXT NOT NULL, reference TEXT NOT NULL,
  expires_at TIMESTAMPTZ, document_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX organization_certificates_org_idx ON organization_certificates(organization_id);
CREATE TABLE users (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id), email TEXT NOT NULL,
  name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('supplier','buyer','logistics','admin')),
  password_hash TEXT NOT NULL, disabled BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users(lower(email));
CREATE INDEX users_organization_idx ON users(organization_id);
CREATE TABLE refresh_sessions (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), family_id UUID NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
  replaced_by UUID REFERENCES refresh_sessions(id) DEFERRABLE INITIALLY DEFERRED, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_sessions_family_idx ON refresh_sessions(family_id);
CREATE INDEX refresh_sessions_expiry_idx ON refresh_sessions(expires_at);
CREATE TABLE lots (
  id UUID PRIMARY KEY, supplier_org_id UUID NOT NULL REFERENCES organizations(id), code TEXT NOT NULL,
  harvested_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  origin_label TEXT NOT NULL, origin_latitude DOUBLE PRECISION NOT NULL CHECK (origin_latitude BETWEEN -90 AND 90), origin_longitude DOUBLE PRECISION NOT NULL CHECK (origin_longitude BETWEEN -180 AND 180),
  catch_method TEXT NOT NULL, cold_chain_status TEXT NOT NULL CHECK(cold_chain_status IN ('ambient','chilled','frozen','excursion','unknown')),
  storage_min_c NUMERIC(5,2), storage_max_c NUMERIC(5,2), source_type TEXT NOT NULL CHECK(source_type IN ('farm','vessel')), source_name TEXT NOT NULL,
  evidence_type TEXT NOT NULL DEFAULT 'supplier_declared' CHECK(evidence_type IN ('supplier_declared','sensor_verified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(supplier_org_id,code), CHECK(expires_at>harvested_at),
  CHECK(storage_min_c IS NULL OR storage_max_c IS NULL OR storage_max_c>=storage_min_c)
);
CREATE INDEX lots_expiry_idx ON lots(expires_at);
CREATE TABLE listings (
  id UUID PRIMARY KEY, supplier_org_id UUID NOT NULL REFERENCES organizations(id), lot_id UUID NOT NULL UNIQUE REFERENCES lots(id),
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL CHECK(category IN ('produce','seafood')), unit TEXT NOT NULL CHECK(unit IN ('kg','crate')),
  price_per_unit_minor BIGINT NOT NULL CHECK(price_per_unit_minor BETWEEN 1 AND 10000000), currency TEXT NOT NULL DEFAULT 'PHP' CHECK(currency='PHP'),
  available_quantity NUMERIC(12,3) NOT NULL CHECK(available_quantity BETWEEN 0 AND 1000000), reserved_quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK(reserved_quantity BETWEEN 0 AND 1000000),
  min_order_quantity NUMERIC(12,3) NOT NULL CHECK(min_order_quantity>0 AND min_order_quantity<=1000000),
  location_label TEXT NOT NULL, latitude DOUBLE PRECISION NOT NULL CHECK(latitude BETWEEN -90 AND 90), longitude DOUBLE PRECISION NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  image_url TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','sold_out','recalled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), UNIQUE(id,lot_id)
);
CREATE INDEX listings_catalog_idx ON listings(status,category,created_at DESC);
CREATE INDEX listings_supplier_idx ON listings(supplier_org_id,created_at DESC);
CREATE INDEX listings_search_idx ON listings USING gin(to_tsvector('simple',title || ' ' || description));
CREATE TABLE rfqs (
  id UUID PRIMARY KEY, buyer_org_id UUID NOT NULL REFERENCES organizations(id), title TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('produce','seafood')),
  quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0 AND quantity<=1000000), unit TEXT NOT NULL CHECK(unit IN ('kg','crate')),
  target_price_per_unit_minor BIGINT CHECK(target_price_per_unit_minor BETWEEN 1 AND 10000000), delivery_by TIMESTAMPTZ NOT NULL,
  delivery_location JSONB NOT NULL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','awarded','closed','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rfqs_market_idx ON rfqs(status,category,delivery_by);
CREATE INDEX rfqs_buyer_idx ON rfqs(buyer_org_id,created_at DESC);
CREATE TABLE quotes (
  id UUID PRIMARY KEY, rfq_id UUID NOT NULL REFERENCES rfqs(id), listing_id UUID NOT NULL REFERENCES listings(id), supplier_org_id UUID NOT NULL REFERENCES organizations(id),
  quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0 AND quantity<=1000000), unit TEXT NOT NULL CHECK(unit IN ('kg','crate')),
  price_per_unit_minor BIGINT NOT NULL CHECK(price_per_unit_minor BETWEEN 1 AND 10000000), currency TEXT NOT NULL DEFAULT 'PHP' CHECK(currency='PHP'),
  valid_until TIMESTAMPTZ NOT NULL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','accepted','rejected','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX quotes_rfq_idx ON quotes(rfq_id,created_at);
CREATE UNIQUE INDEX quotes_one_accepted_idx ON quotes(rfq_id) WHERE status='accepted';
CREATE TABLE orders (
  id UUID PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, buyer_org_id UUID NOT NULL REFERENCES organizations(id), supplier_org_id UUID NOT NULL REFERENCES organizations(id),
  status TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK(status IN ('pending_confirmation','confirmed','preparing','ready_for_pickup','in_transit','delivered','completed','cancelled','expired')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','held','released','refunded','disputed')),
  currency TEXT NOT NULL DEFAULT 'PHP' CHECK(currency='PHP'), subtotal_minor BIGINT NOT NULL CHECK(subtotal_minor BETWEEN 0 AND 100000000000000),
  delivery_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK(delivery_fee_minor BETWEEN 0 AND 100000000000000), total_minor BIGINT NOT NULL CHECK(total_minor BETWEEN 1 AND 100000000000000),
  delivery_location JSONB NOT NULL, delivery_by TIMESTAMPTZ NOT NULL, notes TEXT NOT NULL DEFAULT '', reservation_expires_at TIMESTAMPTZ,
  quote_id UUID UNIQUE REFERENCES quotes(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  CHECK(buyer_org_id<>supplier_org_id), CHECK(total_minor=subtotal_minor+delivery_fee_minor)
);
CREATE INDEX orders_buyer_idx ON orders(buyer_org_id,created_at DESC);
CREATE INDEX orders_supplier_idx ON orders(supplier_org_id,status,created_at DESC);
CREATE INDEX orders_reservation_idx ON orders(reservation_expires_at) WHERE status='pending_confirmation';
CREATE TABLE order_items (
  id UUID PRIMARY KEY, order_id UUID NOT NULL REFERENCES orders(id), listing_id UUID NOT NULL, lot_id UUID NOT NULL,
  lot_code TEXT NOT NULL, title TEXT NOT NULL, quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0 AND quantity<=1000000), unit TEXT NOT NULL CHECK(unit IN ('kg','crate')),
  price_per_unit_minor BIGINT NOT NULL CHECK(price_per_unit_minor BETWEEN 1 AND 10000000), line_total_minor BIGINT NOT NULL CHECK(line_total_minor BETWEEN 1 AND 100000000000000),
  lot_snapshot JSONB NOT NULL, FOREIGN KEY(listing_id,lot_id) REFERENCES listings(id,lot_id),
  UNIQUE(order_id,listing_id), CHECK(line_total_minor=round(quantity*price_per_unit_minor))
);
CREATE INDEX order_items_lot_idx ON order_items(lot_id,order_id);
CREATE TABLE shipments (
  id UUID PRIMARY KEY, order_id UUID NOT NULL UNIQUE REFERENCES orders(id), logistics_org_id UUID NOT NULL REFERENCES organizations(id),
  pickup_at TIMESTAMPTZ NOT NULL, expected_delivery_at TIMESTAMPTZ NOT NULL, vehicle_reference TEXT NOT NULL,
  temperature_min_c NUMERIC(5,2), temperature_max_c NUMERIC(5,2), pickup_location JSONB NOT NULL, delivery_location JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','picked_up','in_transit','delivered','exception')),
  latest_temperature_c NUMERIC(5,2), excursion_count INTEGER NOT NULL DEFAULT 0 CHECK(excursion_count>=0), delivery_proof TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  CHECK(expected_delivery_at>pickup_at), CHECK(temperature_min_c IS NULL OR temperature_max_c IS NULL OR temperature_max_c>=temperature_min_c)
);
CREATE INDEX shipments_logistics_idx ON shipments(logistics_org_id,status,pickup_at);
CREATE TABLE temperature_readings (
  id UUID PRIMARY KEY, shipment_id UUID NOT NULL REFERENCES shipments(id), measured_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  temperature_c NUMERIC(5,2) NOT NULL CHECK(temperature_c BETWEEN -100 AND 100), source TEXT NOT NULL CHECK(source IN ('manual','sensor')), device_id TEXT,
  excursion BOOLEAN NOT NULL, CHECK(source<>'sensor' OR device_id IS NOT NULL)
);
CREATE INDEX temperature_readings_shipment_idx ON temperature_readings(shipment_id,measured_at DESC);
CREATE TABLE payments (
  id UUID PRIMARY KEY, order_id UUID NOT NULL UNIQUE REFERENCES orders(id), invoice_number TEXT NOT NULL UNIQUE,
  amount_minor BIGINT NOT NULL CHECK(amount_minor BETWEEN 1 AND 100000000000000), currency TEXT NOT NULL DEFAULT 'PHP' CHECK(currency='PHP'),
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','held','released','refunded','disputed')), provider TEXT NOT NULL DEFAULT 'sandbox' CHECK(provider='sandbox'),
  provider_reference TEXT UNIQUE, held_at TIMESTAMPTZ, released_at TIMESTAMPTZ, refunded_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY, transaction_id UUID NOT NULL, payment_id UUID NOT NULL REFERENCES payments(id),
  account TEXT NOT NULL CHECK(account IN ('buyer_cash','escrow_liability','supplier_payable','buyer_refund')),
  amount_minor BIGINT NOT NULL CHECK(amount_minor<>0 AND abs(amount_minor)<=100000000000000),
  currency TEXT NOT NULL DEFAULT 'PHP' CHECK(currency='PHP'), action TEXT NOT NULL CHECK(action IN ('hold','release','refund')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(transaction_id,account)
);
CREATE INDEX ledger_entries_payment_idx ON ledger_entries(payment_id,created_at);
CREATE TABLE disputes (
  id UUID PRIMARY KEY, order_id UUID NOT NULL REFERENCES orders(id), opened_by_org_id UUID NOT NULL REFERENCES organizations(id), reason TEXT NOT NULL, description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','under_review','resolved_refund','resolved_release')), resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX disputes_one_active_idx ON disputes(order_id) WHERE status IN ('open','under_review');
CREATE TABLE agreements (
  id UUID PRIMARY KEY, buyer_org_id UUID NOT NULL REFERENCES organizations(id), supplier_org_id UUID NOT NULL REFERENCES organizations(id), listing_id UUID NOT NULL REFERENCES listings(id),
  title TEXT NOT NULL, quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0 AND quantity<=1000000), unit TEXT NOT NULL CHECK(unit IN ('kg','crate')),
  price_per_unit_minor BIGINT NOT NULL CHECK(price_per_unit_minor BETWEEN 1 AND 10000000), currency TEXT NOT NULL DEFAULT 'PHP' CHECK(currency='PHP'),
  cadence TEXT NOT NULL CHECK(cadence IN ('weekly','fortnightly','monthly')), starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','ended')), next_delivery_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(ends_at>starts_at), CHECK(buyer_org_id<>supplier_org_id)
);
CREATE INDEX agreements_parties_idx ON agreements(buyer_org_id,supplier_org_id,status);
CREATE TABLE idempotency_keys (
  organization_id UUID NOT NULL REFERENCES organizations(id), scope TEXT NOT NULL, key TEXT NOT NULL CHECK(length(key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL, response_status INTEGER, response_body JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL DEFAULT (now()+interval '7 days'),
  PRIMARY KEY(organization_id,scope,key), CHECK(response_status IS NULL OR response_status BETWEEN 200 AND 599)
);
CREATE INDEX idempotency_expiry_idx ON idempotency_keys(expires_at);
CREATE TABLE audit_events (
  id UUID PRIMARY KEY, actor_user_id UUID REFERENCES users(id), organization_id UUID NOT NULL REFERENCES organizations(id), action TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id UUID NOT NULL, reason TEXT, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_idx ON audit_events(organization_id,created_at DESC);
CREATE INDEX audit_events_entity_idx ON audit_events(entity_type,entity_id,created_at);
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY, event_type TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version>0), organization_id UUID NOT NULL REFERENCES organizations(id),
  aggregate_type TEXT NOT NULL, aggregate_id UUID NOT NULL, aggregate_version INTEGER NOT NULL DEFAULT 1, correlation_id TEXT NOT NULL,
  payload JSONB NOT NULL, occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), published_at TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), last_error TEXT
);
CREATE INDEX outbox_unpublished_idx ON outbox_events(occurred_at) WHERE published_at IS NULL;
CREATE TABLE notification_deliveries (
  id UUID PRIMARY KEY, event_id UUID NOT NULL REFERENCES outbox_events(id), channel TEXT NOT NULL CHECK(channel IN ('sms','whatsapp','in_app')),
  recipient_org_id UUID NOT NULL REFERENCES organizations(id), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','disabled')),
  attempts INTEGER NOT NULL DEFAULT 0, provider_reference TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(event_id,channel,recipient_org_id)
);
CREATE FUNCTION reject_protected_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE='42501'; END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_protected_mutation();
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION reject_protected_mutation();
CREATE TRIGGER order_items_immutable BEFORE UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION reject_protected_mutation();
CREATE FUNCTION check_ledger_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COALESCE(sum(amount_minor),0) FROM ledger_entries WHERE transaction_id=NEW.transaction_id)<>0 THEN
    RAISE EXCEPTION 'Ledger transaction % is not balanced', NEW.transaction_id USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_balance();
