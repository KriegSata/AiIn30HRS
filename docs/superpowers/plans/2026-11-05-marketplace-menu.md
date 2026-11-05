# Marketplace Menu Implementation Plan

**Goal:** Replace the crowded marketplace with useful sourcing choices and a short menu.

**Architecture:** Keep frozen API v1.0.3 and existing React views. Reuse native selects/details and current modal/API helpers. No new dependency.

**Tech stack:** Next.js, React, TypeScript, existing CSS and Playwright.

**Spec:** [approved design](../specs/2026-11-05-marketplace-menu-design.md). Approval authority was delegated to Principal by the user.

## Work

- [ ] FrontendAgent: revise `apps/web/app/page.tsx` and `globals.css`; simplify role navigation and marketplace, add category/location/optional filters, preserve existing flows.
- [ ] Principal: adapt `tests/e2e/marketplace.spec.ts` for grouped navigation and filter behavior; confirm the new filter test fails before implementing its missing UI.
- [ ] Principal: review changed code, run TypeScript/build and meaningful browser checks; inspect desktop/mobile screenshots.
- [ ] Principal: update walkthrough/user guide and integration/security/test evidence without claiming unexecuted checks.

## Review focus

Check combined filters yielding no results, case/diacritic search, minimum quantities with different units, hidden secondary navigation access, and 390px keyboard/dialog behavior. Preserve auth and queued order consent.

The separate live-event browser failure remains an integration task: inspect browser frames and proxy boundary before changing configuration. No unrelated API feature work is part of this menu revision.
