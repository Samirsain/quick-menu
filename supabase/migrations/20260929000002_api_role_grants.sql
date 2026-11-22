-- New Supabase projects no longer grant table access to the API roles by default.
-- This schema was written for the classic default (API roles can reach every public table,
-- RLS policies decide which rows), so grant that back explicitly. Safe to re-run.
-- TRUNCATE/REFERENCES/TRIGGER stay ungranted: the app never needs them and TRUNCATE ignores RLS.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
-- Some projects hand the API roles full table privileges on their own; take back the ones that skip RLS or the app never uses.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- Re-apply the column limits the grant above would otherwise widen
-- (same rules as 20260929000000_quickmenu_schema.sql and 20260929000001_restaurant_cover.sql).
-- Owners may not touch is_active (admin-only), user_id or email.
revoke update on public.restaurants from anon, authenticated;
grant update (name, phone, description, logo_url, qr_code_url, social_links, upi_id, business_type,
              qr_mode, table_config, orders_enabled, waiter_call_enabled, cover_url)
  on public.restaurants to authenticated;

-- Guests may only bump the view counter.
revoke update on public.menu_views from anon, authenticated;
grant update (view_count) on public.menu_views to anon, authenticated;
