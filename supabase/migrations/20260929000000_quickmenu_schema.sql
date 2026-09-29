-- QuickMenu database schema. Free for every restaurant: no plans, subscriptions or payments.
-- Apply once to an empty Supabase project:
--   psql "$SUPABASE_DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20260929000000_quickmenu_schema.sql
--
-- Who can do what:
--   * Restaurant owners are Supabase auth users; each owns exactly one restaurant (created by the signup trigger).
--   * Guests use the public menu without logging in (role anon): they read menus, place orders,
--     call staff and leave feedback.
--   * The admin panel logs in through admin_users + verify_admin_password (not Supabase auth).

create extension if not exists pgcrypto with schema extensions;

-- =====================================================================
-- Tables
-- =====================================================================

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  description text,
  logo_url text,
  qr_code_url text,
  social_links jsonb default '{}'::jsonb,
  upi_id text,
  business_type text not null default 'restaurant' check (business_type in ('restaurant', 'hotel')),
  qr_mode text not null default 'single' check (qr_mode in ('single', 'per_table')),
  table_config jsonb not null default '{"total": 10, "skip": [], "disabled": [], "custom_labels": {}}'::jsonb,
  orders_enabled boolean not null default true,
  waiter_call_enabled boolean not null default true,
  is_active boolean not null default true, -- only the admin panel changes this
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  display_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid references public.menu_categories(id) on delete set null,
  name text not null,
  description text not null default '',
  price numeric(10, 2) not null check (price >= 0),
  image_url text not null default '',
  is_available boolean not null default true,
  has_size_variants boolean not null default false,
  size_variants jsonb not null default '[]'::jsonb,
  is_veg boolean,
  is_bestseller boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.menu_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_number text,
  device_fingerprint text,
  is_active boolean not null default true,
  expires_at timestamptz not null,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_number text not null,
  table_number text not null,
  items jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled')),
  session_id text, -- the guest's browser session id (generated client-side), used to find their orders again
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text check (length(comment) <= 1000),
  created_at timestamptz not null default now()
);

create table public.menu_views (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null unique references public.restaurants(id) on delete cascade,
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_calls (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_number text not null,
  call_type text not null check (call_type in ('waiter', 'water', 'bill')),
  status text not null default 'pending' check (status in ('pending', 'acknowledged', 'completed')),
  acknowledged_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now()
);

create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.admin_actions_log (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  action_type text not null,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  details jsonb,
  "timestamp" timestamptz default now()
);

create index on public.menu_categories (restaurant_id, display_order);
create index on public.menu_items (restaurant_id);
create index on public.menu_items (category_id);
create index on public.menu_sessions (restaurant_id);
create index on public.orders (restaurant_id, created_at desc);
create index on public.orders (restaurant_id, status);
create index on public.feedback (restaurant_id, created_at desc);
create index on public.feedback (order_id);
create index on public.service_calls (restaurant_id, status);
create index on public.admin_actions_log ("timestamp" desc);

-- =====================================================================
-- Triggers
-- =====================================================================

create function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.restaurants for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.menu_categories for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.menu_items for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.orders for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.menu_views for each row execute function public.handle_updated_at();

-- Every new owner account gets its restaurant (name/description come from the signup form's metadata)
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_restaurant_id uuid;
begin
  insert into public.restaurants (user_id, name, email, description)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), 'My Restaurant'),
    new.email,
    nullif(trim(new.raw_user_meta_data->>'description'), '')
  )
  returning id into v_restaurant_id;

  insert into public.menu_views (restaurant_id) values (v_restaurant_id);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- =====================================================================
-- Row Level Security
-- =====================================================================

alter table public.restaurants enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.menu_sessions enable row level security;
alter table public.orders enable row level security;
alter table public.feedback enable row level security;
alter table public.menu_views enable row level security;
alter table public.service_calls enable row level security;
alter table public.admin_users enable row level security;       -- no policies: only reachable through the admin functions
alter table public.admin_actions_log enable row level security;

-- Is the signed-in user the owner of this restaurant?
create function public.owns_restaurant(p_restaurant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.restaurants where id = p_restaurant_id and user_id = auth.uid());
$$;

-- restaurants: public menu and admin panel read them; owners edit their own (columns limited below)
create policy "Anyone can view restaurants" on public.restaurants for select using (true);
create policy "Owners update their restaurant" on public.restaurants for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Owners may not touch is_active (admin-only), user_id or email
revoke update on public.restaurants from anon, authenticated;
grant update (name, phone, description, logo_url, qr_code_url, social_links, upi_id, business_type,
              qr_mode, table_config, orders_enabled, waiter_call_enabled)
  on public.restaurants to authenticated;

-- menu
create policy "Anyone can view categories" on public.menu_categories for select using (true);
create policy "Owners manage categories" on public.menu_categories for all to authenticated
  using (public.owns_restaurant(restaurant_id)) with check (public.owns_restaurant(restaurant_id));

create policy "Anyone can view menu items" on public.menu_items for select using (true);
create policy "Owners manage menu items" on public.menu_items for all to authenticated
  using (public.owns_restaurant(restaurant_id)) with check (public.owns_restaurant(restaurant_id));

-- orders: guests place orders at active restaurants that take orders, and can follow recent ones
create policy "Guests place orders" on public.orders for insert to anon, authenticated
  with check (
    status = 'pending'
    and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.is_active and r.orders_enabled)
  );
-- ponytail: guests can read any order from the last 12 hours (order IDs are random UUIDs, no personal data in orders);
-- tie orders to the menu session if that ever needs to be stricter
create policy "Guests follow recent orders" on public.orders for select to anon, authenticated
  using (created_at > now() - interval '12 hours');
create policy "Owners view orders" on public.orders for select to authenticated
  using (public.owns_restaurant(restaurant_id));
create policy "Owners update orders" on public.orders for update to authenticated
  using (public.owns_restaurant(restaurant_id)) with check (public.owns_restaurant(restaurant_id));

-- feedback
create policy "Guests leave feedback" on public.feedback for insert to anon, authenticated
  with check (exists (select 1 from public.orders o where o.id = order_id and o.restaurant_id = feedback.restaurant_id));
create policy "Owners view feedback" on public.feedback for select to authenticated
  using (public.owns_restaurant(restaurant_id));

-- menu views: the public menu bumps the counter (only view_count is writable)
create policy "Anyone can view menu stats" on public.menu_views for select using (true);
create policy "Anyone can bump view count" on public.menu_views for update to anon, authenticated using (true) with check (true);
revoke update on public.menu_views from anon, authenticated;
grant update (view_count) on public.menu_views to anon, authenticated;

-- service calls (waiter / water / bill)
create policy "Guests call staff" on public.service_calls for insert to anon, authenticated
  with check (
    status = 'pending'
    and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.is_active and r.waiter_call_enabled)
  );
create policy "Guests see recent calls" on public.service_calls for select to anon, authenticated
  using (created_at > now() - interval '3 hours');
create policy "Owners view calls" on public.service_calls for select to authenticated
  using (public.owns_restaurant(restaurant_id));
create policy "Owners update calls" on public.service_calls for update to authenticated
  using (public.owns_restaurant(restaurant_id)) with check (public.owns_restaurant(restaurant_id));

-- admin log: the admin panel runs as anon (it has its own login), so it can only append
create policy "Admin panel appends log" on public.admin_actions_log for insert to anon, authenticated with check (true);

-- =====================================================================
-- Functions called by the app
-- =====================================================================

-- QR scan -> short-lived menu session (4 hours)
create function public.create_menu_session(p_restaurant_id uuid, p_table_number text default null, p_device_fingerprint text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from restaurants where id = p_restaurant_id and is_active) then
    raise exception 'Restaurant not available';
  end if;
  insert into menu_sessions (restaurant_id, table_number, device_fingerprint, expires_at)
  values (p_restaurant_id, left(p_table_number, 20), left(p_device_fingerprint, 200), now() + interval '4 hours')
  returning id into v_id;
  return v_id;
end;
$$;

create function public.validate_menu_session(p_session_id text)
returns table (is_valid boolean, remaining_minutes integer, error_message text, expires_at timestamptz, restaurant_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  s menu_sessions;
begin
  if p_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return query select false, 0, 'Invalid session. Scan the QR code on your table to start again.', null::timestamptz, null::uuid;
    return;
  end if;
  select * into s from menu_sessions where id = p_session_id::uuid;
  if not found then
    return query select false, 0, 'Invalid session. Scan the QR code on your table to start again.', null::timestamptz, null::uuid;
  elsif not s.is_active or s.expires_at <= now() then
    return query select false, 0, 'Your menu session has ended. Scan the QR code on your table to start again.', s.expires_at, s.restaurant_id;
  else
    update menu_sessions set last_activity_at = now() where id = s.id;
    return query select true, ceil(extract(epoch from (s.expires_at - now())) / 60)::integer, null::text, s.expires_at, s.restaurant_id;
  end if;
end;
$$;

-- Runs as the caller, so RLS + the column grants decide whether the owner may change it
create function public.update_table_config(p_restaurant_id uuid, p_qr_mode text, p_table_config jsonb)
returns jsonb language plpgsql set search_path = public as $$
begin
  update restaurants set qr_mode = p_qr_mode, table_config = p_table_config where id = p_restaurant_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Restaurant not found or not yours');
  end if;
  return jsonb_build_object('success', true);
end;
$$;

create function public.verify_admin_password(p_email text, p_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
begin
  select password_hash into v_hash from admin_users where email = lower(trim(p_email));
  if v_hash is null then
    perform extensions.crypt(p_password, extensions.gen_salt('bf')); -- same cost whether or not the email exists
    return false;
  end if;
  return v_hash = extensions.crypt(p_password, v_hash);
end;
$$;

create function public.update_admin_password(p_email text, p_current_password text, p_new_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(p_new_password) < 8 or not public.verify_admin_password(p_email, p_current_password) then
    return false;
  end if;
  update admin_users set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')), updated_at = now()
  where email = lower(trim(p_email));
  return true;
end;
$$;

-- ponytail: trusts p_admin_email because the admin panel's login is client-side only (same as the original app);
-- move admins to Supabase auth with a role claim to make this properly secure
create function public.toggle_restaurant_status(p_restaurant_id uuid, p_is_active boolean, p_admin_email text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_users where email = lower(trim(p_admin_email))) then
    raise exception 'Not an admin';
  end if;
  update restaurants set is_active = p_is_active where id = p_restaurant_id;
  if not found then
    return false;
  end if;
  insert into admin_actions_log (admin_email, action_type, restaurant_id, details)
  values (lower(trim(p_admin_email)), case when p_is_active then 'restaurant_enabled' else 'restaurant_disabled' end,
          p_restaurant_id, jsonb_build_object('is_active', p_is_active));
  return true;
end;
$$;

-- Internal helpers are not part of the public API
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_updated_at() from public, anon, authenticated;

-- =====================================================================
-- Realtime (dashboard, kitchen display, guest order tracking)
-- =====================================================================

alter publication supabase_realtime add table public.orders, public.service_calls, public.menu_views, public.restaurants;
