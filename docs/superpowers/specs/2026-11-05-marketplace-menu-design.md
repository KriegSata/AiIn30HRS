# Marketplace menu revision

The user rejected the crowded, generic dashboard presentation and requested useful choices including categories and location. The Principal already has delegated approval authority. This revision is approved by the Principal under that authorization; no new infrastructure or API contract is required.

## Approach

Use the existing marketplace, native controls, and role-aware navigation. Show category and supplier location immediately; put optional freshness, price, minimum order, and cold-chain filters under More filters. Remove marketplace metrics, promotional hero, slogans, decorative sidebar card, duplicate titles, and excessive badges. Products should appear in the first desktop viewport. Keep readable labels and clear result/reset feedback.

Alternatives considered: a forced multi-step wizard would slow repeat sourcing; an always-open faceted sidebar would preserve the overload the user rejected. A compact search/filter strip offers choices without adding either burden. These are Principal design decisions, not preferences explicitly selected by the user.

Keep three or four frequent destinations visible per role. Group secondary destinations in a native disclosure and place account/help at the bottom. Preserve all existing destinations and role permissions, order details, offline queue, and financial disclosures. Mobile controls stack and the menu remains keyboard accessible. Category filtering must use only defensible catalog metadata; avoid guessed geography or fake distance.

## Acceptance

- Categories and actual listing locations filter together, with empty state and one-click reset.
- Optional filters have explicit units and avoid mixing crate quantities with kilograms.
- Three or four main menu destinations plus collapsed secondary tools; no inaccessible orphan screens.
- No marketing hero or metric grid before marketplace products.
- Desktop and 390px mobile stay within viewport; keyboard and automated accessibility checks pass.
- Existing trading, offline submission, and role flows remain usable.
