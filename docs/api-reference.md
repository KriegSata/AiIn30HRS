# API integration reference

The authoritative contract is [OpenAPI 1.0.4](../contracts/openapi.yaml): 38 operations and 40 schemas. The demo base URL is `http://127.0.0.1:4000/api/v1`; the browser uses the same-origin `/api/v1` proxy at port 3100. [Domain types](../contracts/domain.ts) and [event schemas](../contracts/events.schema.json) accompany it.

## Authentication and ownership

Register a buyer, supplier, or logistics organization, or sign in through `POST /auth/login`. Demo credentials are generated locally; obtain them with `npm run demo:credentials`. Never embed them in an integration. Authentication mutations require the configured browser Origin. Use the returned short-lived access token in `Authorization: Bearer …`; refresh is an HttpOnly cookie scoped to `/api/v1/auth`. Refresh rotates the token, and reuse revokes its family. Signout revokes the session. Browser code keeps the access token in memory.

The server derives user and organization ownership from the session. Supplying a guessed resource ID does not grant access. Logistics partners receive assigned shipment projections, not commercial order/payment details. Public registration cannot create an administrator.

## Request and response conventions

Successful responses wrap the resource in `data`. Errors contain `error.code`, `error.message`, and `error.requestId`; correlate the request ID with server logs. See the specification for each operation's exact status and envelope. Inputs are validated against the contract; unexpected fields are rejected. Use page/pageSize parameters on list operations, and do not assume the first page contains every record.

Quantities are decimal strings with up to three decimal places. Money is an integer in minor units: PHP 95.00 is `9500`. Timestamps use ISO 8601 with an explicit offset or UTC. Coordinates are latitude/longitude fields; PostGIS constructs points in longitude/latitude order.

Updates with `expectedVersion` use optimistic concurrency. On a version conflict, fetch the latest resource and ask the operator to review their intended change. Never silently overwrite another operator's update.

## Safe ordering

`POST /orders` requires an `Idempotency-Key` unique to the buyer's submission intent. Persist the key and original request through connection failures. Retry the same request/key after a lost response; changing the request under that key produces a conflict. Orders contain listings from one supplier.

```json
{
  "items": [{
    "listingId": "<listing UUID>",
    "quantity": "25.000",
    "expectedUnitPriceMinor": 8500
  }],
  "deliveryLocation": {
    "label": "Restaurant receiving dock, Quezon City",
    "latitude": 14.65,
    "longitude": 121.05
  },
  "deliveryBy": "<future ISO timestamp>",
  "notes": "Call the receiving desk on arrival."
}
```

Replace placeholders with actual reviewed values. `409 PRICE_CHANGED` means no order or reservation was created. Display the current price for review and create a new intent only after buyer consent. Quote acceptance preserves the negotiated quote price through its separate endpoint. A successful direct order reserves stock while awaiting supplier confirmation; the current reservation window is 30 minutes.

## Workflows

| Area | Main routes | Important boundary |
| --- | --- | --- |
| Organizations | `/organizations/me`, `/organizations/{id}/verification`, `/organizations/partners` | Verification and suspension are administrator decisions |
| Supply | `/listings`, `/listings/{id}` | Every listing carries a source lot, dates, cold-chain state, and provenance |
| Negotiation | `/rfqs`, `/rfqs/{id}/quotes`, `/quotes/{id}/accept` | Only participating eligible organizations may act |
| Orders | `/orders`, `/orders/{id}/status` | State transitions, stock reservations, and snapshots are transactional |
| Delivery | `/shipments`, `/shipments/{id}/status`, `/shipments/{id}/temperatures` | Assigned logistics access; manual readings retain declared provenance |
| Sandbox finance | `/orders/{id}/payment`, `/disputes`, `/disputes/{id}/resolution` | Simulated held/released/refunded ledger; no external money movement |
| Reporting | `/analytics`, `/audit` | Role-scoped aggregates; administrator audit access |
| Agreements | `/agreements` | Draft intentions only; no scheduled orders are generated |

## Live updates and recovery

Socket.IO uses the `/events` namespace, WebSocket transport, the configured Origin, and `auth.accessToken`. `domain.event` contains `id`, aggregate/version, occurrence time, audience, and event data. Deduplicate on `id`. Re-fetch authorized resources after connection/reconnection; events are hints, not the authoritative state. The browser combines event bursts into a single refresh and retains periodic refresh as a fallback. Current maintenance/event publication runs every 15 seconds inside one API process; multi-instance delivery remains a release gate.

For an offline order, store the reviewed intent under its owning account. Clear private drafts at signout. A local pending-revocation marker must block cookie-based automatic signin until remote logout succeeds. API/private account responses are not service-worker cache entries.

Rate limits are active in the demo. A `429 RATE_LIMITED` response requires waiting for the one-minute window. Avoid immediate retry loops and full-workspace refetches for every event in a burst. Cloud deployment requires distributed throttling and workers; the current process-local controls are not a scaling design.


## Discovery ranking (1.0.4)

`GET /listings?sort=popular` ranks by distinct completed orders whose order payment status and payment record are both released. Ties use newest harvest/catch, then listing ID. `sort=nearest&latitude=6.12&longitude=125.17` ranks using the public one-decimal supplier coordinates, then popularity and the same tie-breakers. Both finite coordinates are required for nearest and forbidden for other sorts; latitude bounds are -90..90 and longitude -180..180. Ranking precedes pagination and preserves role visibility and filters. Omitting sort retains the existing newest-first API default; the storefront explicitly requests popular.

No DTO or schema migration changes. Browser coordinates are rounded to two decimals, held in workspace memory, and never written to account profiles, audit events, or the outbox.
