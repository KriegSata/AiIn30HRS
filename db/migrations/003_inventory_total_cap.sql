-- Reserve enough numeric capacity to return every committed reservation on cancellation.
ALTER TABLE listings ADD CONSTRAINT listings_total_stock_cap
  CHECK (available_quantity + reserved_quantity <= 1000000);
