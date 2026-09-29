-- UPI ID customers pay the bill to (upi://pay deep link on the customer menu). Null = UPI pay hidden.
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS upi_id text
  CHECK (upi_id IS NULL OR upi_id ~ '^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$');
