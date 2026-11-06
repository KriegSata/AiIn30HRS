# Location-aware marketplace discovery

Principal approves and freezes API amendment 1.0.4 under the user's delegated authority before implementation. No listing DTO or database schema change is required.

Buyers see an inline optional prompt explaining that location puts nearby suppliers first. Only the Enable location button invokes browser geolocation. Declining, browser denial, timeout, unsupported browsers, or unavailable position leaves the marketplace usable with Most popular first. Popularity means the number of distinct completed orders with released payments; unpaid, cancelled, refunded, and pending orders do not count. Equal scores use newest harvest/catch and listing ID, without fabricated popularity badges.

GET /listings adds sort=popular and sort=nearest, with numeric latitude (-90..90) and longitude (-180..180). Nearest requires both coordinates; reject invalid pairs. Ranking is performed across the eligible catalog before pagination. Nearest compares approximate supplier listing coordinates (the same one-decimal public location precision), then popularity, harvest date, and listing ID. This is proximity, not travel distance, delivery coverage, or a delivery promise.

The browser keeps position only in the authenticated workspace's memory, rounds it to two decimals before requests, and clears it on signout, reload, or Use popular products. Do not store coordinates in localStorage, IndexedDB, profiles, analytics, or audit logs. No continuous location watch. Denial is recoverable via a user-initiated retry; no automatic repeated permission prompts. Explain how to change blocked browser permission. Existing manual sort and product filters remain available.

Frontend must preserve API ranking as the default, reset loaded pages when ranking location changes, and ignore old catalog responses after a new ranking request. Location-enabled queries use nearest; otherwise popular. Clear/cancel an in-flight location attempt safely so its delayed callback cannot re-enable location. No new dependencies or external geocoding service.

Acceptance: API tests prove purchased-before-unpurchased, exclusion of cancelled/refunded/unpaid orders, nearer-before-farther, zero/equator values, invalid coordinates, access filtering, and sorting before pagination. Browser tests cover consent success, decline, denied/unavailable, default popularity, clearing location, manual sorting, and signout isolation. Check mobile overflow and accessibility of the prompt.
