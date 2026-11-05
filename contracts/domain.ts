/** HarvestLink MVP contract, version 1.0.3. Monetary values are integer PHP centavos.
 * Quantities are positive decimal strings with at most three fractional digits.
 * UUIDs identify records; UTC ISO-8601 strings identify instants. No Date objects on the wire.
 */
export type UUID = string;
export type DateTime = string;
export type Quantity = string;
export type Currency = 'PHP';
export type Role = 'supplier' | 'buyer' | 'logistics' | 'admin';
export type Category = 'produce' | 'seafood';
export type Unit = 'kg' | 'crate';
export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'suspended';
export type ColdChainStatus = 'ambient' | 'chilled' | 'frozen' | 'excursion' | 'unknown';
export type ListingStatus = 'draft' | 'active' | 'paused' | 'sold_out' | 'recalled';
export type OrderStatus = 'pending_confirmation' | 'confirmed' | 'preparing' | 'ready_for_pickup' | 'in_transit' | 'delivered' | 'completed' | 'cancelled' | 'expired';
export type ShipmentStatus = 'scheduled' | 'picked_up' | 'in_transit' | 'delivered' | 'exception';
export type PaymentStatus = 'unpaid' | 'held' | 'released' | 'refunded' | 'disputed';
export type DisputeStatus = 'open' | 'under_review' | 'resolved_refund' | 'resolved_release';
export interface ApiResponse<T> { data: T }
export interface PageMeta { page: number; pageSize: number; total: number }
export interface Page<T> { data: T[]; meta: PageMeta }
export interface ApiError { error: { code: string; message: string; requestId: string; details?: Record<string, string[]> } }
export interface Location { label: string; latitude: number; longitude: number }
export interface Certificate { id: UUID; name: string; reference: string; expiresAt: DateTime | null; documentUrl: string | null }
export interface Organization {
  id: UUID; name: string; role: Role; verificationStatus: VerificationStatus;
  contactName: string; email: string; phone: string; location: Location;
  licenseNumber: string | null; certificates: Certificate[]; description: string;
  createdAt: DateTime; version: number;
}
/** Public directory card. Never expose private documents, licensing references, or account email here. */
export interface Partner { id: UUID; name: string; role: Role; verificationStatus: VerificationStatus; location: Location }
export interface User { id: UUID; email: string; name: string; role: Role; organizationId: UUID }
/** Access token returned here; refresh token only in an HttpOnly Secure SameSite cookie. */
export interface Session { user: User; organization: Organization; accessToken: string; expiresIn: number }
export interface LoginRequest { email: string; password: string }
export interface RegisterRequest {
  email: string; password: string; name: string; organizationName: string;
  role: 'supplier' | 'buyer' | 'logistics'; phone: string; location: Location;
  licenseNumber?: string;
}
export interface UpdateOrganizationRequest {
  expectedVersion: number; name?: string; contactName?: string; phone?: string;
  location?: Location; licenseNumber?: string; description?: string; certificates?: Certificate[];
}
export interface VerifyOrganizationRequest { expectedVersion: number; status: VerificationStatus; reason: string }
export interface Lot {
  id: UUID; code: string; harvestedAt: DateTime; expiresAt: DateTime;
  origin: Location; catchMethod: string; coldChainStatus: ColdChainStatus;
  storageMinC: number | null; storageMaxC: number | null;
  sourceType: 'farm' | 'vessel'; sourceName: string;
  evidenceType: 'supplier_declared' | 'sensor_verified';
}
/** Public listing locations (including lot.origin) are rounded to one decimal degree.
 * Full origins are stored privately; precise pickup coordinates are participant-only shipment data.
 */
export interface Listing {
  id: UUID; supplierOrgId: UUID; supplierName: string; title: string; description: string;
  category: Category; unit: Unit; pricePerUnitMinor: number; currency: Currency;
  availableQuantity: Quantity; reservedQuantity: Quantity; minOrderQuantity: Quantity;
  location: Location; imageUrl: string | null; lot: Lot; status: ListingStatus;
  createdAt: DateTime; version: number;
}
export interface CreateListingRequest {
  title: string; description: string; category: Category; unit: Unit;
  pricePerUnitMinor: number; currency: Currency; quantity: Quantity; minOrderQuantity: Quantity;
  location: Location; imageUrl?: string | null; status: 'draft' | 'active';
  lot: Omit<Lot, 'id' | 'evidenceType'>;
}
/** Inventory corrections use quantityDelta with an audit reason; committed stock cannot be removed. */
export interface UpdateListingRequest {
  expectedVersion: number; title?: string; description?: string; pricePerUnitMinor?: number;
  minOrderQuantity?: Quantity; status?: ListingStatus; quantityDelta?: string; reason?: string;
}
export interface CreateRfqRequest {
  title: string; category: Category; quantity: Quantity; unit: Unit;
  targetPricePerUnitMinor: number | null; deliveryBy: DateTime; deliveryLocation: Location; notes: string;
}
export interface Quote {
  id: UUID; rfqId: UUID; listingId: UUID; supplierOrgId: UUID; supplierName: string;
  quantity: Quantity; unit: Unit; pricePerUnitMinor: number; currency: Currency;
  validUntil: DateTime; notes: string; status: 'submitted' | 'accepted' | 'rejected' | 'expired'; createdAt: DateTime;
}
export interface Rfq extends CreateRfqRequest {
  id: UUID; buyerOrgId: UUID; buyerName: string; status: 'open' | 'awarded' | 'closed' | 'expired';
  quotes: Quote[]; createdAt: DateTime;
}
export interface CreateQuoteRequest {
  listingId: UUID; quantity: Quantity; pricePerUnitMinor: number; validUntil: DateTime; notes: string;
}
export interface OrderItem {
  id: UUID; listingId: UUID; lotId: UUID; lotCode: string; title: string;
  quantity: Quantity; unit: Unit; pricePerUnitMinor: number; lineTotalMinor: number;
  lotSnapshot: Lot;
}
export interface Order {
  id: UUID; orderNumber: string; buyerOrgId: UUID; buyerName: string;
  supplierOrgId: UUID; supplierName: string; items: OrderItem[];
  status: OrderStatus; paymentStatus: PaymentStatus; currency: Currency;
  subtotalMinor: number; deliveryFeeMinor: number; totalMinor: number;
  deliveryLocation: Location; deliveryBy: DateTime; notes: string;
  reservationExpiresAt: DateTime | null; quoteId: UUID | null;
  shipmentId: UUID | null; createdAt: DateTime; updatedAt: DateTime; version: number;
}
export interface CreateOrderRequest {
  items: Array<{ listingId: UUID; quantity: Quantity; expectedUnitPriceMinor: number }>;
  deliveryLocation: Location; deliveryBy: DateTime; notes: string;
}
export interface ChangeOrderStatusRequest { expectedVersion: number; status: OrderStatus; reason?: string }
export interface CreateShipmentRequest {
  orderId: UUID; logisticsOrgId: UUID; pickupAt: DateTime; expectedDeliveryAt: DateTime;
  vehicleReference: string; temperatureMinC: number | null; temperatureMaxC: number | null;
}
export interface TemperatureReading {
  id: UUID; shipmentId: UUID; measuredAt: DateTime; receivedAt: DateTime;
  temperatureC: number; source: 'manual' | 'sensor'; deviceId: string | null; excursion: boolean;
}
export interface Shipment extends CreateShipmentRequest {
  id: UUID; orderNumber: string; supplierOrgId: UUID; buyerOrgId: UUID;
  logisticsName: string; pickupLocation: Location; deliveryLocation: Location;
  status: ShipmentStatus; latestTemperatureC: number | null; excursionCount: number;
  deliveryProof: string | null; createdAt: DateTime; version: number;
}
export interface ChangeShipmentStatusRequest { expectedVersion: number; status: ShipmentStatus; deliveryProof?: string; reason?: string }
export interface CreateTemperatureReadingRequest { measuredAt: DateTime; temperatureC: number; source: 'manual'; deviceId?: string }
export interface Payment {
  id: UUID; orderId: UUID; invoiceNumber: string; amountMinor: number; currency: Currency;
  status: PaymentStatus; provider: 'sandbox'; providerReference: string | null;
  heldAt: DateTime | null; releasedAt: DateTime | null; refundedAt: DateTime | null; createdAt: DateTime;
}
export interface PaymentActionRequest { action: 'hold' | 'release' | 'refund'; reason?: string }
export interface Dispute {
  id: UUID; orderId: UUID; openedByOrgId: UUID; reason: string; description: string;
  status: DisputeStatus; resolution: string | null; createdAt: DateTime; updatedAt: DateTime;
}
export interface CreateDisputeRequest { orderId: UUID; reason: string; description: string }
export interface ResolveDisputeRequest { status: 'under_review' | 'resolved_refund' | 'resolved_release'; resolution: string }
/** MVP agreement records are scheduling intent; no claim of electronic legal execution. */
export interface Agreement {
  id: UUID; buyerOrgId: UUID; supplierOrgId: UUID; listingId: UUID; title: string;
  quantity: Quantity; unit: Unit; pricePerUnitMinor: number; currency: Currency;
  cadence: 'weekly' | 'fortnightly' | 'monthly'; startsAt: DateTime; endsAt: DateTime;
  status: 'draft' | 'active' | 'paused' | 'ended'; nextDeliveryAt: DateTime | null; createdAt: DateTime;
}
export interface CreateAgreementRequest {
  supplierOrgId: UUID; listingId: UUID; title: string; quantity: Quantity;
  cadence: Agreement['cadence']; startsAt: DateTime; endsAt: DateTime;
}
export interface Analytics {
  scope: Role; generatedAt: DateTime;
  metrics: { activeListings: number; openOrders: number; grossOrderValueMinor: number | null; fulfilledOrders: number; pendingVerifications: number; coldChainExceptions: number };
  weeklyVolume: Array<{ week: string; quantity: Quantity; unit: 'kg'; orderValueMinor: number | null }>;
  categoryMix: Array<{ category: Category; listingCount: number }>;
  priceTrends: Array<{ date: string; category: Category; averagePricePerKgMinor: number }>;
  alerts: Array<{ id: string; severity: 'info' | 'warning' | 'critical'; title: string; description: string; entityId: UUID | null }>;
  forecast: { method: 'insufficient_data' | 'trailing_average'; description: string; nextWeekQuantityKg: Quantity | null; sampleWeeks: number };
}
export interface AuditEvent { id: UUID; actorUserId: UUID | null; organizationId: UUID; action: string; entityType: string; entityId: UUID; reason: string | null; createdAt: DateTime }
export interface Health { status: 'ok' | 'degraded'; version: string; checks: { database: boolean; redis: boolean } }
export const API_BASE = '/api/v1';
export const DEMO_IDS = {
  supplierOrg: '10000000-0000-4000-8000-000000000001',
  fisherOrg: '10000000-0000-4000-8000-000000000002',
  buyerOrg: '10000000-0000-4000-8000-000000000003',
  logisticsOrg: '10000000-0000-4000-8000-000000000004',
  adminOrg: '10000000-0000-4000-8000-000000000005',
  supplierUser: '20000000-0000-4000-8000-000000000001',
  fisherUser: '20000000-0000-4000-8000-000000000002',
  buyerUser: '20000000-0000-4000-8000-000000000003',
  logisticsUser: '20000000-0000-4000-8000-000000000004',
  adminUser: '20000000-0000-4000-8000-000000000005',
  tomatoListing: '30000000-0000-4000-8000-000000000001',
  tunaListing: '30000000-0000-4000-8000-000000000002',
  riceListing: '30000000-0000-4000-8000-000000000003',
  lettuceListing: '30000000-0000-4000-8000-000000000004',
  shrimpListing: '30000000-0000-4000-8000-000000000005',
  mangoListing: '30000000-0000-4000-8000-000000000006',
} as const;
