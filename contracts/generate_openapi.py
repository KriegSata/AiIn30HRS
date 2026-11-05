"""Generate the OpenAPI contract as JSON-compatible YAML using only Python's stdlib."""
import json
from pathlib import Path

def ref(name): return {'$ref': '#/components/schemas/' + name}
def arr(items): return {'type': 'array', 'items': items}
def string(**kw): return {'type': 'string', **kw}
def enum(*values): return string(enum=list(values))
def integer(minimum=0, maximum=100_000_000_000_000): return {'type': 'integer', 'minimum': minimum, 'maximum': maximum}
def number(**kw): return {'type': 'number', **kw}
def nullable(schema): return {**schema, 'nullable': True} if '$ref' not in schema else {'allOf': [schema], 'nullable': True}
def obj(properties, optional=(), **kw):
    return {'type': 'object', 'additionalProperties': False, 'required': [k for k in properties if k not in optional], 'properties': properties, **kw}
def data(schema): return obj({'data': schema})
def page(name): return obj({'data': arr(ref(name)), 'meta': ref('PageMeta')})
uuid = string(format='uuid')
dt = string(format='date-time')
text = string(maxLength=2000)
short = string(minLength=1, maxLength=160)
qty = string(pattern=r'^(0|[1-9][0-9]{0,6})(\.[0-9]{1,3})?$', description='Decimal string. Requests: > 0 and <= 1000000.000, at most 3 fractional digits. Responses can be zero.', example='125.500')
price = integer(1, 10_000_000)
version = integer(1, 2_147_483_647)
currency = enum('PHP')
role = enum('supplier', 'buyer', 'logistics', 'admin')
category = enum('produce', 'seafood')
unit = enum('kg', 'crate')
verification = enum('pending', 'verified', 'rejected', 'suspended')
cold = enum('ambient', 'chilled', 'frozen', 'excursion', 'unknown')
listing_status = enum('draft', 'active', 'paused', 'sold_out', 'recalled')
order_status = enum('pending_confirmation', 'confirmed', 'preparing', 'ready_for_pickup', 'in_transit', 'delivered', 'completed', 'cancelled', 'expired')
shipment_status = enum('scheduled', 'picked_up', 'in_transit', 'delivered', 'exception')
payment_status = enum('unpaid', 'held', 'released', 'refunded', 'disputed')
S = {}
S['Location'] = obj({'label': short, 'latitude': number(minimum=-90, maximum=90), 'longitude': number(minimum=-180, maximum=180)})
S['PageMeta'] = obj({'page': integer(1, 1_000_000), 'pageSize': integer(1, 100), 'total': integer()})
S['ApiError'] = obj({'error': obj({'code': short, 'message': text, 'requestId': string(), 'details': {'type': 'object', 'additionalProperties': arr(string())}}, optional=('details',))})
S['Certificate'] = obj({'id': uuid, 'name': short, 'reference': short, 'expiresAt': nullable(dt), 'documentUrl': nullable(string(format='uri', maxLength=2048))})
S['Organization'] = obj({'id': uuid, 'name': short, 'role': role, 'verificationStatus': verification, 'contactName': short, 'email': string(format='email'), 'phone': string(maxLength=40), 'location': ref('Location'), 'licenseNumber': nullable(short), 'certificates': arr(ref('Certificate')), 'description': text, 'createdAt': dt, 'version': version})
S['Partner'] = obj({'id': uuid, 'name': short, 'role': role, 'verificationStatus': verification, 'location': ref('Location')})
S['User'] = obj({'id': uuid, 'email': string(format='email'), 'name': short, 'role': role, 'organizationId': uuid})
S['Session'] = obj({'user': ref('User'), 'organization': ref('Organization'), 'accessToken': string(), 'expiresIn': integer(1, 900)})
S['LoginRequest'] = obj({'email': string(format='email', maxLength=254), 'password': string(minLength=1, maxLength=128)})
S['RegisterRequest'] = obj({'email': string(format='email', maxLength=254), 'password': string(minLength=12, maxLength=128), 'name': short, 'organizationName': short, 'role': enum('supplier', 'buyer', 'logistics'), 'phone': string(minLength=5, maxLength=40), 'location': ref('Location'), 'licenseNumber': short}, optional=('licenseNumber',))
S['UpdateOrganizationRequest'] = obj({'expectedVersion': version, 'name': short, 'contactName': short, 'phone': string(maxLength=40), 'location': ref('Location'), 'licenseNumber': short, 'description': text, 'certificates': arr(ref('Certificate'))}, optional=('name', 'contactName', 'phone', 'location', 'licenseNumber', 'description', 'certificates'))
S['VerifyOrganizationRequest'] = obj({'expectedVersion': version, 'status': verification, 'reason': string(minLength=5, maxLength=2000)})
lot_fields = {'id': uuid, 'code': string(minLength=1, maxLength=80), 'harvestedAt': dt, 'expiresAt': dt, 'origin': ref('Location'), 'catchMethod': string(minLength=1, maxLength=160), 'coldChainStatus': cold, 'storageMinC': nullable(number(minimum=-80, maximum=60)), 'storageMaxC': nullable(number(minimum=-80, maximum=60)), 'sourceType': enum('farm', 'vessel'), 'sourceName': short, 'evidenceType': enum('supplier_declared', 'sensor_verified')}
S['Lot'] = obj(lot_fields)
S['CreateLot'] = obj({k: v for k, v in lot_fields.items() if k not in ('id', 'evidenceType')})
S['Listing'] = obj({'id': uuid, 'supplierOrgId': uuid, 'supplierName': short, 'title': short, 'description': text, 'category': category, 'unit': unit, 'pricePerUnitMinor': price, 'currency': currency, 'availableQuantity': qty, 'reservedQuantity': qty, 'minOrderQuantity': qty, 'location': ref('Location'), 'imageUrl': nullable(string(format='uri')), 'lot': ref('Lot'), 'status': listing_status, 'createdAt': dt, 'version': version})
S['CreateListingRequest'] = obj({'title': short, 'description': text, 'category': category, 'unit': unit, 'pricePerUnitMinor': price, 'currency': currency, 'quantity': qty, 'minOrderQuantity': qty, 'location': ref('Location'), 'imageUrl': nullable(string(format='uri', maxLength=2048)), 'status': enum('draft', 'active'), 'lot': ref('CreateLot')}, optional=('imageUrl',))
S['UpdateListingRequest'] = obj({'expectedVersion': version, 'title': short, 'description': text, 'pricePerUnitMinor': price, 'minOrderQuantity': qty, 'status': listing_status, 'quantityDelta': string(pattern=r'^-?(0|[1-9][0-9]{0,6})(\.[0-9]{1,3})?$'), 'reason': text}, optional=('title', 'description', 'pricePerUnitMinor', 'minOrderQuantity', 'status', 'quantityDelta', 'reason'))
rfq_fields = {'title': short, 'category': category, 'quantity': qty, 'unit': unit, 'targetPricePerUnitMinor': nullable(price), 'deliveryBy': dt, 'deliveryLocation': ref('Location'), 'notes': text}
S['CreateRfqRequest'] = obj(rfq_fields)
S['CreateQuoteRequest'] = obj({'listingId': uuid, 'quantity': qty, 'pricePerUnitMinor': price, 'validUntil': dt, 'notes': text})
S['Quote'] = obj({'id': uuid, 'rfqId': uuid, 'listingId': uuid, 'supplierOrgId': uuid, 'supplierName': short, 'quantity': qty, 'unit': unit, 'pricePerUnitMinor': price, 'currency': currency, 'validUntil': dt, 'notes': text, 'status': enum('submitted', 'accepted', 'rejected', 'expired'), 'createdAt': dt})
S['Rfq'] = obj({**rfq_fields, 'id': uuid, 'buyerOrgId': uuid, 'buyerName': short, 'status': enum('open', 'awarded', 'closed', 'expired'), 'quotes': arr(ref('Quote')), 'createdAt': dt})
S['OrderItem'] = obj({'id': uuid, 'listingId': uuid, 'lotId': uuid, 'lotCode': short, 'title': short, 'quantity': qty, 'unit': unit, 'pricePerUnitMinor': price, 'lineTotalMinor': integer(), 'lotSnapshot': ref('Lot')})
S['Order'] = obj({'id': uuid, 'orderNumber': short, 'buyerOrgId': uuid, 'buyerName': short, 'supplierOrgId': uuid, 'supplierName': short, 'items': {**arr(ref('OrderItem')), 'minItems': 1, 'maxItems': 50}, 'status': order_status, 'paymentStatus': payment_status, 'currency': currency, 'subtotalMinor': integer(), 'deliveryFeeMinor': integer(), 'totalMinor': integer(), 'deliveryLocation': ref('Location'), 'deliveryBy': dt, 'notes': text, 'reservationExpiresAt': nullable(dt), 'quoteId': nullable(uuid), 'shipmentId': nullable(uuid), 'createdAt': dt, 'updatedAt': dt, 'version': version})
S['CreateOrderRequest'] = obj({'items': {**arr(obj({'listingId': uuid, 'quantity': qty, 'expectedUnitPriceMinor': price})), 'minItems': 1, 'maxItems': 50}, 'deliveryLocation': ref('Location'), 'deliveryBy': dt, 'notes': text})
S['ChangeOrderStatusRequest'] = obj({'expectedVersion': version, 'status': order_status, 'reason': text}, optional=('reason',))
shipment_fields = {'orderId': uuid, 'logisticsOrgId': uuid, 'pickupAt': dt, 'expectedDeliveryAt': dt, 'vehicleReference': string(maxLength=80), 'temperatureMinC': nullable(number(minimum=-80, maximum=60)), 'temperatureMaxC': nullable(number(minimum=-80, maximum=60))}
S['CreateShipmentRequest'] = obj(shipment_fields)
S['Shipment'] = obj({**shipment_fields, 'id': uuid, 'orderNumber': short, 'supplierOrgId': uuid, 'buyerOrgId': uuid, 'logisticsName': short, 'pickupLocation': ref('Location'), 'deliveryLocation': ref('Location'), 'status': shipment_status, 'latestTemperatureC': nullable(number()), 'excursionCount': integer(), 'deliveryProof': nullable(text), 'createdAt': dt, 'version': version})
S['ChangeShipmentStatusRequest'] = obj({'expectedVersion': version, 'status': shipment_status, 'deliveryProof': text, 'reason': text}, optional=('deliveryProof', 'reason'))
S['CreateTemperatureReadingRequest'] = obj({'measuredAt': dt, 'temperatureC': number(minimum=-80, maximum=60), 'source': enum('manual'), 'deviceId': string(maxLength=80)}, optional=('deviceId',))
S['TemperatureReading'] = obj({'id': uuid, 'shipmentId': uuid, 'measuredAt': dt, 'receivedAt': dt, 'temperatureC': number(minimum=-80, maximum=60), 'source': enum('manual', 'sensor'), 'deviceId': nullable(string()), 'excursion': {'type': 'boolean'}})
S['Payment'] = obj({'id': uuid, 'orderId': uuid, 'invoiceNumber': short, 'amountMinor': integer(), 'currency': currency, 'status': payment_status, 'provider': enum('sandbox'), 'providerReference': nullable(string()), 'heldAt': nullable(dt), 'releasedAt': nullable(dt), 'refundedAt': nullable(dt), 'createdAt': dt})
S['PaymentActionRequest'] = obj({'action': enum('hold', 'release', 'refund'), 'reason': text}, optional=('reason',))
S['Dispute'] = obj({'id': uuid, 'orderId': uuid, 'openedByOrgId': uuid, 'reason': short, 'description': text, 'status': enum('open', 'under_review', 'resolved_refund', 'resolved_release'), 'resolution': nullable(text), 'createdAt': dt, 'updatedAt': dt})
S['CreateDisputeRequest'] = obj({'orderId': uuid, 'reason': short, 'description': string(minLength=10, maxLength=2000)})
S['ResolveDisputeRequest'] = obj({'status': enum('under_review', 'resolved_refund', 'resolved_release'), 'resolution': string(minLength=10, maxLength=2000)})
S['CreateAgreementRequest'] = obj({'supplierOrgId': uuid, 'listingId': uuid, 'title': short, 'quantity': qty, 'cadence': enum('weekly', 'fortnightly', 'monthly'), 'startsAt': dt, 'endsAt': dt})
S['Agreement'] = obj({'id': uuid, 'buyerOrgId': uuid, 'supplierOrgId': uuid, 'listingId': uuid, 'title': short, 'quantity': qty, 'unit': unit, 'pricePerUnitMinor': price, 'currency': currency, 'cadence': enum('weekly', 'fortnightly', 'monthly'), 'startsAt': dt, 'endsAt': dt, 'status': enum('draft', 'active', 'paused', 'ended'), 'nextDeliveryAt': nullable(dt), 'createdAt': dt})
S['Analytics'] = obj({'scope': role, 'generatedAt': dt, 'metrics': obj({'activeListings': integer(), 'openOrders': integer(), 'grossOrderValueMinor': nullable(integer()), 'fulfilledOrders': integer(), 'pendingVerifications': integer(), 'coldChainExceptions': integer()}), 'weeklyVolume': arr(obj({'week': string(format='date'), 'quantity': qty, 'unit': enum('kg'), 'orderValueMinor': nullable(integer())})), 'categoryMix': arr(obj({'category': category, 'listingCount': integer()})), 'priceTrends': arr(obj({'date': string(format='date'), 'category': category, 'averagePricePerKgMinor': integer()})), 'alerts': arr(obj({'id': string(), 'severity': enum('info', 'warning', 'critical'), 'title': short, 'description': text, 'entityId': nullable(uuid)})), 'forecast': obj({'method': enum('insufficient_data', 'trailing_average'), 'description': text, 'nextWeekQuantityKg': nullable(qty), 'sampleWeeks': integer()})})
S['AuditEvent'] = obj({'id': uuid, 'actorUserId': nullable(uuid), 'organizationId': uuid, 'action': short, 'entityType': short, 'entityId': uuid, 'reason': nullable(text), 'createdAt': dt})
S['Health'] = obj({'status': enum('ok', 'degraded'), 'version': string(), 'checks': obj({'database': {'type': 'boolean'}, 'redis': {'type': 'boolean'}})})

def q(name, schema=string(), description=''):
    return {'in': 'query', 'name': name, 'required': False, 'schema': schema, 'description': description}
pagination = [q('page', {'type': 'integer', 'minimum': 1, 'default': 1}), q('pageSize', {'type': 'integer', 'minimum': 1, 'maximum': 100, 'default': 20})]
idem = {'in': 'header', 'name': 'Idempotency-Key', 'required': True, 'schema': string(minLength=16, maxLength=128), 'description': 'Opaque client UUID. Scoped by organization + operation, retained >= 7 days; same key and different body returns 409. Offline queue may submit for <= 24 hours.'}
paths = {}
def route(path, method, operation, tag, description, response=None, request=None, roles=None, public=False, is_page=False, params=None, idempotent=False, status='200'):
    parameters = list(params or [])
    if '{id}' in path: parameters.insert(0, {'in': 'path', 'name': 'id', 'required': True, 'schema': uuid})
    if idempotent: parameters.append(idem)
    response_schema = page(response) if is_page else data(ref(response)) if response else None
    responses = {status: {'description': 'Success', **({'content': {'application/json': {'schema': response_schema}}} if response_schema else {})}}
    for code, meaning in [('400', 'Invalid request'), ('401', 'Authentication required'), ('403', 'Role or verification denied'), ('404', 'Missing or inaccessible resource'), ('409', 'State, stock, version, or idempotency conflict'), ('422', 'Business rule violation'), ('429', 'Rate limit')]:
        responses[code] = {'description': meaning, 'content': {'application/json': {'schema': ref('ApiError')}}}
    definition = {'operationId': operation, 'tags': [tag], 'summary': description.split('.')[0], 'description': description, 'responses': responses}
    if roles: definition['x-roles'] = roles
    if parameters: definition['parameters'] = parameters
    if request: definition['requestBody'] = {'required': True, 'content': {'application/json': {'schema': ref(request)}}}
    if public: definition['security'] = []
    paths.setdefault(path, {})[method] = definition

route('/health', 'get', 'getHealth', 'Operations', 'Read service health. Do not include connection strings or environment secrets.', 'Health', public=True)
route('/auth/register', 'post', 'register', 'Auth', 'Register an organization and its first user. New supplier and logistics accounts need admin verification before trading; admin role cannot self-register.', 'Session', 'RegisterRequest', public=True, status='201')
route('/auth/login', 'post', 'login', 'Auth', 'Authenticate and set the HttpOnly refresh cookie. Access token lasts 900 seconds; password responses do not reveal account existence.', 'Session', 'LoginRequest', public=True)
route('/auth/refresh', 'post', 'refresh', 'Auth', 'Rotate refresh token from HttpOnly cookie. Validate configured Origin; reuse revokes the entire token family. No token in request body.', 'Session', public=True)
route('/auth/logout', 'post', 'logout', 'Auth', 'Revoke refresh-token family and clear cookie. Origin validated; repeat calls are harmless.', public=True, status='204')
route('/auth/me', 'get', 'getMe', 'Auth', 'Return authenticated user and organization plus a current access token.', 'Session')
route('/organizations', 'get', 'listOrganizations', 'Organizations', 'Admin-only private organization directory.', 'Organization', roles=['admin'], is_page=True, params=pagination + [q('verificationStatus', verification)])
route('/organizations/partners', 'get', 'listPartners', 'Organizations', 'List verified public partner cards. Coarse coordinates only; never include licensing documents, private email, or certificates.', 'Partner', roles=['supplier', 'buyer', 'logistics', 'admin'], is_page=True, params=pagination + [q('role', role)])
route('/organizations/me', 'get', 'getMyOrganization', 'Organizations', 'Read own organization private profile.', 'Organization')
route('/organizations/me', 'patch', 'updateMyOrganization', 'Organizations', 'Update own profile with version check. Cannot change role or verification; material license changes reset verification to pending.', 'Organization', 'UpdateOrganizationRequest')
route('/organizations/{id}/verification', 'post', 'verifyOrganization', 'Organizations', 'Admin reviews organization evidence. Mandatory reason and audit record; cannot approve own organization.', 'Organization', 'VerifyOrganizationRequest', roles=['admin'])
route('/listings', 'get', 'listListings', 'Catalog', 'Search active fresh verified-supplier listings. mine=true includes caller-owned drafts and paused lots; admin scope=all includes all. Locations and lot origins rounded to one decimal degree.', 'Listing', is_page=True, params=pagination + [q('search', string(maxLength=120)), q('category', category), q('mine', {'type': 'boolean'}), q('scope', enum('all')), q('status', listing_status), q('sort', enum('newest', 'price_asc', 'freshness'))])
route('/listings/{id}', 'get', 'getListing', 'Catalog', 'Read public listing or caller-owned private listing. Return 404 for inaccessible draft.', 'Listing')
route('/listings', 'post', 'createListing', 'Catalog', 'Create a listing and immutable source lot. Publish only for verified supplier, unexpired lot, harvestedAt <= now, and known appropriate cold chain. Seafood requires chilled/frozen, storage bounds and catch method; produce uses catchMethod=not_applicable.', 'Listing', 'CreateListingRequest', roles=['supplier'], status='201')
route('/listings/{id}', 'patch', 'updateListing', 'Catalog', 'Supplier edits own listing with version check. Source lot fields are immutable. Inventory adjustment needs reason and cannot remove reserved stock. Admin may pause or recall with reason.', 'Listing', 'UpdateListingRequest', roles=['supplier', 'admin'])
route('/rfqs', 'get', 'listRfqs', 'RFQs', 'Buyers see own RFQs; suppliers see open RFQs plus RFQs they quoted; admin sees all. Suppliers see only their own quotes; RFQ buyer sees all quotes.', 'Rfq', roles=['buyer', 'supplier', 'admin'], is_page=True, params=pagination + [q('status', enum('open', 'awarded', 'closed', 'expired'))])
route('/rfqs', 'post', 'createRfq', 'RFQs', 'Buyer requests one category and unit with future delivery deadline.', 'Rfq', 'CreateRfqRequest', roles=['buyer'], status='201')
route('/rfqs/{id}/quotes', 'post', 'createQuote', 'RFQs', 'Verified supplier quotes own eligible listing. Listing category and unit match RFQ. MVP full quantity only; no partial award. Quote price frozen until expiry.', 'Quote', 'CreateQuoteRequest', roles=['supplier'], status='201')
route('/quotes/{id}/accept', 'post', 'acceptQuote', 'RFQs', 'RFQ owner accepts one valid quote and creates order atomically. Revalidate inventory, freshness, and verification. Freeze quote price; mark other quotes rejected; unique order per quote.', 'Order', roles=['buyer'], idempotent=True, status='201')
route('/orders', 'get', 'listOrders', 'Orders', 'List participant-visible commercial orders. Buyers own buyer orders; suppliers own supplier orders; admins all. Logistics uses shipments exclusively and cannot access commercial order records.', 'Order', roles=['buyer', 'supplier', 'admin'], is_page=True, params=pagination + [q('status', order_status)])
route('/orders/{id}', 'get', 'getOrder', 'Orders', 'Read participant-visible order and immutable commercial/lot snapshots. Inaccessible identifiers return 404. Logistics uses shipments exclusively.', 'Order', roles=['buyer', 'supplier', 'admin'])
route('/orders', 'post', 'createOrder', 'Orders', 'Buyer creates single-supplier order using server-calculated prices. expectedUnitPriceMinor records the price reviewed by the buyer; a changed current price returns 409 PRICE_CHANGED without reserving stock. Client cannot set settlement totals. Require unique listing IDs; reserve atomically for 30 minutes. Expired, recalled, excursion or unknown-chain lots cannot be ordered. Line rounding half-up.', 'Order', 'CreateOrderRequest', roles=['buyer'], idempotent=True, status='201')
route('/orders/{id}/status', 'post', 'changeOrderStatus', 'Orders', 'Apply authorized transition with expectedVersion. Supplier: confirm, prepare, ready. Buyer: cancel before pickup or complete delivered order. Logistics transition through shipment API. Admin cancellation needs reason. Held funds refunded atomically on eligible sandbox cancellation.', 'Order', 'ChangeOrderStatusRequest', roles=['buyer', 'supplier', 'admin'])
route('/shipments', 'get', 'listShipments', 'Logistics', 'List participant-visible shipments; logistics only assignments.', 'Shipment', is_page=True, params=pagination + [q('status', shipment_status)])
route('/shipments/{id}', 'get', 'getShipment', 'Logistics', 'Read assigned shipment, precise pickup location and destination, only for participants.', 'Shipment')
route('/shipments', 'post', 'createShipment', 'Logistics', 'Supplier assigns verified logistics organization to its confirmed/preparing/ready order. One shipment per order. Derive pickup/destination from trusted records; delivery deadline cannot exceed lot expiry.', 'Shipment', 'CreateShipmentRequest', roles=['supplier', 'admin'], status='201')
route('/shipments/{id}/status', 'post', 'changeShipmentStatus', 'Logistics', 'Assigned logistics partner progresses scheduled -> picked_up -> in_transit -> delivered. Pickup requires ready order and held payment. Delivery requires deliveryProof. Excursion may set exception; resolution needs admin reason. Changes update order and inventory in same transaction.', 'Shipment', 'ChangeShipmentStatusRequest', roles=['logistics', 'admin'])
route('/shipments/{id}/temperatures', 'get', 'listTemperatureReadings', 'Logistics', 'Read participant-visible temperature readings.', 'TemperatureReading', is_page=True, params=pagination)
route('/shipments/{id}/temperatures', 'post', 'createTemperatureReading', 'Logistics', 'Assigned logistics partner submits manual reading. Reject implausible/future timestamps; compute excursions server-side. Manual data never becomes sensor_verified evidence.', 'TemperatureReading', 'CreateTemperatureReadingRequest', roles=['logistics', 'admin'], status='201')
route('/orders/{id}/payment', 'get', 'getPayment', 'Payments', 'Read invoice/payment for buyer, supplier, or admin. Logistics cannot read financial records.', 'Payment', roles=['buyer', 'supplier', 'admin'])
route('/orders/{id}/payment', 'post', 'actOnPayment', 'Payments', 'Sandbox only. Buyer holds exact server total after confirmation and releases after delivery. Admin refund requires reason; buyer cannot arbitrarily refund. Open dispute blocks ordinary release. Ledger effects and idempotency persisted atomically. This is simulated funds, not regulated escrow.', 'Payment', 'PaymentActionRequest', roles=['buyer', 'admin'], idempotent=True)
route('/disputes', 'get', 'listDisputes', 'Payments', 'Buyer/supplier see disputes for own orders; admin sees all.', 'Dispute', roles=['buyer', 'supplier', 'admin'], is_page=True, params=pagination)
route('/disputes', 'post', 'createDispute', 'Payments', 'Buyer or supplier opens one active dispute on own held-payment order. Freeze release; preserve funds and add audit event.', 'Dispute', 'CreateDisputeRequest', roles=['buyer', 'supplier'], status='201')
route('/disputes/{id}/resolution', 'post', 'resolveDispute', 'Payments', 'Admin records review or final refund/release resolution. Financial effect and ledger balanced in one transaction. Terminal decisions cannot be applied twice.', 'Dispute', 'ResolveDisputeRequest', roles=['admin'])
route('/agreements', 'get', 'listAgreements', 'Agreements', 'Participant-visible recurring supply intentions. MVP records only; no automatic future orders or legally executed contracts.', 'Agreement', roles=['buyer', 'supplier', 'admin'], is_page=True, params=pagination)
route('/agreements', 'post', 'createAgreement', 'Agreements', 'Buyer creates draft agreement against verified supplier listing. Snapshot price/unit; startsAt < endsAt. Supplier acceptance and automatic replenishment are V1.', 'Agreement', 'CreateAgreementRequest', roles=['buyer'], status='201')
route('/analytics', 'get', 'getAnalytics', 'Analytics', 'Return role-scoped actual metrics and alerts. No private competitor quote prices. Kg volume excludes crates. Forecast uses trailing average only with >=4 complete weeks; otherwise insufficient_data. Admin pending count only; other roles receive zero.', 'Analytics')
route('/audit', 'get', 'listAuditEvents', 'Operations', 'Admin-only append-only audit view. Do not serialize secrets, passwords, document bytes, or refresh tokens.', 'AuditEvent', roles=['admin'], is_page=True, params=pagination)

spec = {
    'openapi': '3.0.3',
    'info': {'title': 'HarvestLink Marketplace API', 'version': '1.0.3', 'description': 'Frozen MVP contract. All amounts integer PHP centavos; quantities decimal strings. Demo currency is not a launch-country decision. All business routes require JWT; ownership checked server-side. Responses use {data}, paginated lists {data,meta}, errors {error}. Additional request properties rejected. See docs/architecture.md for state-machine and security invariants.'},
    'servers': [{'url': '/api/v1'}],
    'security': [{'bearerAuth': []}],
    'tags': [{'name': n} for n in ['Auth', 'Organizations', 'Catalog', 'RFQs', 'Orders', 'Logistics', 'Payments', 'Agreements', 'Analytics', 'Operations']],
    'paths': paths,
    'components': {'securitySchemes': {'bearerAuth': {'type': 'http', 'scheme': 'bearer', 'bearerFormat': 'JWT'}, 'refreshCookie': {'type': 'apiKey', 'in': 'cookie', 'name': 'harvest_refresh'}}, 'schemas': S},
}
for endpoint in ['/auth/refresh', '/auth/logout']:
    spec['paths'][endpoint]['post']['security'] = [{'refreshCookie': []}]
spec['components']['schemas']['CreateOrderRequest']['example'] = {'items': [{'listingId': '30000000-0000-4000-8000-000000000001', 'quantity': '125.500', 'expectedUnitPriceMinor': 8500}], 'deliveryLocation': {'label': 'Quezon City receiving dock', 'latitude': 14.676, 'longitude': 121.0437}, 'deliveryBy': '2026-11-08T04:00:00Z', 'notes': 'Call before arrival'}
spec['components']['schemas']['ApiError']['example'] = {'error': {'code': 'INSUFFICIENT_STOCK', 'message': 'Available quantity changed. Review the order before retrying.', 'requestId': 'req_c03fa1b7', 'details': {'items.0.quantity': ['Only 100.000 kg remains available.']}}}
target = Path(__file__).with_name('openapi.yaml')
target.write_text(json.dumps(spec, indent=2) + '\n', encoding='utf-8')
print(f'Generated {target.name}: {len(paths)} paths, {sum(len(v) for v in paths.values())} operations, {len(S)} schemas')
