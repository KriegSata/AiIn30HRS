# HarvestLink acceptance journeys

Use a disposable seeded local database or staging database. These scripts create synthetic lots, orders, audit entries, shipments and disputes. Never run against a live marketplace. Dates use current browser input time; the interface displays Philippine dates and currency.

Run `npm run setup`, then `npm run dev`. Open `http://127.0.0.1:3100`. Get the generated local password with `npm run demo:credentials`. Do not copy passwords or access tokens into reports. The role selector chooses an email; it does not bypass authentication.

## Maria, a highland farmer

1. Sign in with `supplier@harvestlink.demo`. Open **Add listing**.
2. Enter product name, description, unit price, quantity and minimum order. Enter a unique batch code, harvest time, use-by time, source and storage information.
3. Close and reopen the form before publishing. Confirm the typed draft is restored on this device. Publish, then verify the listing in inventory and its source details.
4. Edit the price. Refresh to verify it persists. Try to remove more stock than is available; the server must reject the correction without changing committed goods.
5. Open **Orders**. Confirm a buyer order, start preparing it and mark it ready. Assign a verified carrier with pickup and delivery times before the buyer deadline and lot expiry.

## Andres, a fisher

1. Sign in with `fisher@harvestlink.demo`. Check the tuna and shrimp lots. Maria's inventory must not appear in **My inventory**.
2. Create a seafood lot with catch time, catch method, source vessel, chilled/frozen condition and temperature limits.
3. Try invalid storage ranges and missing catch information. Read the validation and correct it. Buyers must see catch and cold-chain declarations, not a claim of sensor verification.

## Alex, a restaurant buyer

1. Sign in with `buyer@harvestlink.demo`. Search by product, supplier and location. Switch between farm produce and seafood, filter chilled/frozen products, and sort by price.
2. Open a product with keyboard only. Read lot, origin, catch/harvest and storage details. Tab stays inside the dialog; Escape closes it and restores focus.
3. Place a bulk order for a new synthetic lot. Verify the server's order reference and lot/price snapshot.
4. Once the supplier confirms, use **Pay in sandbox**. The interface must state that no real money moves. After delivery, release funds and acknowledge receipt.
5. For a separate held order, report a quality issue. Funds must stay blocked until the administrator resolves it.
6. Create an RFQ, compare a supplier quote and accept it. Verify only one order is created after repeated submission. Save a recurring supply intention; it must remain clearly a draft, with no implied signed contract or automatic stock reservation.

## Jose, a cold-chain carrier

1. Sign in with `logistics@harvestlink.demo`. Only assigned shipments should be actionable.
2. Add a temperature reading. Check the log's measured time, source and condition.
3. On a ready, funded order, confirm pickup and start transit. Record recipient and receipt evidence, then delivery.
4. On a separate synthetic shipment, record an out-of-range temperature. Verify an excursion and operational hold. Do not reuse that shipment for an ordinary successful-delivery walkthrough.

## Platform administrator

1. Sign in with `admin@harvestlink.demo`. Review a pending organization and record the verification decision and reason.
2. Review a buyer dispute with documented evidence. Resolve to refund or release according to the demonstrated case. Confirm the payment status and audit history agree.
3. Review audit events, role-scoped analytics and freshness alerts. A small history must display insufficient forecasting data, not invented confidence.

## Connection-loss acceptance

1. Open a buyer product while connected, then turn the browser offline using developer tools. Submit an order once.
2. Confirm **pending submission** is shown. Verify there is no confirmed order or inventory reservation on the server.
3. Reconnect. Confirm exactly one accepted order, then toggle connectivity again. The same pending entry must not create another order.
4. Repeat with a new synthetic lot. While the buyer is offline, change that lot's price as the supplier. Reconnect: the buyer must receive a reviewable price conflict, with no stock reservation at the new price.
5. Sign out after reconnecting. Sign in as another account. Pending entries and drafts from the previous account must not be visible or submitted.
6. Test an expired lot, insufficient stock and an expired login during retry. Each must preserve an understandable result and never silently promise goods.

## Mobile and accessibility review

Check 390 × 844 and a small tablet viewport. Navigate every role, open forms and dialogs, and scroll tables without horizontal overflow of the whole page. Run automated axe WCAG A/AA checks and then manually check keyboard order, focus visibility, screen-reader announcements, zoom at 200%, color perception, error recovery and touch targets. An automated pass alone is not a WCAG certification.

## Evidence and sign-off

`npm run test:e2e` runs real Edge locally (installed executable) or Playwright Chromium in CI against the actual API. It emits `artifacts/qa-e2e-report.json`, `artifacts/qa-axe-*.json`, screenshots and the HTML report. No API responses are mocked. Playwright traces are disabled because they can retain authentication tokens and form secrets.

Record persona, scenario, expected result, observed result, environment, build revision and evidence path. Mark external payments, SMS/WhatsApp, field network trials, real-device screen-reader trials, infrastructure deployment and restoration exercises **not executed** until each has its own evidence. Synthetic automation is not real farmer/fisher acceptance.

Load scripts: `node tests/load/local-load.mjs` is a bounded local Node harness. `tests/load/marketplace.k6.js` is a separate k6 scenario for a disposable environment, using credentials from environment variables. The default rate is deliberately below the local single-process rate limit. Its thresholds use [Grafana's documented k6 threshold syntax](https://grafana.com/docs/k6/latest/using-k6/thresholds/) and [constant arrival rate executor](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/).
