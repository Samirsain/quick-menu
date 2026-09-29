-- Security self-check for the QuickMenu schema. Changes nothing: everything runs in a rolled-back transaction.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_check.sql
-- Prints "ALL CHECKS PASSED" or stops at the first failing check.

begin;

-- Two owners sign up: the trigger must create their restaurants
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000a001', 'owner-a@test.local', '{"name": "Cafe A", "description": "Test"}'),
  ('00000000-0000-4000-8000-00000000b001', 'owner-b@test.local', '{"name": "Cafe B"}');

create temp table t as
  select (select id from restaurants where user_id = '00000000-0000-4000-8000-00000000a001') as rest_a,
         (select id from restaurants where user_id = '00000000-0000-4000-8000-00000000b001') as rest_b;
grant select on t to anon, authenticated;

do $$ begin
  assert (select count(*) from restaurants r join t on r.id in (t.rest_a, t.rest_b)) = 2, 'signup trigger did not create restaurants';
  assert (select name from restaurants where id = (select rest_a from t)) = 'Cafe A', 'restaurant name not taken from signup';
  assert (select count(*) from menu_views mv join t on mv.restaurant_id in (t.rest_a, t.rest_b)) = 2, 'menu_views row missing';
end $$;

-- ---------- guest (anon) ----------
set local role anon;

do $$
declare r uuid := (select rest_a from t); o uuid; s uuid; v record;
begin
  -- can read the menu
  perform 1 from restaurants where id = r;
  assert found, 'guest cannot read restaurant';

  -- can place an order and read it back
  insert into orders (restaurant_id, table_number, items, order_number) values (r, '7', '{"items": []}', 'T1') returning id into o;
  assert o is not null, 'guest could not place order';

  -- cannot place an order already marked completed
  begin
    insert into orders (restaurant_id, table_number, items, order_number, status) values (r, '7', '{}', 'T2', 'completed');
    assert false, 'guest inserted a non-pending order';
  exception when insufficient_privilege or check_violation then null; end;

  -- cannot change an order's status
  update orders set status = 'completed' where id = o;
  assert not found, 'guest updated an order';

  -- can call staff and leave feedback
  insert into service_calls (restaurant_id, table_number, call_type) values (r, '7', 'water');
  insert into feedback (restaurant_id, order_id, rating) values (r, o, 5);

  -- can bump the view counter, but not other menu_views columns
  update menu_views set view_count = view_count + 1 where restaurant_id = r;
  assert found, 'guest could not bump view count';
  begin
    update menu_views set restaurant_id = (select rest_b from t) where restaurant_id = r;
    assert false, 'guest changed menu_views.restaurant_id';
  exception when insufficient_privilege then null; end;

  -- cannot edit restaurants or menus
  begin
    update restaurants set name = 'hacked' where id = r;
    assert false, 'guest updated a restaurant';
  exception when insufficient_privilege then null; end;
  begin
    insert into menu_items (restaurant_id, name, price) values (r, 'x', 1);
    assert false, 'guest added a menu item';
  exception when insufficient_privilege then null; end;

  -- cannot read owner-only data
  perform 1 from admin_users;
  assert not found, 'guest can read admin_users';
  perform 1 from feedback;
  assert not found, 'guest can read feedback';

  -- menu sessions work end to end
  s := create_menu_session(r, '7', 'fp');
  select * into v from validate_menu_session(s::text);
  assert v.is_valid and v.remaining_minutes between 230 and 240, 'fresh session not valid';
  select * into v from validate_menu_session('not-a-uuid');
  assert not v.is_valid, 'garbage session id accepted';

  -- admin login rejects unknown admins
  assert not verify_admin_password('nobody@test.local', 'whatever'), 'unknown admin accepted';
  begin
    perform toggle_restaurant_status(r, false, 'nobody@test.local');
    assert false, 'non-admin toggled a restaurant';
  exception when raise_exception then null; end;
end $$;

reset role;

-- ---------- owner A (authenticated) ----------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}', true);
set local role authenticated;

do $$
declare a uuid := (select rest_a from t); b uuid := (select rest_b from t); c uuid;
begin
  -- manages own restaurant and menu
  update restaurants set name = 'Cafe A2', orders_enabled = true where id = a;
  assert found, 'owner could not update own restaurant';
  insert into menu_categories (restaurant_id, name) values (a, 'Starters') returning id into c;
  insert into menu_items (restaurant_id, category_id, name, price) values (a, c, 'Samosa', 90);
  assert (update_table_config(a, 'per_table', '{"total": 5, "skip": [], "disabled": [], "custom_labels": {}}'))->>'success' = 'true', 'owner could not save table config';

  -- sees and updates own orders, feedback, service calls
  perform 1 from feedback where restaurant_id = a;
  assert found, 'owner cannot see own feedback';
  update orders set status = 'accepted' where restaurant_id = a;
  assert found, 'owner could not update own orders';
  update service_calls set status = 'acknowledged' where restaurant_id = a;
  assert found, 'owner could not update own service calls';

  -- cannot re-enable itself or touch another restaurant
  begin
    update restaurants set is_active = true where id = a;
    assert false, 'owner changed is_active';
  exception when insufficient_privilege then null; end;
  update restaurants set name = 'hacked' where id = b;
  assert not found, 'owner updated another restaurant';
  begin
    insert into menu_items (restaurant_id, name, price) values (b, 'x', 1);
    assert false, 'owner added item to another restaurant';
  exception when insufficient_privilege then null; end;
  assert (update_table_config(b, 'single', '{}'))->>'success' = 'false', 'owner changed another restaurant''s table config';
end $$;

reset role;

-- ---------- admin ----------
insert into admin_users (email, password_hash) values ('admin@test.local', extensions.crypt('correct-horse', extensions.gen_salt('bf')));
set local role anon;
do $$ begin
  assert verify_admin_password('admin@test.local', 'correct-horse'), 'admin password rejected';
  assert not verify_admin_password('admin@test.local', 'wrong'), 'wrong admin password accepted';
  assert toggle_restaurant_status((select rest_b from t), false, 'admin@test.local'), 'admin could not disable restaurant';
  assert not update_admin_password('admin@test.local', 'wrong', 'new-password-123'), 'password changed with wrong current password';
  assert update_admin_password('admin@test.local', 'correct-horse', 'new-password-123'), 'admin could not change password';
  assert verify_admin_password('admin@test.local', 'new-password-123'), 'new admin password not accepted';
end $$;

-- a disabled restaurant takes no orders or staff calls
do $$ begin
  begin
    insert into orders (restaurant_id, table_number, items, order_number) values ((select rest_b from t), '1', '{}', 'X');
    assert false, 'disabled restaurant accepted an order';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'ALL CHECKS PASSED' as result;
rollback;
