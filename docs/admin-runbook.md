# Administrator runbook

Use the administrator demo account only for synthetic data. Administrative actions require a reason where requested and are recorded in the audit trail.

## Supplier review

Open Verification, inspect the organization's license and certificate references, and record the review outcome. This release stores references; private document upload/scanning is disabled. Do not imply documents were independently validated merely because the profile has a reference. Administrators cannot approve their own organization. Suspension invalidates affected sessions and blocks new business actions.

## Lot and delivery incidents

Pause or recall a listing with a reason. Its source lot and accepted order snapshots remain retained. Review related orders and shipments before further handling. For a shipment temperature exception, record why progression can resume; never rewind completed pickup or erase the excursion history. The current recall capability blocks listings; split/merge lineage and a complete notification/recall program remain V1 work.

## Disputes and refunds

Open Disputes, review the participants' recorded concern, and set under review. A dispute blocks ordinary fund release. Record a final refund or release decision with a reason. Final decisions cannot be applied twice. Sandbox ledger entries are balanced and append-only; no real funds are transferred. Do not edit payment rows directly to simulate a resolution.

## Audit and recovery

Use Audit trail to inspect actor, organization, action, resource, reason, and time. Investigate request IDs alongside redacted API logs. Do not copy credentials, private documents, or full financial payloads into logs.

Follow [operations.md](operations.md) for deployment, migration roles, backup restoration, and incident handling. Local demo data is not an encrypted production backup. A validated Terraform configuration is not proof that resources exist or that recovery targets have been met. Keep the commercial startup gate until the security checklist and operational evidence are complete.
