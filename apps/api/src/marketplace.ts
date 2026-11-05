import { randomUUID } from 'node:crypto';
import type { Database, Queryable } from './database.js';
import { type Actor, ApiFault, coarse, found, future, hashToken, iso, money, one, paginate, requireThat, role, stable, units, version } from './core.js';
import * as map from './mappers.js';
import type { AuthService } from './auth.js';

const listingSql = `SELECT l.*,o.name supplier_name,o.verification_status supplier_verification,t.code lot_code,t.harvested_at,t.expires_at,t.origin_label,t.origin_latitude,t.origin_longitude,t.catch_method,t.cold_chain_status,t.storage_min_c,t.storage_max_c,t.source_type,t.source_name,t.evidence_type FROM listings l JOIN lots t ON t.id=l.lot_id JOIN organizations o ON o.id=l.supplier_org_id`;
const orderSql = `SELECT o.*,b.name buyer_name,s.name supplier_name,sh.id shipment_id,sh.logistics_org_id FROM orders o JOIN organizations b ON b.id=o.buyer_org_id JOIN organizations s ON s.id=o.supplier_org_id LEFT JOIN shipments sh ON sh.order_id=o.id`;
const shipmentSql = `SELECT s.*,o.order_number,o.supplier_org_id,o.buyer_org_id,l.name logistics_name FROM shipments s JOIN orders o ON o.id=s.order_id JOIN organizations l ON l.id=s.logistics_org_id`;
async function insert(tx: Queryable, table: string, values: Record<string, any>) {
  const entries = Object.entries(values);
  return one(tx, `INSERT INTO ${table}(${entries.map(([k]) => k).join(',')}) VALUES(${entries.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, entries.map(([, v]) => v));
}
async function update(tx: Queryable, table: string, id: string, values: Record<string, any>) {
  const entries = Object.entries(values);
  return one(tx, `UPDATE ${table} SET ${entries.map(([k], i) => `${k}=$${i + 1}`).join(',')} WHERE id=$${entries.length + 1} RETURNING *`, [...entries.map(([, v]) => v), id]);
}
export class Marketplace {
  constructor(readonly db: Database, readonly auth: AuthService, readonly sandbox = true) {}
  async audit(tx: Queryable, actor: Actor, action: string, entityType: string, entityId: string, reason?: string, organizations: string[] = [actor.organizationId], aggregateVersion = 1) {
    await insert(tx, 'audit_events', { id: randomUUID(), actor_user_id: actor.id, organization_id: actor.organizationId, action, entity_type: entityType, entity_id: entityId, reason: reason ?? null });
    let type: string | undefined, data: any;
    if (entityType === 'listing') { const row = await one(tx, 'SELECT status,version FROM listings WHERE id=$1', [entityId]); type = 'listing.changed'; data = { listingId: entityId, status: row.status }; aggregateVersion = row.version; }
    if (entityType === 'order') { const row = await one(tx, 'SELECT status,version FROM orders WHERE id=$1', [entityId]); type = action === 'order.created' ? action : 'order.status_changed'; data = { orderId: entityId, status: row.status }; aggregateVersion = row.version; }
    if (entityType === 'shipment') { const row = await one(tx, 'SELECT order_id,status,version FROM shipments WHERE id=$1', [entityId]); type = 'shipment.updated'; data = { shipmentId: entityId, orderId: row.order_id, status: row.status }; aggregateVersion = row.version; }
    if (entityType === 'payment') { const row = await one(tx, 'SELECT p.order_id,p.status,o.version FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1', [entityId]); type = 'payment.updated'; data = { orderId: row.order_id, status: row.status }; aggregateVersion = row.version; }
    if (entityType === 'dispute') { const row = await one(tx, 'SELECT order_id,status FROM disputes WHERE id=$1', [entityId]); type = 'dispute.updated'; data = { disputeId: entityId, orderId: row.order_id, status: row.status }; aggregateVersion = Number((await one(tx, "SELECT count(*) AS revision FROM audit_events WHERE entity_type='dispute' AND entity_id=$1", [entityId])).revision); }
    if (action === 'organization.verification_changed') { const row = await one(tx, 'SELECT verification_status,version FROM organizations WHERE id=$1', [entityId]); type = 'verification.updated'; data = { organizationId: entityId, status: row.verification_status }; aggregateVersion = row.version; }
    if (type) for (const org of [...new Set(organizations)]) await insert(tx, 'outbox_events', { id: randomUUID(), event_type: type, organization_id: org, aggregate_type: entityType, aggregate_id: entityId, aggregate_version: aggregateVersion, correlation_id: randomUUID(), payload: JSON.stringify(data) });
  }
  async verified(actor: Actor, tx: Queryable = this.db) { const org = found(await one(tx, 'SELECT verification_status FROM organizations WHERE id=$1', [actor.organizationId])); requireThat(org.verification_status === 'verified', 403, 'VERIFICATION_REQUIRED', 'Organization verification is required for this action.'); }
  async idem(actor: Actor, operation: string, key: string | undefined, body: any, fn: (tx: Queryable) => Promise<any>) {
    requireThat(key && /^[A-Za-z0-9_-]{8,128}$/.test(key), 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide a stable Idempotency-Key of 8–128 letters, numbers, underscores or hyphens.');
    const scope = `${actor.id}:${operation}`, fingerprint = hashToken(stable(body));
    return this.db.transaction(async tx => {
      await tx.query('INSERT INTO idempotency_keys(organization_id,scope,key,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [actor.organizationId, scope, key, fingerprint]);
      const saved = await one(tx, 'SELECT * FROM idempotency_keys WHERE organization_id=$1 AND scope=$2 AND key=$3 FOR UPDATE', [actor.organizationId, scope, key]);
      requireThat(saved.request_hash === fingerprint, 409, 'IDEMPOTENCY_CONFLICT', 'This submission key was already used for different details.');
      if (saved.response_body) return saved.response_body;
      const result = await fn(tx);
      await tx.query('UPDATE idempotency_keys SET response_status=200,response_body=$4 WHERE organization_id=$1 AND scope=$2 AND key=$3', [actor.organizationId, scope, key, JSON.stringify(result)]);
      return result;
    });
  }
  async organizations(actor: Actor, query: any) { role(actor, 'admin'); const rows = (await this.db.query('SELECT * FROM organizations ORDER BY created_at DESC')).rows; return paginate(await Promise.all(rows.map((r: any) => this.auth.org(r.id))), query); }
  async partners(_actor: Actor, query: any) {
    const rows = (await this.db.query("SELECT * FROM organizations WHERE verification_status='verified' AND role<>'admin' ORDER BY name")).rows as any[];
    return paginate(rows.filter(r => !query.role || r.role === query.role).map(r => ({ id: r.id, name: r.name, role: r.role, verificationStatus: r.verification_status, location: coarse({ label: r.location_label, latitude: Number(r.latitude), longitude: Number(r.longitude) }) })), query);
  }
  async updateOrganization(actor: Actor, body: any) {
    return this.db.transaction(async tx => {
      const row = found(await one(tx, 'SELECT * FROM organizations WHERE id=$1 FOR UPDATE', [actor.organizationId])); version(row, body.expectedVersion);
      const values: any = { version: row.version + 1 };
      for (const [wire, sql] of [['name', 'name'], ['contactName', 'contact_name'], ['phone', 'phone'], ['licenseNumber', 'license_number'], ['description', 'description']]) if (body[wire] !== undefined) values[sql] = body[wire];
      if (body.location) Object.assign(values, { location_label: body.location.label, latitude: body.location.latitude, longitude: body.location.longitude });
      if (actor.role !== 'buyer' && (body.licenseNumber !== undefined && body.licenseNumber !== row.license_number || body.certificates !== undefined)) values.verification_status = 'pending';
      if (body.certificates) {
        requireThat(body.certificates.every((c: any) => c.documentUrl === null), 422, 'UPLOADS_DISABLED', 'Private document uploads are not enabled in this release. Add certificate references without a document URL.');
        await tx.query('DELETE FROM organization_certificates WHERE organization_id=$1', [actor.organizationId]);
        for (const c of body.certificates) await insert(tx, 'organization_certificates', { id: c.id, organization_id: actor.organizationId, name: c.name, reference: c.reference, expires_at: c.expiresAt, document_url: null });
      }
      await update(tx, 'organizations', actor.organizationId, values); await this.audit(tx, actor, 'organization.updated', 'organization', actor.organizationId);
      return this.auth.org(actor.organizationId, tx);
    });
  }
  async verifyOrganization(actor: Actor, id: string, body: any) {
    role(actor, 'admin'); requireThat(id !== actor.organizationId, 403, 'FORBIDDEN', 'You cannot review your own organization.');
    return this.db.transaction(async tx => {
      const row = found(await one(tx, 'SELECT * FROM organizations WHERE id=$1 FOR UPDATE', [id])); version(row, body.expectedVersion);
      requireThat(row.role !== 'admin', 403, 'FORBIDDEN', 'Administrative organizations cannot be reviewed here.');
      await update(tx, 'organizations', id, { verification_status: body.status, version: row.version + 1 });
      if (body.status === 'suspended') await tx.query('UPDATE refresh_sessions SET revoked_at=now() WHERE user_id IN (SELECT id FROM users WHERE organization_id=$1)', [id]);
      await this.audit(tx, actor, 'organization.verification_changed', 'organization', id, body.reason, [actor.organizationId, id]);
      return this.auth.org(id, tx);
    });
  }
  eligible(row: any, deliveryBy?: string) {
    requireThat(row.status === 'active' && row.supplier_verification === 'verified', 409, 'LISTING_UNAVAILABLE', 'The listing is not available for ordering.');
    requireThat(Date.parse(row.expires_at) > Math.max(Date.now(), deliveryBy ? Date.parse(deliveryBy) : 0), 409, 'LOT_EXPIRED', 'The lot expires before the required delivery.');
    requireThat(!['unknown', 'excursion'].includes(row.cold_chain_status), 409, 'COLD_CHAIN_HOLD', 'The lot has a cold-chain hold.');
  }
  async listings(actor: Actor, query: any) {
    if (query.scope === 'all') role(actor, 'admin');
    const mine = query.mine === 'true', all = query.scope === 'all';
    const clauses: string[] = [], values: any[] = [];
    const where = (sql: string, value: any) => { values.push(value); clauses.push(sql.replace('?', '$' + values.length)); };
    if (mine) where('l.supplier_org_id=?', actor.organizationId);
    else if (!all) clauses.push("l.status='active' AND o.verification_status='verified' AND t.expires_at>now() AND t.cold_chain_status NOT IN ('unknown','excursion')");
    if (query.category) where('l.category=?', query.category);
    if (query.status) where('l.status=?', query.status);
    if (query.search) { requireThat(typeof query.search === 'string' && query.search.length <= 120, 400, 'INVALID_SEARCH', 'Search is too long.'); where("(l.title || ' ' || l.description) ILIKE ?", '%' + query.search + '%'); }
    const sort = query.sort === 'price_asc' ? 'l.price_per_unit_minor ASC' : query.sort === 'freshness' ? 't.harvested_at DESC' : 'l.created_at DESC';
    const rows = (await this.db.query(`${listingSql}${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''} ORDER BY ${sort}`, values)).rows as any[];
    return paginate(rows.map(r => map.listing(r, mine || all)), query);
  }
  async getListing(actor: Actor, id: string, tx: Queryable = this.db, lock = false) {
    const row = found(await one(tx, `${listingSql} WHERE l.id=$1${lock ? ' FOR UPDATE OF l' : ''}`, [id]));
    const own = row.supplier_org_id === actor.organizationId || actor.role === 'admin';
    requireThat(own || row.status === 'active' && row.supplier_verification === 'verified' && Date.parse(row.expires_at) > Date.now(), 404, 'NOT_FOUND', 'This listing is not available.');
    return map.listing(row, own);
  }
  async createListing(actor: Actor, body: any) {
    role(actor, 'supplier'); units(body.quantity); units(body.minOrderQuantity);
    requireThat(units(body.quantity) >= units(body.minOrderQuantity), 422, 'MINIMUM_EXCEEDS_STOCK', 'Minimum order cannot exceed available quantity.');
    const lot = body.lot;
    requireThat(Date.parse(lot.harvestedAt) <= Date.now() && Date.parse(lot.expiresAt) > Date.parse(lot.harvestedAt), 422, 'INVALID_LOT_DATES', 'Harvest must be in the past and expiry after harvest.');
    requireThat(body.category !== 'seafood' || ['chilled', 'frozen'].includes(lot.coldChainStatus) && lot.catchMethod.trim().length > 0 && lot.catchMethod !== 'not_applicable' && lot.storageMinC !== null && lot.storageMaxC !== null, 422, 'INVALID_COLD_CHAIN', 'Seafood requires a catch method and chilled or frozen storage with temperature limits.');
    requireThat(body.category !== 'produce' || lot.catchMethod === 'not_applicable', 422, 'INVALID_CATCH_METHOD', 'Produce catch method must be not_applicable.');
    requireThat(lot.storageMinC === null || lot.storageMaxC === null || lot.storageMinC <= lot.storageMaxC, 422, 'INVALID_TEMPERATURE_RANGE', 'Storage limits are reversed.');
    requireThat(!body.imageUrl || /^https:\/\//.test(body.imageUrl), 422, 'INVALID_IMAGE', 'Images must use HTTPS.');
    return this.db.transaction(async tx => {
      if (body.status === 'active') { await this.verified(actor, tx); future(lot.expiresAt); requireThat(!['unknown', 'excursion'].includes(lot.coldChainStatus), 422, 'COLD_CHAIN_HOLD', 'Resolve the cold-chain status before publishing.'); }
      const lotId = randomUUID(), id = randomUUID();
      await insert(tx, 'lots', { id: lotId, supplier_org_id: actor.organizationId, code: lot.code, harvested_at: lot.harvestedAt, expires_at: lot.expiresAt, origin_label: lot.origin.label, origin_latitude: lot.origin.latitude, origin_longitude: lot.origin.longitude, catch_method: lot.catchMethod, cold_chain_status: lot.coldChainStatus, storage_min_c: lot.storageMinC, storage_max_c: lot.storageMaxC, source_type: lot.sourceType, source_name: lot.sourceName });
      await insert(tx, 'listings', { id, supplier_org_id: actor.organizationId, lot_id: lotId, title: body.title, description: body.description, category: body.category, unit: body.unit, price_per_unit_minor: body.pricePerUnitMinor, currency: body.currency, available_quantity: body.quantity, min_order_quantity: body.minOrderQuantity, location_label: body.location.label, latitude: body.location.latitude, longitude: body.location.longitude, image_url: body.imageUrl ?? null, status: body.status });
      await this.audit(tx, actor, 'listing.created', 'listing', id);
      return this.getListing(actor, id, tx);
    });
  }
  async updateListing(actor: Actor, id: string, body: any) {
    role(actor, 'supplier', 'admin');
    return this.db.transaction(async tx => {
      const row = found(await one(tx, `${listingSql} WHERE l.id=$1 FOR UPDATE OF l`, [id]));
      requireThat(actor.role === 'admin' || row.supplier_org_id === actor.organizationId, 404, 'NOT_FOUND', 'This listing is not available.'); version(row, body.expectedVersion);
      if (actor.role === 'admin') requireThat(['paused', 'recalled'].includes(body.status) && body.reason && Object.keys(body).every(k => ['expectedVersion', 'status', 'reason'].includes(k)), 403, 'FORBIDDEN', 'Administrators may only pause or recall a listing with a reason.');
      requireThat(row.status !== 'recalled', 409, 'LOT_RECALLED', 'A recalled listing cannot be republished or edited.');
      const values: any = { version: row.version + 1 };
      for (const [wire, sql] of [['title', 'title'], ['description', 'description'], ['pricePerUnitMinor', 'price_per_unit_minor'], ['minOrderQuantity', 'min_order_quantity'], ['status', 'status']]) if (body[wire] !== undefined) values[sql] = body[wire];
      if (body.minOrderQuantity) units(body.minOrderQuantity);
      if (body.status === 'active') { await this.verified(actor, tx); this.eligible({ ...row, status: 'active' }); }
      if (body.status === 'recalled') requireThat(body.reason, 422, 'REASON_REQUIRED', 'A recall reason is required.');
      if (body.quantityDelta !== undefined) {
        requireThat(body.reason, 422, 'REASON_REQUIRED', 'Inventory corrections require a reason.');
        const delta = units(body.quantityDelta, true), available = BigInt(Math.round(Number(row.available_quantity) * 1000)) + delta;
        requireThat(available >= 0n && available + BigInt(Math.round(Number(row.reserved_quantity) * 1000)) <= 1000000000n, 409, 'STOCK_CONFLICT', 'This correction would remove committed stock or exceed the stock limit.');
        values.available_quantity = (Number(available) / 1000).toFixed(3);
      }
      await update(tx, 'listings', id, values); await this.audit(tx, actor, body.status === 'recalled' ? 'lot.recalled' : 'listing.updated', 'listing', id, body.reason, [row.supplier_org_id]);
      return this.getListing(actor, id, tx);
    });
  }
  async rfqs(actor: Actor, query: any) {
    role(actor, 'supplier', 'buyer', 'admin');
    const scope = actor.role === 'buyer' ? 'WHERE r.buyer_org_id=$1' : actor.role === 'supplier' ? "WHERE r.status='open' OR EXISTS(SELECT 1 FROM quotes q WHERE q.rfq_id=r.id AND q.supplier_org_id=$1)" : '';
    const rows = (await this.db.query(`SELECT r.*,o.name buyer_name FROM rfqs r JOIN organizations o ON o.id=r.buyer_org_id ${scope} ORDER BY r.created_at DESC`, scope ? [actor.organizationId] : [])).rows as any[];
    const result = [];
    for (const r of rows) {
      const quotes = (await this.db.query(`SELECT q.*,o.name supplier_name FROM quotes q JOIN organizations o ON o.id=q.supplier_org_id WHERE q.rfq_id=$1${actor.role === 'supplier' ? ' AND q.supplier_org_id=$2' : ''}`, actor.role === 'supplier' ? [r.id, actor.organizationId] : [r.id])).rows;
      const view = map.rfq(r, quotes.map(map.quote)); if (actor.role === 'supplier') view.deliveryLocation = coarse(view.deliveryLocation); result.push(view);
    }
    return paginate(result, query);
  }
  async createRfq(actor: Actor, body: any) { role(actor, 'buyer'); units(body.quantity); future(body.deliveryBy); return this.db.transaction(async tx => { const r = await insert(tx, 'rfqs', { id: randomUUID(), buyer_org_id: actor.organizationId, title: body.title, category: body.category, quantity: body.quantity, unit: body.unit, target_price_per_unit_minor: body.targetPricePerUnitMinor, delivery_by: body.deliveryBy, delivery_location: JSON.stringify(body.deliveryLocation), notes: body.notes }); await this.audit(tx, actor, 'rfq.created', 'rfq', r.id); return map.rfq({ ...r, buyer_name: (await this.auth.org(actor.organizationId, tx)).name }, []); }); }
  async createQuote(actor: Actor, id: string, body: any) {
    role(actor, 'supplier'); units(body.quantity); future(body.validUntil);
    return this.db.transaction(async tx => {
      await this.verified(actor, tx); const r = found(await one(tx, 'SELECT * FROM rfqs WHERE id=$1 FOR UPDATE', [id]));
      requireThat(r.status === 'open' && Date.parse(r.delivery_by) > Date.now(), 409, 'RFQ_CLOSED', 'This request is no longer open.');
      const l = found(await one(tx, `${listingSql} WHERE l.id=$1`, [body.listingId])); requireThat(l.supplier_org_id === actor.organizationId, 404, 'NOT_FOUND', 'Listing is not available.'); this.eligible(l, r.delivery_by);
      requireThat(l.category === r.category && l.unit === r.unit && units(body.quantity) === units(r.quantity) && units(body.quantity) >= units(l.min_order_quantity), 422, 'QUOTE_MISMATCH', 'Quote must match the requested category, unit and full quantity.');
      requireThat(Date.parse(body.validUntil) <= Date.parse(r.delivery_by), 422, 'INVALID_QUOTE_EXPIRY', 'Quote expiry must not follow delivery.');
      const q = await insert(tx, 'quotes', { id: randomUUID(), rfq_id: id, listing_id: l.id, supplier_org_id: actor.organizationId, quantity: body.quantity, unit: l.unit, price_per_unit_minor: body.pricePerUnitMinor, currency: l.currency, valid_until: body.validUntil, notes: body.notes });
      await this.audit(tx, actor, 'quote.created', 'quote', q.id, undefined, [actor.organizationId, r.buyer_org_id]); return map.quote({ ...q, supplier_name: l.supplier_name });
    });
  }
  async visibleOrder(actor: Actor, id: string, tx: Queryable = this.db, lock = false) {
    const r = found(await one(tx, `${orderSql} WHERE o.id=$1${lock ? ' FOR UPDATE OF o' : ''}`, [id]));
    requireThat(actor.role === 'admin' || [r.buyer_org_id, r.supplier_org_id, r.logistics_org_id].includes(actor.organizationId), 404, 'NOT_FOUND', 'This order is not available.'); return r;
  }
  async orderView(r: any, tx: Queryable = this.db) { return map.order(r, (await tx.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [r.id])).rows); }
  async getOrder(actor: Actor, id: string, tx: Queryable = this.db) { role(actor, 'buyer', 'supplier', 'admin'); return this.orderView(await this.visibleOrder(actor, id, tx), tx); }
  async orders(actor: Actor, query: any) {
    role(actor, 'buyer', 'supplier', 'admin');
    const scope = actor.role === 'admin' ? '' : actor.role === 'buyer' ? 'o.buyer_org_id=$1' : actor.role === 'supplier' ? 'o.supplier_org_id=$1' : 'sh.logistics_org_id=$1';
    const values: any[] = scope ? [actor.organizationId] : [], clauses = scope ? [scope] : [];
    if (query.status) { values.push(query.status); clauses.push('o.status=$' + values.length); }
    const rows = (await this.db.query(`${orderSql}${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''} ORDER BY o.created_at DESC`, values)).rows as any[];
    return paginate(await Promise.all(rows.map(r => this.orderView(r))), query);
  }
  async buildOrder(tx: Queryable, actor: Actor, body: any, acceptedQuote?: any) {
    await this.verified(actor, tx); future(body.deliveryBy);
    requireThat(body.items.length > 0 && new Set(body.items.map((i: any) => i.listingId)).size === body.items.length, 422, 'DUPLICATE_LISTING', 'Choose each listing only once.');
    const lines: any[] = [];
    for (const item of [...body.items].sort((a, b) => a.listingId.localeCompare(b.listingId))) {
      const r = found(await one(tx, `${listingSql} WHERE l.id=$1 FOR UPDATE OF l`, [item.listingId])); this.eligible(r, body.deliveryBy);
      requireThat(r.supplier_org_id !== actor.organizationId && (!lines.length || lines[0].row.supplier_org_id === r.supplier_org_id), 422, 'SINGLE_SUPPLIER_REQUIRED', 'Each order must contain goods from one other supplier.');
      const quantity = units(item.quantity); requireThat(quantity >= units(r.min_order_quantity) && quantity <= BigInt(Math.round(Number(r.available_quantity) * 1000)), 409, 'INSUFFICIENT_STOCK', 'Requested quantity is below the minimum or exceeds available stock.');
      const price = acceptedQuote ? Number(acceptedQuote.price_per_unit_minor) : Number(r.price_per_unit_minor);
      if (!acceptedQuote) requireThat(item.expectedUnitPriceMinor === price, 409, 'PRICE_CHANGED', 'The supplier price changed. Review the current price before submitting a new order.');
      lines.push({ row: r, quantity: item.quantity, price, total: money(item.quantity, price) });
    }
    const total = lines.reduce((sum, line) => sum + line.total, 0); requireThat(total <= 100000000000000, 422, 'INVALID_TOTAL', 'Order exceeds the supported amount.');
    const id = randomUUID(), number = 'HL-' + id.slice(0, 8).toUpperCase();
    await insert(tx, 'orders', { id, order_number: number, buyer_org_id: actor.organizationId, supplier_org_id: lines[0].row.supplier_org_id, subtotal_minor: total, total_minor: total, delivery_location: JSON.stringify(body.deliveryLocation), delivery_by: body.deliveryBy, notes: body.notes, reservation_expires_at: new Date(Date.now() + 1800000), quote_id: acceptedQuote?.id ?? null });
    for (const line of lines) {
      const r = line.row; await tx.query('UPDATE listings SET available_quantity=available_quantity-$1,reserved_quantity=reserved_quantity+$1,version=version+1 WHERE id=$2', [line.quantity, r.id]);
      await insert(tx, 'order_items', { id: randomUUID(), order_id: id, listing_id: r.id, lot_id: r.lot_id, lot_code: r.lot_code, title: r.title, quantity: line.quantity, unit: r.unit, price_per_unit_minor: line.price, line_total_minor: line.total, lot_snapshot: JSON.stringify(map.listing(r, true).lot) });
    }
    await insert(tx, 'payments', { id: randomUUID(), order_id: id, invoice_number: 'INV-' + number, amount_minor: total });
    await this.audit(tx, actor, 'order.created', 'order', id, undefined, [actor.organizationId, lines[0].row.supplier_org_id]);
    return this.getOrder(actor, id, tx);
  }
  async createOrder(actor: Actor, body: any, key: string | undefined) { role(actor, 'buyer'); return this.idem(actor, 'createOrder', key, body, tx => this.buildOrder(tx, actor, body)); }
  async acceptQuote(actor: Actor, id: string, key: string | undefined) {
    role(actor, 'buyer'); return this.idem(actor, 'acceptQuote', key, { id }, async tx => {
      const q = found(await one(tx, 'SELECT q.*,r.buyer_org_id,r.status rfq_status,r.delivery_by,r.delivery_location,r.notes rfq_notes FROM quotes q JOIN rfqs r ON r.id=q.rfq_id WHERE q.id=$1 FOR UPDATE OF r,q', [id]));
      requireThat(q.buyer_org_id === actor.organizationId, 404, 'NOT_FOUND', 'This quote is not available.');
      requireThat(q.status === 'submitted' && q.rfq_status === 'open' && Date.parse(q.valid_until) > Date.now(), 409, 'QUOTE_UNAVAILABLE', 'This quote has expired or was already awarded.');
      const order = await this.buildOrder(tx, actor, { items: [{ listingId: q.listing_id, quantity: q.quantity }], deliveryBy: iso(q.delivery_by), deliveryLocation: q.delivery_location, notes: q.rfq_notes }, q);
      await tx.query("UPDATE quotes SET status=CASE WHEN id=$1 THEN 'accepted' ELSE 'rejected' END WHERE rfq_id=$2", [id, q.rfq_id]); await tx.query("UPDATE rfqs SET status='awarded' WHERE id=$1", [q.rfq_id]); return order;
    });
  }
  async returnStock(tx: Queryable, orderId: string) {
    const items = (await tx.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY listing_id', [orderId])).rows as any[];
    for (const i of items) await tx.query('UPDATE listings SET available_quantity=available_quantity+$1,reserved_quantity=reserved_quantity-$1,version=version+1 WHERE id=$2', [i.quantity, i.listing_id]);
  }
  async ledger(tx: Queryable, payment: any, action: 'hold' | 'release' | 'refund') {
    requireThat(this.sandbox, 503, 'PAYMENTS_DISABLED', 'Live payments are not configured.');
    const transaction = randomUUID(), amount = Number(payment.amount_minor);
    const accounts = action === 'hold' ? ['buyer_cash', 'escrow_liability'] : action === 'release' ? ['escrow_liability', 'supplier_payable'] : ['escrow_liability', 'buyer_refund'];
    for (let i = 0; i < 2; i++) await insert(tx, 'ledger_entries', { id: randomUUID(), transaction_id: transaction, payment_id: payment.id, account: accounts[i], amount_minor: i === 0 ? -amount : amount, action });
    const status = action === 'hold' ? 'held' : action === 'release' ? 'released' : 'refunded';
    await update(tx, 'payments', payment.id, { status, [action === 'hold' ? 'held_at' : action === 'release' ? 'released_at' : 'refunded_at']: new Date(), provider_reference: payment.provider_reference ?? `sandbox-${payment.id}` });
    await tx.query('UPDATE orders SET payment_status=$1,version=version+1,updated_at=now() WHERE id=$2', [status, payment.order_id]);
  }
  async changeOrderStatus(actor: Actor, id: string, body: any) {
    return this.db.transaction(async tx => {
      const r = await this.visibleOrder(actor, id, tx, true); version(r, body.expectedVersion);
      const next = body.status, prev = r.status;
      const supplierTransitions: Record<string, string> = { pending_confirmation: 'confirmed', confirmed: 'preparing', preparing: 'ready_for_pickup' };
      if (next === 'cancelled') {
        requireThat(actor.role === 'admin' || actor.organizationId === r.buyer_org_id, 403, 'FORBIDDEN', 'Only the buyer or administrator can cancel this order.');
        requireThat(['pending_confirmation', 'confirmed', 'preparing', 'ready_for_pickup'].includes(prev), 409, 'INVALID_TRANSITION', 'This order can no longer be cancelled.');
        requireThat(actor.role !== 'admin' || body.reason, 422, 'REASON_REQUIRED', 'Administrative cancellation needs a reason.');
        requireThat(!['released', 'disputed'].includes(r.payment_status), 409, 'PAYMENT_CONFLICT', 'Resolve the payment dispute before cancellation.');
        if (r.payment_status === 'held') await this.ledger(tx, found(await one(tx, 'SELECT * FROM payments WHERE order_id=$1 FOR UPDATE', [id])), 'refund');
        await this.returnStock(tx, id);
      } else if (next === 'completed') {
        requireThat(actor.organizationId === r.buyer_org_id && prev === 'delivered' && r.payment_status === 'released', 409, 'INVALID_TRANSITION', 'Only the buyer may complete a delivered order after payment release.');
      } else {
        requireThat(actor.organizationId === r.supplier_org_id && supplierTransitions[prev] === next, 403, 'INVALID_TRANSITION', 'This status change is not available for your role.');
        await this.verified(actor, tx);
        requireThat(prev !== 'pending_confirmation' || Date.parse(r.reservation_expires_at) > Date.now(), 409, 'RESERVATION_EXPIRED', 'This stock reservation has expired.');
        const lots = (await tx.query('SELECT l.status,t.expires_at,t.cold_chain_status FROM order_items i JOIN listings l ON l.id=i.listing_id JOIN lots t ON t.id=i.lot_id WHERE i.order_id=$1', [id])).rows as any[];
        requireThat(lots.every(l => l.status !== 'recalled' && !['excursion', 'unknown'].includes(l.cold_chain_status) && Date.parse(l.expires_at) > Date.now()), 409, 'LOT_HOLD', 'A lot on this order is expired or on hold.');
      }
      await tx.query('UPDATE orders SET status=$1,reservation_expires_at=NULL,version=version+1,updated_at=now() WHERE id=$2', [next, id]);
      await this.audit(tx, actor, 'order.status_changed', 'order', id, body.reason, [r.buyer_org_id, r.supplier_org_id, ...(r.logistics_org_id ? [r.logistics_org_id] : [])], r.version + 1);
      return this.getOrder(actor, id, tx);
    });
  }
  async visibleShipment(actor: Actor, id: string, tx: Queryable = this.db, lock = false) {
    const r = found(await one(tx, `${shipmentSql} WHERE s.id=$1${lock ? ' FOR UPDATE OF s' : ''}`, [id]));
    requireThat(actor.role === 'admin' || [r.buyer_org_id, r.supplier_org_id, r.logistics_org_id].includes(actor.organizationId), 404, 'NOT_FOUND', 'This shipment is not available.'); return r;
  }
  async shipments(actor: Actor, query: any) {
    const clause = actor.role === 'admin' ? '' : actor.role === 'buyer' ? 'o.buyer_org_id=$1' : actor.role === 'supplier' ? 'o.supplier_org_id=$1' : 's.logistics_org_id=$1';
    const rows = (await this.db.query(`${shipmentSql}${clause ? ' WHERE ' + clause : ''} ORDER BY s.pickup_at DESC`, clause ? [actor.organizationId] : [])).rows as any[];
    return paginate(rows.filter(r => !query.status || r.status === query.status).map(map.shipment), query);
  }
  async getShipment(actor: Actor, id: string) { return map.shipment(await this.visibleShipment(actor, id)); }
  async createShipment(actor: Actor, body: any) {
    role(actor, 'supplier'); future(body.pickupAt);
    requireThat(Date.parse(body.expectedDeliveryAt) > Date.parse(body.pickupAt), 422, 'INVALID_DATES', 'Expected delivery must follow pickup.');
    requireThat(body.temperatureMinC === null || body.temperatureMaxC === null || body.temperatureMinC <= body.temperatureMaxC, 422, 'INVALID_TEMPERATURE_RANGE', 'Temperature limits are reversed.');
    return this.db.transaction(async tx => {
      await this.verified(actor, tx); const order = await this.visibleOrder(actor, body.orderId, tx, true);
      requireThat(order.supplier_org_id === actor.organizationId, 404, 'NOT_FOUND', 'This order is not available.');
      requireThat(['confirmed', 'preparing', 'ready_for_pickup'].includes(order.status) && !order.shipment_id, 409, 'SHIPMENT_CONFLICT', 'An unassigned confirmed order is required.');
      const carrier = await one(tx, "SELECT id FROM organizations WHERE id=$1 AND role='logistics' AND verification_status='verified'", [body.logisticsOrgId]); requireThat(carrier, 422, 'INVALID_CARRIER', 'Select a verified logistics partner.');
      const lots = (await tx.query('SELECT t.expires_at,t.storage_min_c,t.storage_max_c,t.cold_chain_status,l.location_label,l.latitude,l.longitude FROM order_items i JOIN lots t ON t.id=i.lot_id JOIN listings l ON l.id=i.listing_id WHERE i.order_id=$1 ORDER BY i.id', [order.id])).rows as any[];
      requireThat(Date.parse(body.expectedDeliveryAt) <= Date.parse(order.delivery_by) && lots.every(l => Date.parse(l.expires_at) > Date.parse(body.expectedDeliveryAt)), 422, 'DELIVERY_AFTER_EXPIRY', 'Delivery must meet the order deadline and lot expiry.');
      for (const l of lots) if (['chilled', 'frozen'].includes(l.cold_chain_status)) requireThat(body.temperatureMinC !== null && body.temperatureMaxC !== null && body.temperatureMinC >= Number(l.storage_min_c) && body.temperatureMaxC <= Number(l.storage_max_c), 422, 'INVALID_COLD_CHAIN', 'Carrier temperature limits must satisfy every lot.');
      const id = randomUUID(), first = lots[0];
      await insert(tx, 'shipments', { id, order_id: order.id, logistics_org_id: body.logisticsOrgId, pickup_at: body.pickupAt, expected_delivery_at: body.expectedDeliveryAt, vehicle_reference: body.vehicleReference, temperature_min_c: body.temperatureMinC, temperature_max_c: body.temperatureMaxC, pickup_location: JSON.stringify({ label: first.location_label, latitude: Number(first.latitude), longitude: Number(first.longitude) }), delivery_location: JSON.stringify(order.delivery_location) });
      await tx.query('UPDATE orders SET version=version+1,updated_at=now() WHERE id=$1', [order.id]);
      await this.audit(tx, actor, 'shipment.created', 'shipment', id, undefined, [order.buyer_org_id, order.supplier_org_id, body.logisticsOrgId]); return map.shipment(await this.visibleShipment(actor, id, tx));
    });
  }
  async changeShipmentStatus(actor: Actor, id: string, body: any) {
    role(actor, 'logistics', 'admin');
    return this.db.transaction(async tx => {
      // Order locks precede shipment locks everywhere to prevent lock-order deadlocks.
      const initial = await this.visibleShipment(actor, id, tx), o = await this.visibleOrder(actor, initial.order_id, tx, true), r = await this.visibleShipment(actor, id, tx, true); version(r, body.expectedVersion);
      requireThat(!['cancelled', 'expired', 'completed'].includes(o.status), 409, 'ORDER_CLOSED', 'The underlying order is closed.');
      const transitions: Record<string, string> = { scheduled: 'picked_up', picked_up: 'in_transit', in_transit: 'delivered' };
      if (r.status === 'exception') requireThat(actor.role === 'admin' && body.reason && body.status === (o.status === 'in_transit' ? 'in_transit' : 'scheduled'), 403, 'EXCEPTION_REVIEW_REQUIRED', 'An administrator must review this exception and resume the actual custody stage.');
      else requireThat(actor.organizationId === r.logistics_org_id && (transitions[r.status] === body.status || body.status === 'exception' && r.status !== 'delivered'), 403, 'INVALID_TRANSITION', 'Only the assigned carrier may progress this shipment.');
      if (body.status === 'picked_up') {
        await this.verified(actor, tx); requireThat(o.status === 'ready_for_pickup' && o.payment_status === 'held', 409, 'PICKUP_NOT_READY', 'Pickup requires a ready order and held sandbox payment.');
        const items = (await tx.query('SELECT i.*,l.status listing_status,t.expires_at,t.cold_chain_status FROM order_items i JOIN listings l ON l.id=i.listing_id JOIN lots t ON t.id=i.lot_id WHERE i.order_id=$1 ORDER BY i.listing_id', [o.id])).rows as any[];
        requireThat(items.every(i => i.listing_status !== 'recalled' && Date.parse(i.expires_at) > Date.now() && !['excursion', 'unknown'].includes(i.cold_chain_status)), 409, 'LOT_HOLD', 'A lot is expired or recalled.');
        for (const i of items) await tx.query('UPDATE listings SET reserved_quantity=reserved_quantity-$1,version=version+1 WHERE id=$2', [i.quantity, i.listing_id]);
        await tx.query("UPDATE orders SET status='in_transit',version=version+1,updated_at=now() WHERE id=$1", [o.id]);
      }
      if (body.status === 'delivered') { requireThat(body.deliveryProof?.trim(), 422, 'PROOF_REQUIRED', 'Delivery requires proof or a recipient reference.'); await tx.query("UPDATE orders SET status='delivered',version=version+1,updated_at=now() WHERE id=$1", [o.id]); }
      if (body.status === 'exception') requireThat(body.reason, 422, 'REASON_REQUIRED', 'Describe the shipment exception.');
      await update(tx, 'shipments', id, { status: body.status, delivery_proof: body.deliveryProof ?? r.delivery_proof, version: r.version + 1 });
      await this.audit(tx, actor, 'shipment.status_changed', 'shipment', id, body.reason, [r.buyer_org_id, r.supplier_org_id, r.logistics_org_id], r.version + 1); return map.shipment(await this.visibleShipment(actor, id, tx));
    });
  }
  async temperatures(actor: Actor, id: string, query: any) { await this.visibleShipment(actor, id); return paginate((await this.db.query('SELECT * FROM temperature_readings WHERE shipment_id=$1 ORDER BY measured_at DESC', [id])).rows.map(map.reading), query); }
  async addTemperature(actor: Actor, id: string, body: any) {
    role(actor, 'logistics');
    const measured = Date.parse(body.measuredAt); requireThat(measured <= Date.now() + 60000 && measured >= Date.now() - 7 * 86400000, 422, 'INVALID_READING_TIME', 'Reading must be within the last seven days and not in the future.');
    return this.db.transaction(async tx => {
      const r = await this.visibleShipment(actor, id, tx, true); requireThat(r.logistics_org_id === actor.organizationId && r.status !== 'delivered', 403, 'FORBIDDEN', 'Only the assigned carrier may add readings before delivery.');
      const excursion = r.temperature_min_c !== null && body.temperatureC < Number(r.temperature_min_c) || r.temperature_max_c !== null && body.temperatureC > Number(r.temperature_max_c);
      const reading = await insert(tx, 'temperature_readings', { id: randomUUID(), shipment_id: id, measured_at: body.measuredAt, temperature_c: body.temperatureC, source: 'manual', device_id: body.deviceId ?? null, excursion });
      await update(tx, 'shipments', id, { latest_temperature_c: body.temperatureC, excursion_count: r.excursion_count + Number(excursion), status: excursion ? 'exception' : r.status, version: r.version + 1 });
      await this.audit(tx, actor, excursion ? 'shipment.temperature_excursion' : 'shipment.temperature_recorded', 'shipment', id, undefined, [r.buyer_org_id, r.supplier_org_id, r.logistics_org_id]); return map.reading(reading);
    });
  }
  async getPayment(actor: Actor, id: string, tx: Queryable = this.db) { role(actor, 'buyer', 'supplier', 'admin'); await this.visibleOrder(actor, id, tx); return map.payment(found(await one(tx, 'SELECT * FROM payments WHERE order_id=$1', [id]))); }
  async paymentAction(actor: Actor, id: string, body: any, key: string | undefined) {
    role(actor, 'buyer', 'admin'); requireThat(this.sandbox, 503, 'PAYMENTS_DISABLED', 'Live payments are not configured.');
    return this.idem(actor, 'paymentAction', key, { id, ...body }, async tx => {
      const order = await this.visibleOrder(actor, id, tx, true), p = found(await one(tx, 'SELECT * FROM payments WHERE order_id=$1 FOR UPDATE', [id]));
      if (body.action === 'hold') requireThat(actor.organizationId === order.buyer_org_id && ['confirmed', 'preparing', 'ready_for_pickup'].includes(order.status) && p.status === 'unpaid', 409, 'PAYMENT_CONFLICT', 'Only the buyer may fund a confirmed unpaid order.');
      if (body.action === 'release') requireThat(actor.organizationId === order.buyer_org_id && order.status === 'delivered' && p.status === 'held', 409, 'PAYMENT_CONFLICT', 'Only the buyer may release a delivered order with no active dispute.');
      if (body.action === 'refund') requireThat(actor.role === 'admin' && body.reason && p.status === 'held', 403, 'FORBIDDEN', 'An administrator and reason are required to refund held funds.');
      await this.ledger(tx, p, body.action); await this.audit(tx, actor, `payment.${body.action}`, 'payment', p.id, body.reason, [order.buyer_org_id, order.supplier_org_id]); return this.getPayment(actor, id, tx);
    });
  }
  async disputes(actor: Actor, query: any) {
    role(actor, 'buyer', 'supplier', 'admin'); const clause = actor.role === 'admin' ? '' : ' WHERE o.buyer_org_id=$1 OR o.supplier_org_id=$1';
    return paginate((await this.db.query(`SELECT d.* FROM disputes d JOIN orders o ON o.id=d.order_id${clause} ORDER BY d.created_at DESC`, clause ? [actor.organizationId] : [])).rows.map(map.dispute), query);
  }
  async createDispute(actor: Actor, body: any) {
    role(actor, 'buyer', 'supplier'); return this.db.transaction(async tx => {
      const o = await this.visibleOrder(actor, body.orderId, tx, true); requireThat(o.payment_status === 'held', 409, 'DISPUTE_UNAVAILABLE', 'A dispute requires held payment and no existing active dispute.');
      const d = await insert(tx, 'disputes', { id: randomUUID(), order_id: o.id, opened_by_org_id: actor.organizationId, reason: body.reason, description: body.description });
      await tx.query("UPDATE orders SET payment_status='disputed',version=version+1,updated_at=now() WHERE id=$1", [o.id]); await tx.query("UPDATE payments SET status='disputed' WHERE order_id=$1", [o.id]);
      await this.audit(tx, actor, 'dispute.opened', 'dispute', d.id, body.reason, [o.buyer_org_id, o.supplier_org_id]); return map.dispute(d);
    });
  }
  async resolveDispute(actor: Actor, id: string, body: any) {
    role(actor, 'admin'); return this.db.transaction(async tx => {
      const initial = found(await one(tx, 'SELECT * FROM disputes WHERE id=$1', [id])), o = await this.visibleOrder(actor, initial.order_id, tx, true), d = found(await one(tx, 'SELECT * FROM disputes WHERE id=$1 FOR UPDATE', [id]));
      requireThat(['open', 'under_review'].includes(d.status), 409, 'DISPUTE_RESOLVED', 'This dispute has already been resolved.');
      if (body.status !== 'under_review') {
        const p = found(await one(tx, 'SELECT * FROM payments WHERE order_id=$1 FOR UPDATE', [o.id])); requireThat(p.status === 'disputed', 409, 'PAYMENT_CONFLICT', 'Disputed funds are unavailable.');
        await this.ledger(tx, p, body.status === 'resolved_refund' ? 'refund' : 'release');
      }
      const row = await update(tx, 'disputes', id, { status: body.status, resolution: body.resolution, updated_at: new Date() }); await this.audit(tx, actor, 'dispute.resolved', 'dispute', id, body.resolution, [o.buyer_org_id, o.supplier_org_id]); return map.dispute(row);
    });
  }
  async agreements(actor: Actor, query: any) { role(actor, 'buyer', 'supplier', 'admin'); const clause = actor.role === 'admin' ? '' : ' WHERE buyer_org_id=$1 OR supplier_org_id=$1'; return paginate((await this.db.query(`SELECT * FROM agreements${clause} ORDER BY created_at DESC`, clause ? [actor.organizationId] : [])).rows.map(map.agreement), query); }
  async createAgreement(actor: Actor, body: any) {
    role(actor, 'buyer'); units(body.quantity); future(body.startsAt); requireThat(Date.parse(body.endsAt) > Date.parse(body.startsAt), 422, 'INVALID_DATES', 'Agreement end must follow its start.');
    return this.db.transaction(async tx => {
      const l = found(await one(tx, `${listingSql} WHERE l.id=$1`, [body.listingId])); this.eligible(l); requireThat(l.supplier_org_id === body.supplierOrgId && l.supplier_org_id !== actor.organizationId, 422, 'SUPPLIER_MISMATCH', 'Listing and supplier must match.');
      const r = await insert(tx, 'agreements', { id: randomUUID(), buyer_org_id: actor.organizationId, supplier_org_id: l.supplier_org_id, listing_id: l.id, title: body.title, quantity: body.quantity, unit: l.unit, price_per_unit_minor: l.price_per_unit_minor, cadence: body.cadence, starts_at: body.startsAt, ends_at: body.endsAt }); await this.audit(tx, actor, 'agreement.created', 'agreement', r.id, undefined, [actor.organizationId, l.supplier_org_id]); return map.agreement(r);
    });
  }
  async auditLog(actor: Actor, query: any) { role(actor, 'admin'); return paginate((await this.db.query('SELECT * FROM audit_events ORDER BY created_at DESC')).rows.map((r: any) => ({ id: r.id, actorUserId: r.actor_user_id, organizationId: r.organization_id, action: r.action, entityType: r.entity_type, entityId: r.entity_id, reason: r.reason, createdAt: iso(r.created_at) })), query); }
  async analytics(actor: Actor) {
    const listingScope = actor.role === 'supplier' ? ' WHERE l.supplier_org_id=$1' : actor.role === 'admin' ? '' : " WHERE l.status='active' AND o.verification_status='verified'";
    const listings = (await this.db.query(`${listingSql}${listingScope}`, actor.role === 'supplier' ? [actor.organizationId] : [])).rows as any[];
    const orderScope = actor.role === 'admin' ? '' : actor.role === 'supplier' ? ' WHERE o.supplier_org_id=$1' : actor.role === 'buyer' ? ' WHERE o.buyer_org_id=$1' : ' WHERE sh.logistics_org_id=$1';
    const orders = (await this.db.query(`${orderSql}${orderScope}`, actor.role === 'admin' ? [] : [actor.organizationId])).rows as any[];
    const shipments = (await this.shipments(actor, { pageSize: 100 })).data;
    const active = listings.filter(l => l.status === 'active' && Date.parse(l.expires_at) > Date.now());
    const alerts = active.filter(l => Date.parse(l.expires_at) < Date.now() + 3 * 86400000 && (actor.role === 'supplier' || actor.role === 'admin')).map(l => ({ id: `freshness-${l.id}`, severity: 'warning', title: `${l.title} expires soon`, description: `Lot ${l.lot_code} expires ${iso(l.expires_at).slice(0, 10)}. Review available stock.`, entityId: l.id }));
    for (const s of shipments.filter(s => s.status === 'exception')) alerts.push({ id: `cold-${s.id}`, severity: 'critical', title: 'Shipment needs review', description: `${s.orderNumber} has a logistics exception.`, entityId: s.id });
    const weekly: any[] = [];
    for (let i = 3; i >= 0; i--) {
      const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7) - i * 7);
      const start = new Date(end.getTime() - 7 * 86400000), inWeek = orders.filter(o => !['cancelled', 'expired'].includes(o.status) && Date.parse(o.created_at) >= start.getTime() && Date.parse(o.created_at) < end.getTime());
      let quantity = 0;
      for (const o of inWeek) quantity += Number((await one(this.db, "SELECT COALESCE(sum(quantity),0) quantity FROM order_items WHERE order_id=$1 AND unit='kg'", [o.id])).quantity);
      weekly.push({ week: iso(start).slice(0, 10), quantity: quantity.toFixed(3), unit: 'kg', orderValueMinor: actor.role === 'logistics' ? null : inWeek.reduce((sum, o) => sum + Number(o.total_minor), 0) });
    }
    const sampleWeeks = weekly.filter(w => Number(w.quantity) > 0).length;
    return { scope: actor.role, generatedAt: new Date().toISOString(), metrics: { activeListings: active.length, openOrders: orders.filter(o => !['completed', 'cancelled', 'expired'].includes(o.status)).length, grossOrderValueMinor: actor.role === 'logistics' ? null : orders.filter(o => !['cancelled', 'expired'].includes(o.status)).reduce((sum, o) => sum + Number(o.total_minor), 0), fulfilledOrders: orders.filter(o => ['delivered', 'completed'].includes(o.status)).length, pendingVerifications: actor.role === 'admin' ? Number((await one(this.db, "SELECT count(*) count FROM organizations WHERE verification_status='pending'")).count) : 0, coldChainExceptions: shipments.filter(s => s.status === 'exception').length }, weeklyVolume: weekly, categoryMix: ['produce', 'seafood'].map(category => ({ category, listingCount: active.filter(l => l.category === category).length })), priceTrends: [], alerts, forecast: { method: sampleWeeks >= 4 ? 'trailing_average' : 'insufficient_data', description: sampleWeeks >= 4 ? 'Mean ordered kilograms across four complete weeks; an estimate, not a guarantee.' : 'At least four complete weeks with recorded kilogram orders are needed.', nextWeekQuantityKg: sampleWeeks >= 4 ? (weekly.reduce((sum, w) => sum + Number(w.quantity), 0) / 4).toFixed(3) : null, sampleWeeks } };
  }
  async runMaintenance() {
    return this.db.transaction(async tx => {
      const expired = (await tx.query("SELECT * FROM orders WHERE status='pending_confirmation' AND reservation_expires_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED")).rows as any[];
      for (const o of expired) {
        await this.returnStock(tx, o.id); await tx.query("UPDATE orders SET status='expired',reservation_expires_at=NULL,version=version+1,updated_at=now() WHERE id=$1", [o.id]);
        await insert(tx, 'audit_events', { id: randomUUID(), actor_user_id: null, organization_id: o.buyer_org_id, action: 'order.expired', entity_type: 'order', entity_id: o.id, reason: 'Unconfirmed reservation timed out after 30 minutes.' });
        for (const org of [o.buyer_org_id, o.supplier_org_id]) await insert(tx, 'outbox_events', { id: randomUUID(), event_type: 'order.status_changed', organization_id: org, aggregate_type: 'order', aggregate_id: o.id, aggregate_version: o.version + 1, correlation_id: randomUUID(), payload: JSON.stringify({ orderId: o.id, status: 'expired' }) });
      }
      await tx.query("UPDATE rfqs SET status='expired' WHERE status='open' AND delivery_by<=now()");
      await tx.query("UPDATE quotes SET status='expired' WHERE status='submitted' AND valid_until<=now()");
      return { expiredOrders: expired.length };
    });
  }
}
