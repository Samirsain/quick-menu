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
insert into menu_items (restaurant_id, name, price) select rest_a, 'Chai', 30 from t;

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

  -- orders and staff calls go through the table (join_table -> place_order / call_staff), never straight into the tables
  begin
    insert into orders (restaurant_id, table_number, items, order_number, status) values (r, '7', '{}', 'T2', 'completed');
    assert false, 'guest inserted an order directly';
  exception when insufficient_privilege then null; end;
  o := (place_order(join_table(r, '7') ->> 'key',
        jsonb_build_array(jsonb_build_object('id', (select id from menu_items where restaurant_id = r limit 1)))) ->> 'id')::uuid;
  assert o is not null, 'guest could not place order';

  -- cannot change an order's status
  update orders set status = 'completed' where id = o;
  assert not found, 'guest updated an order';

  -- can call staff and leave feedback
  perform call_staff(join_table(r, '7') ->> 'key', 'water');
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

  -- owner contact details are private
  begin
    perform email from restaurants where id = r;
    assert false, 'guest can read owner email';
  exception when insufficient_privilege then null; end;
  begin
    perform user_id from restaurants where id = r;
    assert false, 'guest can read owner user_id';
  exception when insufficient_privilege then null; end;

  -- admin login rejects unknown admins, and admin calls need a real session token
  assert not verify_admin_password('nobody@test.local', 'whatever'), 'unknown admin accepted';
  assert admin_login('nobody@test.local', 'whatever') is null, 'unknown admin got a session';
  begin
    perform toggle_restaurant_status(r, false, 'not-a-token');
    assert false, 'non-admin toggled a restaurant';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from admin_list_restaurants('not-a-token');
    assert false, 'non-admin listed restaurant emails';
  exception when insufficient_privilege then null; end;
  perform 1 from admin_actions_log;
  assert not found, 'guest can read the admin log';
  begin
    insert into admin_actions_log (admin_email, action_type) values ('x', 'fake');
    assert false, 'guest wrote to the admin log';
  exception when insufficient_privilege then null; end;
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

  -- finds own restaurant by user_id, but cannot read anyone's email
  perform 1 from restaurants where user_id = '00000000-0000-4000-8000-00000000a001';
  assert found, 'owner cannot look up own restaurant';
  begin
    perform email from restaurants where id = b;
    assert false, 'owner can read another owner''s email';
  exception when insufficient_privilege then null; end;
end $$;

reset role;

-- ---------- admin ----------
insert into admin_users (email, password_hash) values ('admin@test.local', extensions.crypt('correct-horse', extensions.gen_salt('bf')));
set local role anon;
do $$
declare tok text;
begin
  assert verify_admin_password('admin@test.local', 'correct-horse'), 'admin password rejected';
  assert admin_login('admin@test.local', 'wrong') is null, 'wrong admin password got a session';
  tok := admin_login('admin@test.local', 'correct-horse');
  assert tok is not null, 'admin could not log in';
  assert (select count(*) from admin_list_restaurants(tok) where email like 'owner-%@test.local') = 2, 'admin cannot list restaurants with emails';
  begin
    perform toggle_restaurant_status((select rest_b from t), false, 'admin@test.local');
    assert false, 'admin email accepted in place of a session token';
  exception when insufficient_privilege then null; end;
  assert toggle_restaurant_status((select rest_b from t), false, tok), 'admin could not disable restaurant';
  perform admin_logout(tok);
  begin
    perform 1 from admin_list_restaurants(tok);
    assert false, 'session still works after logout';
  exception when insufficient_privilege then null; end;
  assert not update_admin_password('admin@test.local', 'wrong', 'new-password-123'), 'password changed with wrong current password';
  assert update_admin_password('admin@test.local', 'correct-horse', 'new-password-123'), 'admin could not change password';
  assert verify_admin_password('admin@test.local', 'new-password-123'), 'new admin password not accepted';
end $$;

-- a disabled restaurant takes no orders or staff calls
do $$ begin
  assert join_table((select rest_b from t), '1') ->> 'error' = 'unavailable', 'disabled restaurant seated a guest';
end $$;
reset role;

select 'ALL CHECKS PASSED' as result;
rollback;
