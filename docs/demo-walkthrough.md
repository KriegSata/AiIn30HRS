# Demo walkthrough

Start the application and obtain the local password as described in [START_HERE](../START_HERE.md). All examples use synthetic Philippine organizations and PHP.

1. Sign in as buyer. The storefront has a main search, horizontal business navigation, and a product comparison grid. Choose Seafood under Category and General Santos under Supplier location. Search for yellowfin tuna, compare its price and minimum order, then open the product to inspect its lot and temperature requirements. Reset filters to return to all products. Open Business tools for analytics and other secondary screens. On mobile, open the menu button for navigation.
2. Sign out and sign in as supplier. Add a produce listing with an expiry beyond your planned delivery. Note its title and lot code.
3. As buyer, find that listing and submit a quantity meeting its minimum. The order starts pending confirmation.
4. As supplier, confirm the order, start preparation, mark it ready, and schedule CoolMove Logistics for collection.
5. As buyer, use Pay in sandbox. This records a simulated held balance.
6. As logistics, add a temperature reading within the shipment range, confirm pickup, start transit, and record delivery with proof.
7. As buyer, review the order/invoice, release the sandbox funds, and acknowledge delivery. The order becomes completed.
8. As admin, inspect the audit trail and the pending Laguna Family Farms verification. Record a review reason before changing its status.

For offline behavior, open a product before disconnecting, submit while offline, and observe the pending queue. Reconnect to complete the submission. A supplier price change before reconnection must produce a visible conflict rather than a newly priced order. Repeated retries must leave one order.

For disputes, use a separate confirmed, held-payment order. Open a buyer concern, review it as admin, and resolve it to a sandbox refund. The ordinary release action must remain unavailable while disputed.
