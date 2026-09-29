-- Veg / non-veg marker (null = not specified, e.g. drinks) and "Bestseller" tag for menu items
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS is_veg boolean,
  ADD COLUMN IF NOT EXISTS is_bestseller boolean NOT NULL DEFAULT false;
