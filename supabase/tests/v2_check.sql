-- Checks for the v2 table-service migration. Changes nothing: everything runs in a rolled-back transaction.
--   bash supabase/tests/run_local.sh           (throwaway local Postgres)
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/v2_check.sql
-- Bill numbers match src/lib/bill.test.ts: Paneer 249 x2 + Naan(+Butter 15) 75 x3 + Lassi Large 120 = 843,
-- FLAT10 (10%) -> 84.30 off, service 10% -> 75.87, GST 5% -> 41.73, total 876.

begin;

-- fails_with(sql, message): the statement must raise exactly this error message
create function pg_temp.fails_with(p_sql text, p_msg text) returns void language plpgsql as $$
declare ran boolean := false;
begin
  begin
    execute p_sql;
    ran := true;
  exception when others then
    if sqlerrm <> p_msg then raise exception 'expected "%", got "%" from: %', p_msg, sqlerrm, p_sql; end if;
  end;
  if ran then raise exception 'expected "%" but it succeeded: %', p_msg, p_sql; end if;
end $$;

-- Values shared between blocks (keys, ids)
create temp table v (k text primary key, val text);
grant select, insert, update on v to anon, authenticated;
create function pg_temp.g(p text) returns text language sql as $$ select val from v where k = p $$;
create function pg_temp.put(p text, x text) returns void language sql as $$
  insert into v values (p, x) on conflict (k) do update set val = excluded.val $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000a001', 'owner-a@test.local', '{"name": "Cafe A"}'),
  ('00000000-0000-4000-8000-00000000b001', 'owner-b@test.local', '{"name": "Cafe B"}');

-- Menu for Cafe A, set up as the database owner (what the dashboard does through RLS)
do $$
declare
  a uuid := (select id from restaurants where user_id = '00000000-0000-4000-8000-00000000a001');
  b uuid := (select id from restaurants where user_id = '00000000-0000-4000-8000-00000000b001');
  c uuid; x uuid;
begin
  perform pg_temp.put('a', a::text);
  perform pg_temp.put('b', b::text);
  update restaurants set gst_rate = 5, service_charge_pct = 10 where id = a;
  insert into menu_categories (restaurant_id, name, station) values (a, 'Mains', 'Tandoor') returning id into c;
  insert into menu_items (restaurant_id, category_id, name, price, prep_minutes) values (a, c, 'Paneer Tikka', 249, 12) returning id into x;
  perform pg_temp.put('paneer', x::text);
  insert into menu_items (restaurant_id, category_id, name, price, addons)
  values (a, c, 'Butter Naan', 60, '[{"name": "Butter", "price": 15}]') returning id into x;
  perform pg_temp.put('naan', x::text);
  insert into menu_items (restaurant_id, name, price, has_size_variants, size_variants)
  values (a, 'Lassi', 80, true, '[{"name": "Small", "price": 80}, {"name": "Large", "price": 120}]') returning id into x;
  perform pg_temp.put('lassi', x::text);
  insert into menu_items (restaurant_id, name, price, is_available) values (a, 'Sold Out Kulfi', 90, false) returning id into x;
  perform pg_temp.put('gone', x::text);
  insert into menu_items (restaurant_id, name, price) values (b, 'Cafe B Dosa', 120) returning id into x;
  perform pg_temp.put('other', x::text);
end $$;

-- =====================================================================
-- Guest at a no-PIN restaurant: scanning opens the table
-- =====================================================================
set local role anon;

do $$
declare
  a uuid := pg_temp.g('a')::uuid; j jsonb; j2 jsonb; o jsonb; st jsonb; k text; n int;
begin
  j := join_table(a, '7');
  assert (j ->> 'ok')::boolean, 'no-PIN join failed: ' || j::text;
  k := j ->> 'key';
  perform pg_temp.put('key7', k);
  j2 := join_table(a, '7');
  assert j2 ->> 'key' = k, 'second phone at the same table got a different seating';
  assert join_table(a, 'x y') ->> 'error' = 'bad_table', 'bad table number accepted';
  assert join_table(gen_random_uuid(), '7') ->> 'error' = 'unavailable', 'unknown restaurant accepted';

  -- the old direct inserts are closed
  begin
    insert into orders (restaurant_id, table_number, items, order_number) values (a, '7', '{"items": []}', 'X');
    assert false, 'guest inserted an order directly';
  exception when insufficient_privilege then null; end;
  begin
    insert into service_calls (restaurant_id, table_number, call_type) values (a, '7', 'water');
    assert false, 'guest inserted a service call directly';
  exception when insufficient_privilege then null; end;

  -- prices come from the menu; the browser's price is ignored; duplicate add-ons count once
  o := place_order(k, jsonb_build_array(
         jsonb_build_object('id', pg_temp.g('paneer'), 'qty', 2, 'price', 1),
         jsonb_build_object('id', pg_temp.g('naan'), 'qty', 3, 'addons', jsonb_build_array('Butter', 'Butter'), 'note', 'kam mirch')),
       'No onion', '11111111-1111-4111-8111-111111111111');
  assert (o -> 'items' -> 'items' -> 0 ->> 'price')::numeric = 249, 'client price was trusted';
  assert (o -> 'items' -> 'items' -> 1 ->> 'price')::numeric = 75, 'add-on not priced once';
  assert o -> 'items' -> 'items' -> 1 ->> 'options' = 'Butter · kam mirch', 'add-on / note not on the ticket';
  assert o -> 'items' -> 'items' -> 0 ->> 'station' = 'Tandoor', 'station missing on the ticket';
  assert (o -> 'items' -> 'items' -> 0 ->> 'prep_minutes')::int = 12, 'prep time missing on the ticket';
  assert o -> 'items' ->> 'note' = 'No onion', 'order note lost';
  assert o ->> 'table_number' = '7' and (o ->> 'verified')::boolean and o ->> 'status' = 'pending', 'order fields wrong';
  assert o ->> 'order_number' = 'ORD0001', 'daily order number not 0001: ' || (o ->> 'order_number');

  -- retrying the same client id (offline queue, double tap) returns the same order
  o := place_order(k, jsonb_build_array(jsonb_build_object('id', pg_temp.g('paneer'))), null, '11111111-1111-4111-8111-111111111111');
  select count(*) into n from table_state(k) t, jsonb_array_elements(t -> 'orders');
  assert n = 1, 'retry created a second order';

  perform pg_temp.fails_with(format('select place_order(%L, %L)', k, jsonb_build_array(jsonb_build_object('id', pg_temp.g('lassi')))), 'bad_size');
  perform pg_temp.fails_with(format('select place_order(%L, %L)', k, jsonb_build_array(jsonb_build_object('id', pg_temp.g('gone')))), 'item_unavailable');
  perform pg_temp.fails_with(format('select place_order(%L, %L)', k, jsonb_build_array(jsonb_build_object('id', pg_temp.g('other')))), 'item_gone');
  perform pg_temp.fails_with(format('select place_order(%L, %L)', k, jsonb_build_array(jsonb_build_object('id', pg_temp.g('naan'), 'addons', jsonb_build_array('Gold leaf')))), 'bad_addon');
  perform pg_temp.fails_with(format('select place_order(%L, %L)', k, jsonb_build_array(jsonb_build_object('id', pg_temp.g('paneer'), 'qty', 0))), 'bad_items');
  perform pg_temp.fails_with(format('select place_order(%L, %L)', k, '[]'), 'bad_items');
  perform pg_temp.fails_with(format('select place_order(%L, %L)', repeat('0', 32), jsonb_build_array(jsonb_build_object('id', pg_temp.g('paneer')))), 'seat_closed');

  -- a pending order can be taken back ("change my order")
  o := place_order(k, jsonb_build_array(jsonb_build_object('id', pg_temp.g('lassi'), 'size', 'Small')));
  perform cancel_pending_order(k, (o ->> 'id')::uuid);
  o := place_order(k, jsonb_build_array(jsonb_build_object('id', pg_temp.g('lassi'), 'size', 'Large')));
  assert (o -> 'items' -> 'items' -> 0 ->> 'price')::numeric = 120, 'size price wrong';
  perform pg_temp.put('lassi_order', o ->> 'id');

  st := table_state(k);
  assert (st ->> 'ok')::boolean and st ->> 'table' = '7', 'table_state failed';
  assert (st -> 'bill' ->> 'subtotal')::numeric = 843, 'subtotal not 843: ' || (st -> 'bill')::text;
  assert (st -> 'bill' ->> 'total')::numeric = round((843 * 1.10) * 1.05), 'bill without discount wrong';

  -- waiter call: one per table every 30 seconds
  perform call_staff(k, 'water');
  perform pg_temp.fails_with(format('select call_staff(%L, %L)', k, 'help'), 'too_soon');
  perform pg_temp.fails_with(format('select call_staff(%L, %L)', k, 'dance'), 'bad_reason');

  perform pg_temp.fails_with(format('select spin_wheel(%L)', k), 'no_spin');
  perform pg_temp.fails_with(format('select apply_coupon(%L, %L)', k, 'NOPE'), 'bad_code');
  perform pg_temp.fails_with(format('select join_loyalty(%L, %L)', k, '9876543210'), 'no_loyalty');

  -- private tables and staff functions are out of reach
  begin perform 1 from seatings; assert false, 'guest read seatings'; exception when insufficient_privilege then null; end;
  begin perform 1 from dining_tables; assert false, 'guest read table PINs'; exception when insufficient_privilege then null; end;
  begin perform 1 from payments; assert false, 'guest read payments'; exception when insufficient_privilege then null; end;
  begin perform 1 from staff; assert false, 'guest read staff'; exception when insufficient_privilege then null; end;
  begin perform 1 from coupons; assert false, 'guest read coupons'; exception when insufficient_privilege then null; end;
  begin perform 1 from restaurant_private; assert false, 'guest read wifi password'; exception when insufficient_privilege then null; end;
  begin perform floor_state(a); assert false, 'guest read the floor'; exception when insufficient_privilege then null; end;
  begin perform staff_open_table(a, '9'); assert false, 'guest opened a table'; exception when insufficient_privilege then null; end;
  begin perform seating_bill(gen_random_uuid()); assert false, 'guest called an internal helper'; exception when insufficient_privilege then null; end;
end $$;

reset role;

-- The restaurant sets up a coupon, Spin & Win prizes, loyalty and WiFi
do $$
declare a uuid := pg_temp.g('a')::uuid;
begin
  insert into coupons (restaurant_id, code, kind, value) values (a, 'FLAT10', 'pct', 10);
  insert into coupons (restaurant_id, code, kind, value, min_bill) values (a, 'BIG500', 'flat', 500, 5000);
  update restaurants set spin_prizes = '[{"label": "Free dessert", "kind": "item"}, {"label": "₹50 off", "kind": "flat", "value": 50}]',
    loyalty = '{"enabled": true, "rupees_per_point": 10, "goal": 200, "reward": "Free coffee"}' where id = a;
  insert into restaurant_private (restaurant_id, wifi_ssid, wifi_password) values (a, 'Cafe_Guest', 'chai1234');
end $$;

set local role anon;

do $$
declare k text := pg_temp.g('key7'); b jsonb; p jsonb; st jsonb;
begin
  perform pg_temp.fails_with(format('select apply_coupon(%L, %L)', k, 'BIG500'), 'min_bill');
  b := apply_coupon(k, ' flat10 ');
  assert (b ->> 'discount')::numeric = 84.30, 'discount wrong: ' || b::text;
  assert (b ->> 'service')::numeric = 75.87, 'service charge wrong: ' || b::text;
  assert (b ->> 'gst')::numeric = 41.73, 'GST wrong: ' || b::text;
  assert (b ->> 'total')::numeric = 876, 'total not 876: ' || b::text;

  -- spin once; the coupon already in place stays (one discount per bill)
  p := spin_wheel(k);
  assert p ->> 'label' in ('Free dessert', '₹50 off'), 'unexpected prize';
  assert spin_wheel(k) ->> 'label' = p ->> 'label', 'second spin gave a new prize';
  assert (table_state(k) -> 'bill' ->> 'total')::numeric = 876, 'spin replaced the coupon';

  -- split three ways: 292 each. Claims can't add up to more than what is due.
  perform pg_temp.fails_with(format('select request_payment(%L, 877, 0, %L)', k, 'upi'), 'over_due');
  perform pg_temp.fails_with(format('select request_payment(%L, 100, 101, %L)', k, 'upi'), 'bad_tip');
  perform pg_temp.fails_with(format('select request_payment(%L, 100, 0, %L)', k, 'bitcoin'), 'bad_mode');
  perform request_payment(k, 292, 29, 'upi', 'Riya', 'equal');
  perform request_payment(k, 292, 0, 'cash', 'Aman', 'equal');
  perform pg_temp.fails_with(format('select request_payment(%L, 293, 0, %L)', k, 'upi'), 'over_due');
  perform pg_temp.fails_with(format('select apply_coupon(%L, %L)', k, 'FLAT10'), 'already_paying');

  perform pg_temp.fails_with(format('select join_loyalty(%L, %L)', k, '12345'), 'bad_phone');
  assert (join_loyalty(k, '+91 98765 43210') ->> 'points')::int = 0, 'loyalty join failed';

  st := table_state(k);
  assert jsonb_array_length(st -> 'payments') = 2, 'payments not listed';
  assert (st -> 'bill' ->> 'pending')::numeric = 584 and (st -> 'bill' ->> 'paid')::numeric = 0, 'pending/paid wrong';
  assert st -> 'wifi' ->> 'ssid' = 'Cafe_Guest', 'wifi missing for a seated guest';
  assert (st -> 'loyalty' ->> 'phone_linked')::boolean and (st -> 'loyalty' ->> 'goal')::int = 200, 'loyalty state wrong';
  assert jsonb_array_length(st -> 'calls') = 1 and st -> 'calls' -> 0 ->> 'call_type' = 'water', 'call missing';
end $$;

reset role;

-- =====================================================================
-- Owner A: floor, kitchen, cashier
-- =====================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}', true);
set local role authenticated;

do $$
declare
  a uuid := pg_temp.g('a')::uuid; f jsonb; s jsonb; pay jsonb; b jsonb; st jsonb; n int;
begin
  f := floor_state(a);
  assert jsonb_array_length(f -> 'seatings') = 1, 'floor should show one live seating';
  s := f -> 'seatings' -> 0;
  assert (s -> 'bill' ->> 'total')::numeric = 876 and (s -> 'bill' ->> 'pending')::numeric = 584, 'floor bill wrong';
  assert jsonb_array_length(f -> 'calls') = 1, 'floor missing the water call';
  assert (select pin from dining_tables where restaurant_id = a and table_number = '7') ~ '^[0-9]{4}$', 'owner cannot see PIN';

  -- kitchen accepts the lassi; the guest can no longer take it back
  update orders set status = 'accepted' where id = pg_temp.g('lassi_order')::uuid;
  -- waiter acknowledges the call by name
  update service_calls set status = 'acknowledged', acknowledged_by = 'Rahul', acknowledged_at = now() where restaurant_id = a;

  for pay in select * from jsonb_array_elements(s -> 'payments') loop
    if pay ->> 'payer' = 'Riya' then perform pg_temp.put('pay_riya', pay ->> 'id'); else perform pg_temp.put('pay_aman', pay ->> 'id'); end if;
  end loop;
  b := staff_settle_payment(pg_temp.g('pay_riya')::uuid, true, 'Asha');
  assert (b ->> 'paid')::numeric = 292 and (b ->> 'due')::numeric = 584, 'confirm did not count';
  perform pg_temp.fails_with(format('select staff_settle_payment(%L, true)', pg_temp.g('pay_riya')), 'already_settled');
  perform pg_temp.fails_with(format('select staff_close_table(%L, %L)', a, '7'), 'money_due');
  -- Aman's ₹292 is still waiting for confirmation, so the counter can only take the other ₹292
  perform pg_temp.fails_with(format('select staff_add_payment(%L, %L, 300, %L)', a, '7', 'cash'), 'over_due');
  perform staff_settle_payment(pg_temp.g('pay_aman')::uuid, true, 'Asha');
  perform pg_temp.fails_with(format('select staff_add_payment(%L, %L, 293, %L)', a, '7', 'cash'), 'over_due');
  b := staff_add_payment(a, '7', 292, 'cash', 0, 'Asha');
  assert (b ->> 'due')::numeric = 0, 'last share did not clear the bill';

  -- paid in full: the bill closes itself, the table goes inactive and waits for cleaning, points land
  assert (select status from seatings where restaurant_id = a and table_number = '7') = 'closed', 'seating not closed';
  assert (select not is_active and needs_cleaning from dining_tables where restaurant_id = a and table_number = '7'), 'table not deactivated';
  assert (select points from loyalty_members where restaurant_id = a and phone = '9876543210') = 87, 'loyalty points not 87';
  select count(*) into n from activity_log where restaurant_id = a and action in ('payment_confirmed', 'payment_taken', 'bill_closed');
  assert n = 4, 'activity log incomplete: ' || n;
  perform staff_mark_clean(a, '7', 'Asha');
  assert (select not needs_cleaning from dining_tables where restaurant_id = a and table_number = '7'), 'table not cleaned';
end $$;

reset role;
set local role anon;

do $$
declare k text := pg_temp.g('key7'); st jsonb;
begin
  -- the receipt and review still load after the bill closes, but nothing new can be ordered on it
  st := table_state(k);
  assert (st ->> 'ok')::boolean and st ->> 'status' = 'closed' and (st -> 'bill' ->> 'paid')::numeric = 876, 'receipt not available';
  assert st ->> 'served_by' = 'Rahul', 'waiter name missing for the thank-you';
  perform pg_temp.fails_with(format('select place_order(%L, %L)', k, jsonb_build_array(jsonb_build_object('id', pg_temp.g('paneer')))), 'seat_closed');
  perform pg_temp.fails_with(format('select call_staff(%L, %L)', k, 'water'), 'seat_closed');
  -- the number was linked before the bill closed: asking again on the receipt changes nothing
  assert (join_loyalty(k, '9123456789') ->> 'points')::int = 87, 'receipt re-link changed the points';
  -- a new scan at the same table starts a fresh bill
  assert join_table(pg_temp.g('a')::uuid, '7') ->> 'key' <> k, 'closed seating reused';
end $$;

reset role;

-- =====================================================================
-- PIN restaurant: inactive tables and wrong PINs never reach the kitchen
-- =====================================================================
update restaurants set require_table_pin = true where id = pg_temp.g('a')::uuid;
-- the fresh table-7 seating from the scan above is a no-PIN leftover; close it like staff would
update seatings set status = 'closed', closed_at = now() where restaurant_id = pg_temp.g('a')::uuid and status = 'open';
update dining_tables set is_active = false where restaurant_id = pg_temp.g('a')::uuid;

set local role anon;
do $$
declare a uuid := pg_temp.g('a')::uuid;
begin
  assert join_table(a, '3', '1234') ->> 'error' = 'inactive', 'unopened table accepted a PIN';
  assert join_table(a, '7', null) ->> 'error' = 'inactive', 'closed table took a guest';
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare a uuid := pg_temp.g('a')::uuid; t jsonb;
begin
  t := staff_open_table(a, '3', 'Rahul');
  assert t ->> 'pin' ~ '^[0-9]{4}$', 'no PIN on open';
  perform pg_temp.put('pin3', t ->> 'pin');
  perform staff_open_table(a, '5', 'Rahul');
end $$;
reset role;

set local role anon;
do $$
declare a uuid := pg_temp.g('a')::uuid; wrong text := lpad(((pg_temp.g('pin3')::int + 1) % 10000)::text, 4, '0'); j jsonb; i int;
begin
  j := join_table(a, '3', wrong);
  assert j ->> 'error' = 'bad_pin' and (j ->> 'tries_left')::int = 4, 'wrong PIN not refused: ' || j::text;
  for i in 1..3 loop perform join_table(a, '3', wrong); end loop;
  assert join_table(a, '3', wrong) ->> 'error' = 'locked', 'fifth wrong PIN did not lock';
  assert join_table(a, '3', pg_temp.g('pin3')) ->> 'error' = 'locked', 'correct PIN worked while locked';
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}', true);
set local role authenticated;
do $$ begin
  assert staff_set_pin(pg_temp.g('a')::uuid, '3', '4321', 'Rahul') = '4321', 'PIN change failed';
  perform pg_temp.fails_with(format('select staff_set_pin(%L, %L, %L)', pg_temp.g('a'), '3', '12'), 'bad_pin');
end $$;
reset role;

set local role anon;
do $$
declare a uuid := pg_temp.g('a')::uuid; j jsonb; o jsonb;
begin
  j := join_table(a, '3', '4321');
  assert (j ->> 'ok')::boolean, 'new PIN refused: ' || j::text;
  perform pg_temp.put('key3', j ->> 'key');
  o := place_order(j ->> 'key', jsonb_build_array(jsonb_build_object('id', pg_temp.g('paneer'))));
  assert (o ->> 'verified')::boolean, 'PIN order not marked verified';
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}', true);
set local role authenticated;
select pg_temp.put('pin5', (select pin from dining_tables where restaurant_id = pg_temp.g('a')::uuid and table_number = '5'));
reset role;

set local role anon;
do $$
declare j jsonb;
begin
  j := join_table(pg_temp.g('a')::uuid, '5', pg_temp.g('pin5'));
  assert (j ->> 'ok')::boolean, 'table 5 join failed';
  perform pg_temp.put('key5', j ->> 'key');
  perform place_order(j ->> 'key', jsonb_build_array(jsonb_build_object('id', pg_temp.g('naan'), 'qty', 2)));
end $$;
reset role;

-- Move table 3 to 9, then merge 5 into 9; finally a different owner tries to touch any of it
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare a uuid := pg_temp.g('a')::uuid;
begin
  perform staff_transfer_table(a, '3', '9', 'Rahul');
  perform pg_temp.fails_with(format('select staff_transfer_table(%L, %L, %L)', a, '9', '5'), 'table_busy');
  assert (select is_active from dining_tables where restaurant_id = a and table_number = '9'), 'target table not active';
  assert (select not is_active from dining_tables where restaurant_id = a and table_number = '3'), 'old table still active';
  assert not exists (select 1 from orders where restaurant_id = a and table_number = '3' and seating_id is not null
                     and seating_id in (select id from seatings where status = 'open')), 'orders left on the old table';
  perform staff_merge_tables(a, '5', '9', 'Rahul');
end $$;
reset role;

set local role anon;
do $$
declare st jsonb; o jsonb;
begin
  st := table_state(pg_temp.g('key3'));
  assert st ->> 'table' = '9', 'moved guests still see the old table';
  st := table_state(pg_temp.g('key5'));
  assert st ->> 'table' = '5' and st ->> 'bill_table' = '9', 'merged guests lost their table';
  assert (st -> 'bill' ->> 'subtotal')::numeric = 249 + 120, 'merged bill missing orders: ' || (st -> 'bill')::text;
  o := place_order(pg_temp.g('key5'), jsonb_build_array(jsonb_build_object('id', pg_temp.g('paneer'))));
  assert o ->> 'table_number' = '5', 'merged guest''s food goes to the wrong table';
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000b001", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare a uuid := pg_temp.g('a')::uuid;
begin
  begin perform floor_state(a); assert false, 'owner B read A''s floor'; exception when insufficient_privilege then null; end;
  begin perform staff_open_table(a, '1'); assert false, 'owner B opened A''s table'; exception when insufficient_privilege then null; end;
  begin perform staff_close_table(a, '9', null, 'x'); assert false, 'owner B closed A''s bill'; exception when insufficient_privilege then null; end;
  begin perform staff_settle_payment(pg_temp.g('pay_riya')::uuid, true); assert false, 'owner B settled A''s payment'; exception when insufficient_privilege then null; end;
  perform 1 from seatings where restaurant_id = a;
  assert not found, 'owner B sees A''s seatings';
  perform 1 from payments where restaurant_id = a;
  assert not found, 'owner B sees A''s payments';
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare a uuid := pg_temp.g('a')::uuid; m jsonb;
begin
  -- closing with money due needs a reason; then both merged tables free up
  perform staff_close_table(a, '9', 'Asha', 'Paid at the counter machine');
  assert (select count(*) from seatings where restaurant_id = a and status <> 'closed') = 0, 'merged seating left open';
  assert (select count(*) from dining_tables where restaurant_id = a and table_number in ('5', '9') and not is_active) = 2, 'merged tables still active';
  -- a guest who adds their number on the receipt (after the bill closed) still gets the visit, once
end $$;
reset role;
set local role anon;
do $$
begin
  perform join_loyalty(pg_temp.g('key3'), '9123456789');
  perform join_loyalty(pg_temp.g('key3'), '9123456789');
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare a uuid := pg_temp.g('a')::uuid; m jsonb;
begin
  assert (select visits from loyalty_members where restaurant_id = a and phone = '9123456789') = 1, 'receipt loyalty not credited exactly once';

  -- staff PINs: hashed, unique, unlock tells us who is on shift
  perform save_staff(a, null, 'Rahul', 'waiter', '1111');
  perform pg_temp.fails_with(format('select save_staff(%L, null, %L, %L, %L)', a, 'Asha', 'cashier', '1111'), 'pin_taken');
  perform save_staff(a, null, 'Asha', 'cashier', '2222');
  m := staff_unlock(a, '2222');
  assert m ->> 'name' = 'Asha' and m ->> 'role' = 'cashier', 'unlock returned the wrong person';
  assert staff_unlock(a, '9999') is null, 'unknown PIN unlocked';
  begin perform pin_hash from staff; assert false, 'owner can read PIN hashes'; exception when insufficient_privilege then null; end;
  assert exists (select 1 from activity_log where restaurant_id = a and action = 'shift_started' and staff_name = 'Asha'), 'shift not logged';
  assert exists (select 1 from activity_log where restaurant_id = a and action = 'bill_closed_unpaid'), 'unpaid close not logged';
  assert exists (select 1 from activity_log where restaurant_id = a and action = 'tables_merged'), 'merge not logged';
  begin
    insert into activity_log (restaurant_id, action) values (pg_temp.g('b')::uuid, 'fake');
    assert false, 'owner A wrote to B''s log';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'ALL CHECKS PASSED' as result;
rollback;
