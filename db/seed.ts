import { randomBytes, scryptSync } from 'node:crypto';
import type { Database, Queryable } from '../apps/api/src/database.js';
import { DEMO_IDS } from '../contracts/domain.js';

export function hashDemoPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$${salt}$${hash.toString('hex')}`;
}
const id = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function insert(tx: Queryable, table: string, values: Record<string, unknown>) {
  const columns = Object.keys(values);
  await tx.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
}
export interface SeedOptions { passwordHash: string; now?: Date }

/** Explicit demo fixtures only. Re-running never overwrites operational records. */
export async function seedDatabase(database: Database, options: SeedOptions): Promise<{ seeded: boolean }> {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seeding is prohibited in production');
  if (!options.passwordHash) throw new Error('Demo seed requires a password hash');
  const now = options.now ?? new Date();
  const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
  const locations = {
    farm: { label: 'Benguet, Cordillera', latitude: 16.452, longitude: 120.591 },
    fisher: { label: 'General Santos, South Cotabato', latitude: 6.116, longitude: 125.171 },
    buyer: { label: 'Quezon City, Metro Manila', latitude: 14.651, longitude: 121.049 },
    logistics: { label: 'Pasig, Metro Manila', latitude: 14.577, longitude: 121.085 },
    admin: { label: 'Makati, Metro Manila', latitude: 14.554, longitude: 121.024 },
  };
  return database.transaction(async tx => {
    if ((await tx.query('SELECT id FROM organizations WHERE id=$1', [DEMO_IDS.adminOrg])).rowCount) return { seeded: false };
    const orgs = [
      { id: DEMO_IDS.supplierOrg, user: DEMO_IDS.supplierUser, name: 'Cordillera Growers Cooperative', contact: 'Maria Santos', email: 'supplier@harvestlink.demo', role: 'supplier', location: locations.farm, license: 'DEMO-FARM-2026-001', description: 'A community of Benguet growers bringing fresh highland produce to your kitchen.' },
      { id: DEMO_IDS.fisherOrg, user: DEMO_IDS.fisherUser, name: 'South Sea Fishing Collective', contact: 'Andres Reyes', email: 'fisher@harvestlink.demo', role: 'supplier', location: locations.fisher, license: 'DEMO-FISH-2026-002', description: 'Responsibly landed seafood with catch records and documented cold-chain handling.' },
      { id: DEMO_IDS.buyerOrg, user: DEMO_IDS.buyerUser, name: 'Fresh Table Restaurant Group', contact: 'Alex Rivera', email: 'buyer@harvestlink.demo', role: 'buyer', location: locations.buyer, license: 'DEMO-BUYER-2026-003', description: 'Fresh seasonal ingredients for restaurants across Metro Manila.' },
      { id: DEMO_IDS.logisticsOrg, user: DEMO_IDS.logisticsUser, name: 'CoolMove Logistics', contact: 'Jose Dela Cruz', email: 'logistics@harvestlink.demo', role: 'logistics', location: locations.logistics, license: 'DEMO-CARRIER-2026-004', description: 'Scheduled refrigerated transport connecting farms, ports, and buyers.' },
      { id: DEMO_IDS.adminOrg, user: DEMO_IDS.adminUser, name: 'HarvestLink Operations', contact: 'Platform Administrator', email: 'admin@harvestlink.demo', role: 'admin', location: locations.admin, license: null, description: 'Marketplace verification and operations team.' },
    ];
    for (const org of orgs) {
      await insert(tx, 'organizations', { id: org.id, name: org.name, role: org.role, verification_status: 'verified', contact_name: org.contact, email: org.email, phone: '+63 900 000 0000', location_label: org.location.label, latitude: org.location.latitude, longitude: org.location.longitude, license_number: org.license, description: org.description, created_at: at(-60) });
      await insert(tx, 'users', { id: org.user, organization_id: org.id, email: org.email, name: org.contact, role: org.role, password_hash: options.passwordHash, created_at: at(-60) });
    }
    await insert(tx, 'organizations', { id: id('1', 6), name: 'Laguna Family Farms', role: 'supplier', verification_status: 'pending', contact_name: 'Elena Cruz', email: 'laguna@harvestlink.demo', phone: '+63 900 000 0000', location_label: 'Calamba, Laguna', latitude: 14.211, longitude: 121.166, license_number: 'DEMO-PENDING-006', description: 'New supplier awaiting document review.', created_at: at(-1) });
    await insert(tx, 'organization_certificates', { id: id('9', 1), organization_id: DEMO_IDS.supplierOrg, name: 'Demo good agricultural practice record', reference: 'DEMO-GAP-001', expires_at: at(180), document_url: null });
    const catalog = [
      { id: DEMO_IDS.tomatoListing, title: 'Vine-ripened tomatoes', description: 'Firm, bright tomatoes picked at peak ripeness. Sorted and packed for wholesale kitchens.', category: 'produce', price: 8500, quantity: '850.000', reserved: '150.000', minimum: '25.000', harvest: -0.25, expiry: 5, chain: 'ambient', min: 10, max: 20, catch: 'Not applicable — hand harvested', source: 'Cordillera Farm Block A', org: orgs[0]! },
      { id: DEMO_IDS.tunaListing, title: 'Yellowfin tuna', description: 'Line-caught yellowfin, iced at landing and prepared for refrigerated collection.', category: 'seafood', price: 32000, quantity: '320.000', reserved: '0.000', minimum: '20.000', harvest: -0.2, expiry: 2, chain: 'chilled', min: 0, max: 4, catch: 'Handline', source: 'FV South Sea One', org: orgs[1]! },
      { id: DEMO_IDS.riceListing, title: 'Premium jasmine rice', description: 'Fresh-milled aromatic rice with consistent grain quality and documented harvest origin.', category: 'produce', price: 6200, quantity: '2400.000', reserved: '0.000', minimum: '50.000', harvest: -7, expiry: 90, chain: 'ambient', min: 15, max: 30, catch: 'Not applicable — field harvested', source: 'Cordillera Rice Cooperative', org: orgs[0]! },
      { id: DEMO_IDS.lettuceListing, title: 'Crisp romaine lettuce', description: 'Tender, clean heads from cool mountain fields, packed for same-day dispatch.', category: 'produce', price: 14000, quantity: '175.000', reserved: '25.000', minimum: '10.000', harvest: -0.1, expiry: 4, chain: 'chilled', min: 0, max: 5, catch: 'Not applicable — hand harvested', source: 'Cordillera Farm Block B', org: orgs[0]! },
      { id: DEMO_IDS.shrimpListing, title: 'Fresh whiteleg shrimp', description: 'Carefully graded shrimp, chilled immediately after harvest for reliable freshness.', category: 'seafood', price: 28000, quantity: '180.000', reserved: '0.000', minimum: '15.000', harvest: -0.15, expiry: 2, chain: 'chilled', min: 0, max: 4, catch: 'Aquaculture pond harvest', source: 'South Sea Coastal Pond 3', org: orgs[1]! },
      { id: DEMO_IDS.mangoListing, title: 'Golden carabao mangoes', description: 'Sweet Philippine mangoes, hand-selected and packed for wholesale delivery.', category: 'produce', price: 12000, quantity: '650.000', reserved: '0.000', minimum: '25.000', harvest: -0.4, expiry: 6, chain: 'ambient', min: 10, max: 18, catch: 'Not applicable — hand harvested', source: 'Cordillera Partner Orchard', org: orgs[0]! },
    ];
    const snapshots = new Map<string, Record<string, unknown>>();
    for (const [index, item] of catalog.entries()) {
      const lotId = id('4', index + 1), code = `DEMO-${item.category === 'seafood' ? 'CATCH' : 'HARVEST'}-${String(index + 1).padStart(3, '0')}`;
      const lot = { id: lotId, code, harvestedAt: at(item.harvest), expiresAt: at(item.expiry), origin: item.org.location, catchMethod: item.category === 'produce' ? 'not_applicable' : item.catch, coldChainStatus: item.chain, storageMinC: item.min, storageMaxC: item.max, sourceType: item.category === 'seafood' && item.id !== DEMO_IDS.shrimpListing ? 'vessel' : 'farm', sourceName: item.source, evidenceType: 'supplier_declared' };
      snapshots.set(item.id, lot);
      await insert(tx, 'lots', { id: lotId, supplier_org_id: item.org.id, code, harvested_at: lot.harvestedAt, expires_at: lot.expiresAt, origin_label: item.org.location.label, origin_latitude: item.org.location.latitude, origin_longitude: item.org.location.longitude, catch_method: lot.catchMethod, cold_chain_status: item.chain, storage_min_c: item.min, storage_max_c: item.max, source_type: lot.sourceType, source_name: item.source, evidence_type: 'supplier_declared' });
      await insert(tx, 'listings', { id: item.id, supplier_org_id: item.org.id, lot_id: lotId, title: item.title, description: item.description, category: item.category, unit: 'kg', price_per_unit_minor: item.price, available_quantity: item.quantity, reserved_quantity: item.reserved, min_order_quantity: item.minimum, location_label: item.org.location.label, latitude: item.org.location.latitude, longitude: item.org.location.longitude, image_url: null, status: 'active', created_at: at(-2 + index / 10) });
    }
    const seedOrders = [
      { n: 1, item: catalog[1]!, quantity: 80, status: 'in_transit', payment: 'held', days: -0.5 },
      { n: 2, item: catalog[0]!, quantity: 150, status: 'confirmed', payment: 'held', days: -0.25 },
      { n: 3, item: catalog[3]!, quantity: 25, status: 'pending_confirmation', payment: 'unpaid', days: -0.05 },
      { n: 4, item: catalog[2]!, quantity: 500, status: 'completed', payment: 'released', days: -1 },
    ];
    for (const order of seedOrders) {
      const orderId = id('5', order.n), paymentId = id('7', order.n), total = order.quantity * order.item.price, snapshot = snapshots.get(order.item.id)!;
      await insert(tx, 'orders', { id: orderId, order_number: `HL-DEMO-${1000 + order.n}`, buyer_org_id: DEMO_IDS.buyerOrg, supplier_org_id: order.item.org.id, status: order.status, payment_status: order.payment, subtotal_minor: total, delivery_fee_minor: 0, total_minor: total, delivery_location: JSON.stringify(locations.buyer), delivery_by: at(order.status === 'completed' ? -0.1 : 1), notes: 'Seeded demonstration order. No real funds or delivery.', reservation_expires_at: order.status === 'pending_confirmation' ? at(0.95) : null, created_at: at(order.days), updated_at: at(order.days) });
      await insert(tx, 'order_items', { id: id('6', order.n), order_id: orderId, listing_id: order.item.id, lot_id: snapshot.id, lot_code: snapshot.code, title: order.item.title, quantity: `${order.quantity}.000`, unit: 'kg', price_per_unit_minor: order.item.price, line_total_minor: total, lot_snapshot: JSON.stringify(snapshot) });
      await insert(tx, 'payments', { id: paymentId, order_id: orderId, invoice_number: `INV-DEMO-${1000 + order.n}`, amount_minor: total, status: order.payment, provider: 'sandbox', provider_reference: order.payment === 'unpaid' ? null : `demo_${order.n}`, held_at: order.payment !== 'unpaid' ? at(order.days) : null, released_at: order.payment === 'released' ? at(-0.05) : null, created_at: at(order.days) });
      if (order.payment !== 'unpaid') {
        for (const [account, amount] of [['buyer_cash', -total], ['escrow_liability', total]] as const) await insert(tx, 'ledger_entries', { id: id('a', order.n * 10 + (amount > 0 ? 1 : 2)), transaction_id: id('b', order.n), payment_id: paymentId, account, amount_minor: amount, action: 'hold', created_at: at(order.days) });
        if (order.payment === 'released') for (const [account, amount] of [['escrow_liability', -total], ['supplier_payable', total]] as const) await insert(tx, 'ledger_entries', { id: id('a', order.n * 10 + (amount > 0 ? 3 : 4)), transaction_id: id('b', order.n + 10), payment_id: paymentId, account, amount_minor: amount, action: 'release', created_at: at(-0.05) });
      }
      await insert(tx, 'audit_events', { id: id('c', order.n), actor_user_id: DEMO_IDS.buyerUser, organization_id: DEMO_IDS.buyerOrg, action: 'demo.order.seeded', entity_type: 'order', entity_id: orderId, reason: 'Synthetic demonstration data', created_at: at(order.days) });
    }
    const shipmentId = id('8', 1);
    await insert(tx, 'shipments', { id: shipmentId, order_id: id('5', 1), logistics_org_id: DEMO_IDS.logisticsOrg, pickup_at: at(-0.1), expected_delivery_at: at(0.3), vehicle_reference: 'DEMO-REF-014', temperature_min_c: 0, temperature_max_c: 4, pickup_location: JSON.stringify(locations.fisher), delivery_location: JSON.stringify(locations.buyer), status: 'in_transit', latest_temperature_c: 2.7, excursion_count: 0, created_at: at(-0.2) });
    for (let n = 1; n <= 6; n++) await insert(tx, 'temperature_readings', { id: id('d', n), shipment_id: shipmentId, measured_at: at(-0.1 + n / 100), temperature_c: 2.1 + n / 10, source: 'manual', device_id: 'demo-handheld', excursion: false });
    await insert(tx, 'rfqs', { id: id('e', 1), buyer_org_id: DEMO_IDS.buyerOrg, title: 'Weekly highland vegetables', category: 'produce', quantity: '250.000', unit: 'kg', target_price_per_unit_minor: 8000, delivery_by: at(4), delivery_location: JSON.stringify(locations.buyer), notes: 'Looking for consistent quality and weekly delivery.', status: 'open', created_at: at(-0.2) });
    await insert(tx, 'quotes', { id: id('f', 1), rfq_id: id('e', 1), listing_id: DEMO_IDS.tomatoListing, supplier_org_id: DEMO_IDS.supplierOrg, quantity: '250.000', unit: 'kg', price_per_unit_minor: 8000, valid_until: at(1), notes: 'Fresh harvest available with consolidated pickup.', status: 'submitted', created_at: at(-0.1) });
    await insert(tx, 'agreements', { id: id('9', 10), buyer_org_id: DEMO_IDS.buyerOrg, supplier_org_id: DEMO_IDS.supplierOrg, listing_id: DEMO_IDS.riceListing, title: 'Restaurant rice supply', quantity: '250.000', unit: 'kg', price_per_unit_minor: 6200, cadence: 'weekly', starts_at: at(2), ends_at: at(60), status: 'draft', next_delivery_at: at(2) });
    return { seeded: true };
  });
}
