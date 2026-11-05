# HarvestLink wholesale storefront revision

The user requested Alibaba UI/UX after approving a simpler category and location menu. The Principal approves this implementation under the user's delegated authority. This supersedes the dashboard styling in the earlier menu plan; frozen API v1.0.3 and trading behavior stay in force.

## Design

Use the sourcing hierarchy observed on [Alibaba.com](https://www.alibaba.com/): a white brand masthead, prominent product search, horizontal navigation, category browsing, location selection, and product comparisons. Retain HarvestLink's name and domain data. Orange accents, charcoal text, a light gray catalog canvas, and plain sans-serif typography replace the dashboard's sage and decorative type.

Desktop: horizontal role navigation; search across the catalog; category and supplier-location controls in a left filter rail; product grid showing image, title, unit price, minimum order, supplier, and source location. Detailed freshness, cold chain, and batch traceability remain in the product detail dialog. More filters keeps specialist choices available without crowding initial browsing.

Mobile: full-width search, accessible menu drawer, stacked filters, and product cards within a 390px viewport. Preserve keyboard focus restoration, field labels, unit-safe price comparisons, explicit catalog pagination, and offline submission behavior.

Use representative, locally served product photographs only where the product can be matched correctly. Keep an illustration fallback for other listings; do not imply that a sample image documents an actual supplier lot. Do not add invented ratings, transaction volume, logistics promises, or nonfunctional cart controls.

The current backend supports supplier origin, not delivery-price calculation. Therefore the location filter is explicitly **Supplier location**, rather than a delivery promise.

## Delegation and acceptance

- FrontendAgent owns presentational JSX and CSS. Deliver the integrated storefront with no refresh/auth changes, visible products in the first desktop viewport, working category/location/search, and 390/900/1600px layouts without horizontal overflow.
- DocumentationAgent owns product assets, ProductArt, and image provenance. Deliver modest local assets with source/license references and correct title matching; retain unknown-product fallback.
- QAAndTestAgent investigates the existing stale order-display failure using HTTP evidence; no speculative fixes or weakened server limits.
- Principal reviews all work, adapts meaningful browser tests, verifies build/accessibility/trade flow, captures screenshots, and updates delivery evidence.

Apply the previously requested Superpowers design/debug/verification workflow and Ponytail's smallest complete change. No new framework, dependency, backend contract, or production deployment is needed for this revision.
