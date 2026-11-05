# Marketplace Menu Implementation Plan

**Goal:** Replace the crowded marketplace with useful sourcing choices and a short menu.

**Architecture:** Keep frozen API v1.0.3 and existing React views. Reuse native selects/details and current modal/API helpers. No new dependency.

**Tech stack:** Next.js, React, TypeScript, existing CSS and Playwright.

**Spec:** [original menu design](../specs/2026-11-05-marketplace-menu-design.md), followed by the user's [Alibaba-style storefront revision](../specs/2026-11-05-alibaba-storefront-design.md). Approval authority was delegated to Principal by the user.

## Work

- [x] FrontendAgent: revise `apps/web/app/page.tsx` and `globals.css`; simplify role navigation and marketplace, add category/location/optional filters, preserve existing flows.
- [x] Principal: adapt `tests/e2e/marketplace.spec.ts` for grouped navigation, combined filter behavior, empty results, reset, explicit units, and catalog pagination.
- [x] Principal: review changed code, run TypeScript/build and meaningful browser checks; inspect desktop/mobile screenshots.
- [x] Principal: update walkthrough/user guide and integration/security/test evidence without claiming unexecuted checks.

## Review focus

Check combined filters yielding no results, case-insensitive search, minimum quantities with different units, hidden secondary navigation access, and 390px keyboard/dialog behavior. Preserve auth and queued order consent.

The separate live-event browser failure was traced to proxy slash handling and corrected. The subsequent synthetic shared-IP rate-limit failure has recorded HTTP evidence and is addressed by pacing test account switches. See the [integration log](../../integration-log.md). No unrelated API feature work is part of this menu revision.

## Integration acceptance

Principal approved the local sandbox MVP on 2026-11-05 after the final frontend build and all 10 browser scenarios passed, including role accessibility scans, 390/900/1600px layouts, a complete transaction, offline safety, live updates, combined filters, and catalog pagination. Independent UI review accepted the corrected button names. See [verification report](../../test-report.md). Commercial deployment remains outside this approval.
