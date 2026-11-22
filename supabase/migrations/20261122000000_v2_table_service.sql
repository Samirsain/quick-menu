-- QuickMenu v2: table service.
-- Adds table PINs + activation, seatings (one guest party at a table), server-priced orders, the live bill with
-- split payments, coupons, loyalty, Spin & Win, staff PINs and an activity log.
--
-- Guests no longer write to orders / service_calls directly. They pass the table PIN once (join_table), get the
-- seating's key, and every later action goes through a function that checks that key. Prices always come from
-- menu_items, never from the browser.
--
-- Deploy note: the app calls place_order / join_table from this migration, so push it and deploy the new frontend
-- together (an old cached page can't place orders after this runs).
-- Local test: bash supabase/tests/run_local.sh

-- =====================================================================
-- Settings
-- =====================================================================

alter table public.restaurants
  add column require_table_pin boolean not null default false,
  add column gst_rate numeric(5, 2) not null default 5 check (gst_rate between 0 and 28),
  add column service_charge_pct numeric(5, 2) not null default 0 check (service_charge_pct between 0 and 20),
  add column loyalty jsonb not null default '{"enabled": false, "rupees_per_point": 10, "goal": 200, "reward": "Free coffee"}'::jsonb,
  add column spin_prizes jsonb not null default '[]'::jsonb;

-- Column allow-lists (see 20261121000000_admin_sessions.sql): new columns must be granted to be readable/writable
grant select (require_table_pin, gst_rate, service_charge_pct, loyalty, spin_prizes) on public.restaurants to anon, authenticated;
grant update (require_table_pin, gst_rate, service_charge_pct, loyalty, spin_prizes) on public.restaurants to authenticated;

-- WiFi details only reach guests who passed the table PIN (through table_state), so they live in an owner-only table
create table public.restaurant_private (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  wifi_ssid text not null default '' check (length(wifi_ssid) <= 64),
  wifi_password text not null default '' check (length(wifi_password) <= 64)
);

alter table public.menu_items
  add column prep_minutes integer check (prep_minutes between 0 and 240),
  add column addons jsonb not null default '[]'::jsonb,       -- [{ "name": "Extra cheese", "price": 40 }]
  add column is_chef_special boolean not null default false;

alter table public.menu_categories
  add column station text not null default '' check (length(station) <= 30); -- KDS station: Tandoor, Bar, Dessert...

-- =====================================================================
-- Tables, seatings, payments
-- =====================================================================

create function public.new_pin() returns text language sql volatile set search_path = public, extensions as $$
  select lpad(((get_byte(b, 0) * 256 + get_byte(b, 1)) % 10000)::text, 4, '0') from (select extensions.gen_random_bytes(2) as b) x;
$$;

-- One row per physical table, created the first time a table is opened
create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_number text not null check (table_number ~ '^[A-Za-z0-9]{1,10}$'),
  section text not null default '' check (length(section) <= 40),
  seats integer not null default 4 check (seats between 1 and 50),
  pin text not null default public.new_pin() check (pin ~ '^[0-9]{4}$'),
  is_active boolean not null default false,  -- only an active table takes orders
  activated_at timestamptz,
  activated_by text,
  needs_cleaning boolean not null default false,
  pin_failures integer not null default 0,
  pin_locked_until timestamptz,
  created_at timestamptz not null default now(),
  unique (restaurant_id, table_number)
);

-- A seating is one party at a table: from "table opened" until the bill is closed.
-- 'merged' seatings point at the seating that now carries their bill.
create table public.seatings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_number text not null,
  access_key text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  status text not null default 'open' check (status in ('open', 'merged', 'closed')),
  merged_into uuid references public.seatings (id),
  discount jsonb,      -- { code, kind: pct|flat, value, min_bill, label }
  spin_prize jsonb,    -- { index, label, kind, value }
  guest_phone text check (guest_phone ~ '^[6-9][0-9]{9}$'),
  opened_by text,
  closed_by text,
  close_note text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index seatings_one_live_per_table on public.seatings (restaurant_id, table_number) where status <> 'closed';
create index on public.seatings (restaurant_id, status);

alter table public.orders
  add column seating_id uuid references public.seatings (id),
  add column verified boolean not null default false; -- true when it came through a PIN / table-checked seating
create index on public.orders (seating_id);

alter table public.service_calls drop constraint service_calls_call_type_check;
alter table public.service_calls
  add constraint service_calls_call_type_check check (call_type in ('waiter', 'water', 'bill', 'help', 'clean')),
  add column seating_id uuid references public.seatings (id),
  add column acknowledged_by text check (length(acknowledged_by) <= 40);
create index on public.service_calls (restaurant_id, table_number, created_at desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  seating_id uuid not null references public.seatings (id) on delete cascade,
  table_number text not null,
  payer text not null default '' check (length(payer) <= 40),
  amount numeric(10, 2) not null check (amount > 0),
  tip numeric(10, 2) not null default 0 check (tip >= 0),
  mode text not null check (mode in ('upi', 'card', 'cash')),
  split text not null default 'full' check (split in ('full', 'equal', 'items', 'custom')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  upi_ref text check (length(upi_ref) <= 40),
  confirmed_by text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index on public.payments (seating_id);
create index on public.payments (restaurant_id, created_at desc);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{3,16}$'),
  kind text not null check (kind in ('pct', 'flat')),
  value numeric(10, 2) not null check (value > 0),
  min_bill numeric(10, 2) not null default 0 check (min_bill >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, code),
  check (kind <> 'pct' or value <= 100)
);

create table public.loyalty_members (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),
  points integer not null default 0 check (points >= 0),
  visits integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, phone)
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  role text not null check (role in ('waiter', 'kitchen', 'cashier', 'manager')),
  pin_hash text not null,
  section text not null default '' check (length(section) <= 40),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  staff_name text check (length(staff_name) <= 40),
  action text not null check (length(action) <= 40),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.activity_log (restaurant_id, created_at desc);

-- =====================================================================
-- Row Level Security: guests reach none of these tables directly, owners see their own
-- =====================================================================

alter table public.restaurant_private enable row level security;
alter table public.dining_tables enable row level security;
alter table public.seatings enable row level security;
alter table public.payments enable row level security;
alter table public.coupons enable row level security;
alter table public.loyalty_members enable row level security;
alter table public.staff enable row level security;
alter table public.activity_log enable row level security;

revoke all on public.restaurant_private, public.dining_tables, public.seatings, public.payments, public.coupons,
  public.loyalty_members, public.staff, public.activity_log from anon, authenticated;

-- Owners read everything of theirs; writes that have rules (seatings, payments, PINs) go through the functions below
grant select on public.dining_tables, public.seatings, public.payments, public.coupons, public.loyalty_members,
  public.activity_log, public.restaurant_private to authenticated;
grant select (id, restaurant_id, name, role, section, active, created_at) on public.staff to authenticated; -- never pin_hash
grant insert, update, delete on public.coupons, public.restaurant_private to authenticated;
grant update (section, seats) on public.dining_tables to authenticated;
grant delete on public.dining_tables to authenticated;
grant update (name, role, section, active) on public.staff to authenticated;
grant delete on public.staff to authenticated;
grant insert (restaurant_id, staff_name, action, details) on public.activity_log to authenticated;

create policy "Owners" on public.restaurant_private for all to authenticated
  using (public.owns_restaurant(restaurant_id)) with check (public.owns_restaurant(restaurant_id));
create policy "Owners" on public.dining_tables for all to authenticated
  using (public.owns_restaurant(restaurant_id)) with check (public.owns_restaurant(restaurant_id));
create policy "Owners" on public.seatings for select to authenticated using (public.owns_restaurant(restaurant_id));
create policy "Owners" on public.payments for select to authenticated using (public.owns_restaurant(restaurant_id));
create policy "Owners" on public.coupons for all to authenticated
  using (public.owns_restaurant(restaurant_id)) with check (public.owns_restaurant(restaurant_id));
create policy "Owners" on public.loyalty_members for select to authenticated using (public.owns_restaurant(restaurant_id));
create policy "Owners" on public.staff for all to authenticated
  using (public.owns_restaurant(restaurant_id)) with check (public.owns_restaurant(restaurant_id));
create policy "Owners read" on public.activity_log for select to authenticated using (public.owns_restaurant(restaurant_id));
create policy "Owners write" on public.activity_log for insert to authenticated with check (public.owns_restaurant(restaurant_id));

-- Guests used to insert orders and calls themselves; now only place_order / call_staff can
drop policy "Guests place orders" on public.orders;
drop policy "Guests call staff" on public.service_calls;
revoke insert on public.orders, public.service_calls from anon, authenticated;

-- =====================================================================
-- Internal helpers (not callable through the API)
-- =====================================================================

-- A guest key -> the live seating whose bill it pays into, plus the table this guest actually sits at
create function public.resolve_key(p_key text, p_allow_closed boolean default false)
returns table (seating_id uuid, table_number text, restaurant_id uuid, status text)
language sql stable security definer set search_path = public as $$
  select t.id, s.table_number, s.restaurant_id, t.status
  from seatings s join seatings t on t.id = coalesce(s.merged_into, s.id)
  where p_key ~ '^[0-9a-f]{32}$' and s.access_key = p_key
    and (t.status = 'open' or (p_allow_closed and t.status = 'closed' and t.closed_at > now() - interval '3 hours'));
$$;

-- The bill. Mirrored in src/lib/bill.ts (computeBill) for the demo; both are tested against the same numbers.
-- discount on the subtotal -> service charge on what's left -> GST on (discounted subtotal + service) -> round to the rupee
create function public.seating_bill(p_seating uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s seatings; r restaurants;
  v_sub numeric := 0; v_disc numeric := 0; v_service numeric; v_gst numeric; v_total numeric;
  v_paid numeric; v_pending numeric; v_tips numeric;
begin
  select * into s from seatings where id = p_seating;
  select * into r from restaurants where id = s.restaurant_id;
  select coalesce(sum((l ->> 'price')::numeric * coalesce((l ->> 'quantity')::int, 1)), 0) into v_sub
  from orders o, jsonb_array_elements(coalesce(o.items -> 'items', '[]'::jsonb)) l
  where o.seating_id = p_seating and o.status not in ('rejected', 'cancelled');
  if s.discount is not null and v_sub >= coalesce((s.discount ->> 'min_bill')::numeric, 0) then
    v_disc := case s.discount ->> 'kind'
      when 'pct' then round(v_sub * (s.discount ->> 'value')::numeric / 100, 2)
      else least((s.discount ->> 'value')::numeric, v_sub) end;
  end if;
  v_service := round((v_sub - v_disc) * r.service_charge_pct / 100, 2);
  v_gst := round((v_sub - v_disc + v_service) * r.gst_rate / 100, 2);
  v_total := round(v_sub - v_disc + v_service + v_gst);
  select coalesce(sum(amount) filter (where status = 'confirmed'), 0),
         coalesce(sum(amount) filter (where status = 'pending'), 0),
         coalesce(sum(tip) filter (where status = 'confirmed'), 0)
    into v_paid, v_pending, v_tips
  from payments where seating_id = p_seating;
  return jsonb_build_object(
    'subtotal', v_sub, 'discount', v_disc, 'service', v_service, 'gst', v_gst,
    'gst_rate', r.gst_rate, 'service_pct', r.service_charge_pct, 'total', v_total,
    'paid', v_paid, 'pending', v_pending, 'tips', v_tips, 'due', greatest(v_total - v_paid, 0));
end;
$$;

create function public.assert_owner(p_restaurant_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.owns_restaurant(p_restaurant_id) then
    raise exception 'Not your restaurant' using errcode = '42501';
  end if;
end;
$$;

create function public.log_activity(p_restaurant_id uuid, p_by text, p_action text, p_details jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into activity_log (restaurant_id, staff_name, action, details)
  values (p_restaurant_id, left(nullif(trim(p_by), ''), 40), p_action, coalesce(p_details, '{}'));
$$;

-- Closes a seating and every seating merged into it: tables go inactive and wait for cleaning, loyalty points land
create function public.close_seating(p_seating uuid, p_by text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s seatings; r restaurants; v_bill jsonb; v_rule jsonb; v_points int;
begin
  select * into s from seatings where id = p_seating and status = 'open' for update;
  if not found then return; end if;
  select * into r from restaurants where id = s.restaurant_id;
  v_bill := seating_bill(s.id);

  update dining_tables d set is_active = false, needs_cleaning = true
  where d.restaurant_id = s.restaurant_id
    and d.table_number in (select x.table_number from seatings x where x.id = s.id or x.merged_into = s.id);
  update seatings set status = 'closed', closed_at = now(), closed_by = p_by, close_note = p_note
  where id = s.id or merged_into = s.id;

  v_rule := r.loyalty;
  if s.guest_phone is not null and coalesce((v_rule ->> 'enabled')::boolean, false) then
    v_points := floor((v_bill ->> 'paid')::numeric / greatest(coalesce((v_rule ->> 'rupees_per_point')::numeric, 10), 1));
    insert into loyalty_members (restaurant_id, phone, points, visits) values (s.restaurant_id, s.guest_phone, v_points, 1)
    on conflict (restaurant_id, phone) do update
      set points = loyalty_members.points + excluded.points, visits = loyalty_members.visits + 1, updated_at = now();
  end if;

  perform log_activity(s.restaurant_id, p_by, case when p_note is null then 'bill_closed' else 'bill_closed_unpaid' end,
    jsonb_build_object('table', s.table_number, 'total', v_bill -> 'total', 'paid', v_bill -> 'paid', 'note', p_note));
end;
$$;

revoke execute on function public.resolve_key(text, boolean), public.seating_bill(uuid), public.assert_owner(uuid),
  public.log_activity(uuid, text, text, jsonb), public.close_seating(uuid, text, text), public.new_pin()
  from public, anon, authenticated;

-- =====================================================================
-- Guest functions (anon). Errors are raised as short codes the app turns into copy.
-- =====================================================================

-- QR scan (+ PIN) -> seating key. PIN restaurants: the table must be opened by staff and the PIN must match.
-- Others: the scan opens the table. 5 wrong PINs lock the table for 10 minutes (staff can reset it).
create function public.join_table(p_restaurant_id uuid, p_table text, p_pin text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  r restaurants; t dining_tables; s seatings; v_fail int;
begin
  select * into r from restaurants where id = p_restaurant_id;
  if not found or not r.is_active then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end if;
  p_table := trim(coalesce(p_table, ''));
  if p_table !~ '^[A-Za-z0-9]{1,10}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_table');
  end if;
  if p_table ~ '^[0-9]{1,6}$' and coalesce(r.table_config -> 'disabled', '[]'::jsonb) @> jsonb_build_array(p_table::int) then
    return jsonb_build_object('ok', false, 'error', 'disabled');
  end if;

  if r.require_table_pin then
    select * into t from dining_tables where restaurant_id = r.id and table_number = p_table for update;
    if not found or not t.is_active then
      return jsonb_build_object('ok', false, 'error', 'inactive');
    end if;
    if t.pin_locked_until > now() then
      return jsonb_build_object('ok', false, 'error', 'locked');
    end if;
    if p_pin is distinct from t.pin then
      v_fail := case when t.pin_locked_until is not null then 0 else t.pin_failures end + 1;
      update dining_tables set pin_failures = v_fail,
        pin_locked_until = case when v_fail >= 5 then now() + interval '10 minutes' end
      where id = t.id;
      return jsonb_build_object('ok', false, 'error', case when v_fail >= 5 then 'locked' else 'bad_pin' end, 'tries_left', greatest(5 - v_fail, 0));
    end if;
    update dining_tables set pin_failures = 0, pin_locked_until = null where id = t.id;
  else
    insert into dining_tables (restaurant_id, table_number, is_active, activated_at, activated_by)
    values (r.id, p_table, true, now(), 'guest')
    on conflict (restaurant_id, table_number) do update
      set is_active = true, needs_cleaning = false,
          activated_at = case when dining_tables.is_active then dining_tables.activated_at else now() end,
          activated_by = case when dining_tables.is_active then dining_tables.activated_by else 'guest' end
    returning * into t;
  end if;

  select * into s from seatings where restaurant_id = r.id and table_number = p_table and status <> 'closed';
  if not found then
    insert into seatings (restaurant_id, table_number, opened_by) values (r.id, p_table, t.activated_by) returning * into s;
  end if;
  return jsonb_build_object('ok', true, 'key', s.access_key, 'table', p_table);
end;
$$;

-- Everything the guest's phone shows: orders, live bill, payments, calls, extras. Works for 3 hours after the bill
-- closes so the receipt and review screens still load.
create function public.table_state(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  k record; s seatings; r restaurants; p restaurant_private; v_member loyalty_members;
begin
  select * into k from resolve_key(p_key, true);
  if k.seating_id is null then
    return jsonb_build_object('ok', false);
  end if;
  select * into s from seatings where id = k.seating_id;
  select * into r from restaurants where id = s.restaurant_id;
  select * into p from restaurant_private where restaurant_id = r.id;
  if s.guest_phone is not null then
    select * into v_member from loyalty_members where restaurant_id = r.id and phone = s.guest_phone;
  end if;
  return jsonb_build_object(
    'ok', true,
    'status', s.status,
    'table', k.table_number,
    'bill_table', s.table_number,
    'opened_at', s.opened_at,
    'closed_at', s.closed_at,
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'order_number', o.order_number, 'table_number', o.table_number,
        'status', o.status, 'items', o.items, 'created_at', o.created_at, 'updated_at', o.updated_at) order by o.created_at)
      from orders o where o.seating_id = s.id), '[]'::jsonb),
    'bill', seating_bill(s.id),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'payer', x.payer, 'amount', x.amount, 'tip', x.tip,
        'mode', x.mode, 'split', x.split, 'status', x.status, 'created_at', x.created_at) order by x.created_at)
      from payments x where x.seating_id = s.id), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'call_type', c.call_type, 'status', c.status,
        'acknowledged_by', c.acknowledged_by, 'acknowledged_at', c.acknowledged_at, 'created_at', c.created_at) order by c.created_at desc)
      from (select * from service_calls c where c.seating_id = s.id order by c.created_at desc limit 5) c), '[]'::jsonb),
    'served_by', (select c.acknowledged_by from service_calls c where c.seating_id = s.id and c.acknowledged_by is not null
                  order by c.acknowledged_at desc limit 1),
    'discount', s.discount,
    'spin', s.spin_prize,
    'spin_prizes', r.spin_prizes,
    'loyalty', case when coalesce((r.loyalty ->> 'enabled')::boolean, false) then r.loyalty || jsonb_build_object(
        'phone_linked', s.guest_phone is not null, 'points', v_member.points) end,
    'wifi', case when coalesce(p.wifi_ssid, '') <> '' then jsonb_build_object('ssid', p.wifi_ssid, 'password', p.wifi_password) end
  );
end;
$$;

-- Lines: [{ id, qty, size?, addons?: [names], note? }]. Price, name and photo come from the menu, never the browser.
-- p_client_id makes a retry (offline queue, double tap) return the same order instead of a second one.
create function public.place_order(p_key text, p_lines jsonb, p_note text default null, p_client_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k record; r restaurants; m menu_items; v_line jsonb; v_addon text; v_extra jsonb;
  v_items jsonb := '[]'::jsonb; v_price numeric; v_qty int; v_size text; v_opts text[]; v_note text;
  v_order orders; v_no int;
begin
  select * into k from resolve_key(p_key);
  if k.seating_id is null then raise exception 'seat_closed'; end if;

  if p_client_id is not null then
    select * into v_order from orders where id = p_client_id;
    if found then
      if v_order.seating_id is distinct from k.seating_id then raise exception 'bad_items'; end if;
      return to_jsonb(v_order);
    end if;
  end if;

  select * into r from restaurants where id = k.restaurant_id;
  if not r.is_active or not r.orders_enabled then raise exception 'orders_off'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 40 then
    raise exception 'bad_items';
  end if;
  if (select count(*) from orders where seating_id = k.seating_id and status = 'pending') >= 5 then
    raise exception 'too_many';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(v_line ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_line ->> 'qty', '1') !~ '^[0-9]{1,2}$' then
      raise exception 'bad_items';
    end if;
    select * into m from menu_items where id = (v_line ->> 'id')::uuid and restaurant_id = r.id;
    if not found then raise exception 'item_gone'; end if;
    if not m.is_available then raise exception 'item_unavailable' using detail = m.name; end if;
    v_qty := coalesce((v_line ->> 'qty')::int, 1);
    if v_qty not between 1 and 50 then raise exception 'bad_items'; end if;

    v_size := nullif(v_line ->> 'size', '');
    if m.has_size_variants and jsonb_array_length(m.size_variants) > 0 then
      select (sv ->> 'price')::numeric into v_price from jsonb_array_elements(m.size_variants) sv where sv ->> 'name' = v_size limit 1;
      if v_price is null then raise exception 'bad_size'; end if;
    else
      v_size := null;
      v_price := m.price;
    end if;

    v_opts := '{}';
    if jsonb_typeof(coalesce(v_line -> 'addons', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(v_line -> 'addons', '[]'::jsonb)) > 10 then
      raise exception 'bad_addon';
    end if;
    for v_addon in select distinct jsonb_array_elements_text(coalesce(v_line -> 'addons', '[]'::jsonb)) loop
      select a into v_extra from jsonb_array_elements(m.addons) a where a ->> 'name' = v_addon limit 1;
      if v_extra is null then raise exception 'bad_addon'; end if;
      v_price := v_price + coalesce((v_extra ->> 'price')::numeric, 0);
      v_opts := v_opts || (v_extra ->> 'name');
    end loop;
    v_note := left(trim(regexp_replace(coalesce(v_line ->> 'note', ''), '[[:cntrl:]]', ' ', 'g')), 120);
    if v_note <> '' then v_opts := v_opts || v_note; end if;

    v_items := v_items || jsonb_build_object(
      'id', m.id, 'name', m.name, 'price', v_price, 'quantity', v_qty, 'image_url', m.image_url,
      'selectedSize', v_size, 'options', nullif(array_to_string(v_opts, ' · '), ''), 'prep_minutes', m.prep_minutes,
      'station', (select nullif(c.station, '') from menu_categories c where c.id = m.category_id));
  end loop;

  -- Short daily order numbers (#0007) are easier to call out across a kitchen than timestamps
  perform pg_advisory_xact_lock(hashtext(r.id::text));
  select count(*) + 1 into v_no from orders
  where restaurant_id = r.id and created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');

  insert into orders (id, restaurant_id, order_number, table_number, items, status, seating_id, verified)
  values (coalesce(p_client_id, gen_random_uuid()), r.id, 'ORD' || lpad(v_no::text, 4, '0'), k.table_number,
          jsonb_build_object('items', v_items,
                             'note', nullif(left(trim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), 200), ''),
                             'timeline', jsonb_build_object('pending', now())),
          'pending', k.seating_id, true)
  returning * into v_order;
  return to_jsonb(v_order);
end;
$$;

-- "Change my order": only while the kitchen hasn't accepted it
create function public.cancel_pending_order(p_key text, p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  k record;
begin
  select * into k from resolve_key(p_key);
  if k.seating_id is null then raise exception 'seat_closed'; end if;
  update orders set status = 'cancelled',
    items = jsonb_set(coalesce(items, '{}'::jsonb), '{timeline,cancelled}', to_jsonb(now()), true)
  where id = p_order_id and seating_id = k.seating_id and status = 'pending';
  if not found then raise exception 'not_editable'; end if;
end;
$$;

-- One tap waiter call. One call per table every 30 seconds.
create function public.call_staff(p_key text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k record; r restaurants; c service_calls;
begin
  select * into k from resolve_key(p_key);
  if k.seating_id is null then raise exception 'seat_closed'; end if;
  select * into r from restaurants where id = k.restaurant_id;
  if not r.is_active or not r.waiter_call_enabled then raise exception 'calls_off'; end if;
  if p_reason is null or p_reason not in ('waiter', 'water', 'bill', 'help', 'clean') then raise exception 'bad_reason'; end if;
  if exists (select 1 from service_calls where restaurant_id = r.id and table_number = k.table_number
             and created_at > now() - interval '30 seconds') then
    raise exception 'too_soon';
  end if;
  insert into service_calls (restaurant_id, table_number, call_type, seating_id)
  values (r.id, k.table_number, p_reason, k.seating_id) returning * into c;
  return to_jsonb(c);
end;
$$;

-- A guest pays their share. UPI/card/cash all wait for the cashier to confirm (there is no gateway to prove it).
create function public.request_payment(p_key text, p_amount numeric, p_tip numeric, p_mode text, p_payer text default '',
                                       p_split text default 'full', p_upi_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k record; v_bill jsonb; x payments;
begin
  select * into k from resolve_key(p_key);
  if k.seating_id is null then raise exception 'seat_closed'; end if;
  if p_mode is null or p_mode not in ('upi', 'card', 'cash') then raise exception 'bad_mode'; end if;
  if p_split is null or p_split not in ('full', 'equal', 'items', 'custom') then raise exception 'bad_split'; end if;
  p_amount := round(p_amount, 2);
  p_tip := round(coalesce(p_tip, 0), 2);
  v_bill := seating_bill(k.seating_id);
  if p_amount is null or p_amount <= 0 or p_amount > (v_bill ->> 'due')::numeric - (v_bill ->> 'pending')::numeric then
    raise exception 'over_due';
  end if;
  if p_tip < 0 or p_tip > p_amount then raise exception 'bad_tip'; end if;
  if (select count(*) from payments where seating_id = k.seating_id and status = 'pending') >= 10 then
    raise exception 'too_many';
  end if;
  insert into payments (restaurant_id, seating_id, table_number, payer, amount, tip, mode, split, upi_ref)
  values (k.restaurant_id, k.seating_id, k.table_number, left(trim(coalesce(p_payer, '')), 40), p_amount, p_tip, p_mode, p_split,
          nullif(left(regexp_replace(coalesce(p_upi_ref, ''), '[^A-Za-z0-9]', '', 'g'), 40), ''))
  returning * into x;
  return to_jsonb(x);
end;
$$;

-- ponytail: coupon codes aren't rate limited; add attempt counting if a restaurant runs high-value codes
create function public.apply_coupon(p_key text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k record; c coupons; v_bill jsonb;
begin
  select * into k from resolve_key(p_key);
  if k.seating_id is null then raise exception 'seat_closed'; end if;
  select * into c from coupons where restaurant_id = k.restaurant_id and code = upper(trim(coalesce(p_code, ''))) and active;
  if not found then raise exception 'bad_code'; end if;
  v_bill := seating_bill(k.seating_id);
  if (v_bill ->> 'paid')::numeric > 0 or (v_bill ->> 'pending')::numeric > 0 then raise exception 'already_paying'; end if;
  if (v_bill ->> 'subtotal')::numeric < c.min_bill then raise exception 'min_bill' using detail = c.min_bill::text; end if;
  update seatings set discount = jsonb_build_object('code', c.code, 'kind', c.kind, 'value', c.value, 'min_bill', c.min_bill,
      'label', case c.kind when 'pct' then trim_scale(c.value)::text || '% off' else '₹' || trim_scale(c.value)::text || ' off' end)
  where id = k.seating_id;
  return seating_bill(k.seating_id);
end;
$$;

-- Spin & Win: one spin per seating, after the first order. Prizes: [{ label, kind: pct|flat|item|none, value }]
create function public.spin_wheel(p_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  k record; s seatings; r restaurants; v_n int; v_idx int; v_prize jsonb; b bytea := extensions.gen_random_bytes(2);
begin
  select * into k from resolve_key(p_key);
  if k.seating_id is null then raise exception 'seat_closed'; end if;
  select * into s from seatings where id = k.seating_id for update;
  if s.spin_prize is not null then return s.spin_prize; end if;
  select * into r from restaurants where id = s.restaurant_id;
  v_n := jsonb_array_length(coalesce(r.spin_prizes, '[]'::jsonb));
  if v_n = 0 then raise exception 'no_spin'; end if;
  if not exists (select 1 from orders where seating_id = s.id and status not in ('rejected', 'cancelled')) then
    raise exception 'order_first';
  end if;
  v_idx := (get_byte(b, 0) * 256 + get_byte(b, 1)) % v_n;
  v_prize := (r.spin_prizes -> v_idx) || jsonb_build_object('index', v_idx);
  update seatings set spin_prize = v_prize,
    discount = case when discount is null and v_prize ->> 'kind' in ('pct', 'flat') and coalesce((v_prize ->> 'value')::numeric, 0) > 0
                    then jsonb_build_object('code', 'SPIN', 'kind', v_prize ->> 'kind', 'value', (v_prize ->> 'value')::numeric,
                                            'min_bill', 0, 'label', v_prize ->> 'label')
                    else discount end
  where id = s.id;
  return v_prize;
end;
$$;

-- Works on the receipt too (up to 3 hours after the bill closed): points for a closed bill are credited here, once
create function public.join_loyalty(p_key text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k record; r restaurants; s seatings; v_points int;
begin
  select * into k from resolve_key(p_key, true);
  if k.seating_id is null then raise exception 'seat_closed'; end if;
  select * into r from restaurants where id = k.restaurant_id;
  if not coalesce((r.loyalty ->> 'enabled')::boolean, false) then raise exception 'no_loyalty'; end if;
  p_phone := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
  if p_phone !~ '^[6-9][0-9]{9}$' then raise exception 'bad_phone'; end if;
  select * into s from seatings where id = k.seating_id for update;
  if s.status = 'closed' and s.guest_phone is not null then
    p_phone := s.guest_phone; -- this visit already earned its points
  elsif s.status = 'closed' then
    update seatings set guest_phone = p_phone where id = s.id;
    insert into loyalty_members (restaurant_id, phone, points, visits)
    values (r.id, p_phone, floor((seating_bill(s.id) ->> 'paid')::numeric / greatest(coalesce((r.loyalty ->> 'rupees_per_point')::numeric, 10), 1)), 1)
    on conflict (restaurant_id, phone) do update
      set points = loyalty_members.points + excluded.points, visits = loyalty_members.visits + 1, updated_at = now();
  else
    update seatings set guest_phone = p_phone where id = s.id;
    insert into loyalty_members (restaurant_id, phone) values (r.id, p_phone) on conflict do nothing;
  end if;
  select points into v_points from loyalty_members where restaurant_id = r.id and phone = p_phone;
  return jsonb_build_object('points', v_points);
end;
$$;

-- =====================================================================
-- Staff functions (signed-in owner device; p_by is the staff member on shift, for the log)
-- =====================================================================

-- Live floor: every known table with its seating, bill, payments and open calls
create function public.floor_state(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_owner(p_restaurant_id);
  return jsonb_build_object(
    'tables', coalesce((select jsonb_agg(to_jsonb(d) - 'pin_failures' order by d.table_number) from dining_tables d
                        where d.restaurant_id = p_restaurant_id), '[]'::jsonb),
    'seatings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'table_number', s.table_number, 'status', s.status, 'merged_into', s.merged_into, 'opened_at', s.opened_at,
        'discount', s.discount, 'guest_phone', s.guest_phone,
        'bill', case when s.status = 'open' then seating_bill(s.id) end,
        'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'order_number', o.order_number, 'status', o.status,
            'table_number', o.table_number, 'items', o.items -> 'items', 'created_at', o.created_at) order by o.created_at)
          from orders o where o.seating_id = s.id), '[]'::jsonb),
        'payments', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from payments x where x.seating_id = s.id), '[]'::jsonb),
        'loyalty_points', (select m.points from loyalty_members m where m.restaurant_id = s.restaurant_id and m.phone = s.guest_phone)
      )) from seatings s where s.restaurant_id = p_restaurant_id and s.status <> 'closed'), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from service_calls c
                       where c.restaurant_id = p_restaurant_id and c.status <> 'completed'
                         and c.created_at > now() - interval '6 hours'), '[]'::jsonb));
end;
$$;

-- Guest sat down: open the table (starts a seating; on PIN restaurants the PIN now works)
create function public.staff_open_table(p_restaurant_id uuid, p_table text, p_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t dining_tables; s seatings;
begin
  perform assert_owner(p_restaurant_id);
  p_table := trim(coalesce(p_table, ''));
  insert into dining_tables (restaurant_id, table_number, is_active, activated_at, activated_by)
  values (p_restaurant_id, p_table, true, now(), p_by)
  on conflict (restaurant_id, table_number) do update
    set is_active = true, needs_cleaning = false, pin_failures = 0, pin_locked_until = null,
        activated_at = case when dining_tables.is_active then dining_tables.activated_at else now() end,
        activated_by = case when dining_tables.is_active then dining_tables.activated_by else p_by end
  returning * into t;
  select * into s from seatings where restaurant_id = p_restaurant_id and table_number = p_table and status <> 'closed';
  if not found then
    insert into seatings (restaurant_id, table_number, opened_by) values (p_restaurant_id, p_table, p_by) returning * into s;
    perform log_activity(p_restaurant_id, p_by, 'table_opened', jsonb_build_object('table', p_table));
  end if;
  return jsonb_build_object('table', t.table_number, 'pin', t.pin);
end;
$$;

-- Close the bill. Refuses while money is still due unless p_note says why (walk-out, paid outside the app...).
create function public.staff_close_table(p_restaurant_id uuid, p_table text, p_by text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s seatings;
begin
  perform assert_owner(p_restaurant_id);
  select * into s from seatings where restaurant_id = p_restaurant_id and table_number = p_table and status <> 'closed';
  if not found then
    update dining_tables set is_active = false where restaurant_id = p_restaurant_id and table_number = p_table;
    return;
  end if;
  if s.status = 'merged' then
    select * into s from seatings where id = s.merged_into;
  end if;
  if (seating_bill(s.id) ->> 'due')::numeric > 0 and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'money_due';
  end if;
  perform close_seating(s.id, p_by, nullif(left(trim(coalesce(p_note, '')), 120), ''));
end;
$$;

create function public.staff_mark_clean(p_restaurant_id uuid, p_table text, p_by text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_owner(p_restaurant_id);
  update dining_tables set needs_cleaning = false where restaurant_id = p_restaurant_id and table_number = p_table;
end;
$$;

create function public.staff_set_pin(p_restaurant_id uuid, p_table text, p_pin text default null, p_by text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pin text := coalesce(nullif(trim(p_pin), ''), new_pin());
begin
  perform assert_owner(p_restaurant_id);
  if v_pin !~ '^[0-9]{4}$' then raise exception 'bad_pin'; end if;
  insert into dining_tables (restaurant_id, table_number, pin) values (p_restaurant_id, trim(p_table), v_pin)
  on conflict (restaurant_id, table_number) do update set pin = v_pin, pin_failures = 0, pin_locked_until = null;
  perform log_activity(p_restaurant_id, p_by, 'pin_changed', jsonb_build_object('table', trim(p_table)));
  return v_pin;
end;
$$;

-- Party moved tables: the seating (orders, bill, calls) follows them
create function public.staff_transfer_table(p_restaurant_id uuid, p_from text, p_to text, p_by text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s seatings;
begin
  perform assert_owner(p_restaurant_id);
  p_to := trim(coalesce(p_to, ''));
  if p_to !~ '^[A-Za-z0-9]{1,10}$' or p_to = p_from then raise exception 'bad_table'; end if;
  select * into s from seatings where restaurant_id = p_restaurant_id and table_number = p_from and status = 'open' for update;
  if not found then raise exception 'no_seating'; end if;
  if exists (select 1 from seatings where restaurant_id = p_restaurant_id and table_number = p_to and status <> 'closed') then
    raise exception 'table_busy';
  end if;
  insert into dining_tables (restaurant_id, table_number, is_active, activated_at, activated_by)
  values (p_restaurant_id, p_to, true, now(), p_by)
  on conflict (restaurant_id, table_number) do update set is_active = true, needs_cleaning = false, activated_at = now();
  update dining_tables set is_active = false, needs_cleaning = true where restaurant_id = p_restaurant_id and table_number = p_from;
  update seatings set table_number = p_to where id = s.id;
  update orders set table_number = p_to where seating_id = s.id and table_number = p_from;
  update payments set table_number = p_to where seating_id = s.id and table_number = p_from;
  update service_calls set table_number = p_to where seating_id = s.id and table_number = p_from;
  perform log_activity(p_restaurant_id, p_by, 'table_moved', jsonb_build_object('from', p_from, 'to', p_to));
end;
$$;

-- Two tables become one party: one bill (on p_into), food still goes to the table each guest sits at
create function public.staff_merge_tables(p_restaurant_id uuid, p_from text, p_into text, p_by text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  a seatings; b seatings;
begin
  perform assert_owner(p_restaurant_id);
  if p_from = p_into then raise exception 'bad_table'; end if;
  select * into a from seatings where restaurant_id = p_restaurant_id and table_number = p_from and status = 'open' for update;
  select * into b from seatings where restaurant_id = p_restaurant_id and table_number = p_into and status = 'open' for update;
  if a.id is null or b.id is null then raise exception 'no_seating'; end if;
  if exists (select 1 from payments where seating_id = a.id and status <> 'rejected') then raise exception 'already_paying'; end if;
  update orders set seating_id = b.id where seating_id = a.id;
  update service_calls set seating_id = b.id where seating_id = a.id;
  update seatings set status = 'merged', merged_into = b.id where id = a.id;
  update seatings set merged_into = b.id where merged_into = a.id; -- tables merged into a earlier follow along
  perform log_activity(p_restaurant_id, p_by, 'tables_merged', jsonb_build_object('from', p_from, 'into', p_into));
end;
$$;

-- Cashier confirms (or rejects) a guest's payment. The bill closes itself once nothing is due.
create function public.staff_settle_payment(p_payment_id uuid, p_accept boolean, p_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  x payments; v_bill jsonb;
begin
  select * into x from payments where id = p_payment_id for update;
  if not found then raise exception 'no_payment'; end if;
  perform assert_owner(x.restaurant_id);
  if x.status <> 'pending' then raise exception 'already_settled'; end if;
  update payments set status = case when p_accept then 'confirmed' else 'rejected' end, confirmed_by = p_by, confirmed_at = now()
  where id = x.id;
  perform log_activity(x.restaurant_id, p_by, case when p_accept then 'payment_confirmed' else 'payment_rejected' end,
    jsonb_build_object('table', x.table_number, 'amount', x.amount, 'tip', x.tip, 'mode', x.mode, 'payer', x.payer));
  v_bill := seating_bill(x.seating_id);
  if (v_bill ->> 'due')::numeric = 0 and (v_bill ->> 'total')::numeric > 0 then
    perform close_seating(x.seating_id, p_by);
  end if;
  return v_bill;
end;
$$;

-- Cashier takes money at the counter (cash, card machine, UPI scanned at the desk)
create function public.staff_add_payment(p_restaurant_id uuid, p_table text, p_amount numeric, p_mode text,
                                         p_tip numeric default 0, p_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s seatings; v_bill jsonb;
begin
  perform assert_owner(p_restaurant_id);
  select * into s from seatings where restaurant_id = p_restaurant_id and table_number = p_table and status = 'open';
  if not found then raise exception 'no_seating'; end if;
  if p_mode is null or p_mode not in ('upi', 'card', 'cash') then raise exception 'bad_mode'; end if;
  v_bill := seating_bill(s.id);
  -- payments still waiting for confirmation are already spoken for
  if p_amount is null or round(p_amount, 2) <= 0
     or round(p_amount, 2) > (v_bill ->> 'due')::numeric - (v_bill ->> 'pending')::numeric then raise exception 'over_due'; end if;
  insert into payments (restaurant_id, seating_id, table_number, payer, amount, tip, mode, split, status, confirmed_by, confirmed_at)
  values (p_restaurant_id, s.id, p_table, 'Counter', round(p_amount, 2), round(coalesce(p_tip, 0), 2), p_mode, 'custom', 'confirmed', p_by, now());
  perform log_activity(p_restaurant_id, p_by, 'payment_taken', jsonb_build_object('table', p_table, 'amount', round(p_amount, 2), 'mode', p_mode));
  v_bill := seating_bill(s.id);
  if (v_bill ->> 'due')::numeric = 0 then
    perform close_seating(s.id, p_by);
  end if;
  return v_bill;
end;
$$;

create function public.staff_redeem_loyalty(p_restaurant_id uuid, p_phone text, p_by text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_goal int; v_left int;
begin
  perform assert_owner(p_restaurant_id);
  select greatest(coalesce((loyalty ->> 'goal')::int, 200), 1) into v_goal from restaurants where id = p_restaurant_id;
  update loyalty_members set points = points - v_goal, updated_at = now()
  where restaurant_id = p_restaurant_id and phone = p_phone and points >= v_goal
  returning points into v_left;
  if not found then raise exception 'not_enough_points'; end if;
  perform log_activity(p_restaurant_id, p_by, 'reward_redeemed', jsonb_build_object('phone', right(p_phone, 4), 'points', v_goal));
  return v_left;
end;
$$;

-- Staff accounts. PINs are 4-6 digits, hashed, and unique among a restaurant's active staff.
create function public.save_staff(p_restaurant_id uuid, p_id uuid, p_name text, p_role text, p_pin text default null,
                                  p_section text default '', p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  perform assert_owner(p_restaurant_id);
  if p_pin is not null then
    if p_pin !~ '^[0-9]{4,6}$' then raise exception 'bad_pin'; end if;
    if exists (select 1 from staff where restaurant_id = p_restaurant_id and active and id is distinct from p_id
               and pin_hash = extensions.crypt(p_pin, pin_hash)) then
      raise exception 'pin_taken';
    end if;
  elsif p_id is null then
    raise exception 'bad_pin';
  end if;
  if p_id is null then
    insert into staff (restaurant_id, name, role, pin_hash, section, active)
    values (p_restaurant_id, trim(p_name), p_role, extensions.crypt(p_pin, extensions.gen_salt('bf')), coalesce(p_section, ''), p_active)
    returning id into v_id;
  else
    update staff set name = trim(p_name), role = p_role, section = coalesce(p_section, ''), active = p_active,
      pin_hash = case when p_pin is null then pin_hash else extensions.crypt(p_pin, extensions.gen_salt('bf')) end
    where id = p_id and restaurant_id = p_restaurant_id returning id into v_id;
    if v_id is null then raise exception 'no_staff'; end if;
  end if;
  perform log_activity(p_restaurant_id, null, case when p_id is null then 'staff_added' else 'staff_updated' end,
    jsonb_build_object('name', trim(p_name), 'role', p_role, 'pin_changed', p_pin is not null));
  return v_id;
end;
$$;

-- Shift sign-in on a shared device: PIN -> who is on shift (used to attribute actions in the log)
create function public.staff_unlock(p_restaurant_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  m staff;
begin
  perform assert_owner(p_restaurant_id);
  select * into m from staff where restaurant_id = p_restaurant_id and active and coalesce(p_pin, '') ~ '^[0-9]{4,6}$'
    and pin_hash = extensions.crypt(p_pin, pin_hash) limit 1;
  if not found then return null; end if;
  perform log_activity(p_restaurant_id, m.name, 'shift_started', '{}');
  return jsonb_build_object('id', m.id, 'name', m.name, 'role', m.role, 'section', m.section);
end;
$$;

-- Staff functions need a signed-in owner (they also check ownership inside)
revoke execute on function public.floor_state(uuid), public.staff_open_table(uuid, text, text),
  public.staff_close_table(uuid, text, text, text), public.staff_mark_clean(uuid, text, text),
  public.staff_set_pin(uuid, text, text, text), public.staff_transfer_table(uuid, text, text, text),
  public.staff_merge_tables(uuid, text, text, text), public.staff_settle_payment(uuid, boolean, text),
  public.staff_add_payment(uuid, text, numeric, text, numeric, text), public.staff_redeem_loyalty(uuid, text, text),
  public.save_staff(uuid, uuid, text, text, text, text, boolean), public.staff_unlock(uuid, text)
  from public, anon;
grant execute on function public.floor_state(uuid), public.staff_open_table(uuid, text, text),
  public.staff_close_table(uuid, text, text, text), public.staff_mark_clean(uuid, text, text),
  public.staff_set_pin(uuid, text, text, text), public.staff_transfer_table(uuid, text, text, text),
  public.staff_merge_tables(uuid, text, text, text), public.staff_settle_payment(uuid, boolean, text),
  public.staff_add_payment(uuid, text, numeric, text, numeric, text), public.staff_redeem_loyalty(uuid, text, text),
  public.save_staff(uuid, uuid, text, text, text, text, boolean), public.staff_unlock(uuid, text)
  to authenticated;

-- =====================================================================
-- Realtime: floor map, cashier and the low-rating alert update live
-- =====================================================================

alter publication supabase_realtime add table public.dining_tables, public.seatings, public.payments, public.feedback;
