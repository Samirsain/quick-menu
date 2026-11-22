-- Admin panel security.
-- Before: the browser said "I am admin X" and toggle_restaurant_status trusted that email, and owner emails
-- were readable by anyone holding the public key (the admin list needed them).
-- Now: admin_login checks the password and hands out a random session token; every admin call needs a live
-- token, and restaurants.email / phone / user_id are no longer readable through the public API.

create table public.admin_sessions (
  token_hash text primary key,                       -- sha256 of the token; the token itself is never stored
  email text not null references public.admin_users (email) on delete cascade,
  expires_at timestamptz not null default now() + interval '2 hours'
);
alter table public.admin_sessions enable row level security; -- no policies: only the functions below touch it
revoke all on public.admin_sessions from anon, authenticated;

create function public.admin_session_email(p_token text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select email from admin_sessions
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and expires_at > now();
$$;
revoke execute on function public.admin_session_email(text) from public, anon, authenticated;

create function public.admin_login(p_email text, p_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text;
begin
  if not public.verify_admin_password(p_email, p_password) then
    return null;
  end if;
  delete from admin_sessions where expires_at < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into admin_sessions (token_hash, email) values (encode(extensions.digest(v_token, 'sha256'), 'hex'), lower(trim(p_email)));
  insert into admin_actions_log (admin_email, action_type, details) values (lower(trim(p_email)), 'login', '{}');
  return v_token;
end;
$$;

create function public.admin_logout(p_token text)
returns void language sql security definer set search_path = public, extensions as $$
  delete from admin_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

create function public.admin_list_restaurants(p_token text)
returns table (id uuid, name text, email text, phone text, is_active boolean, created_at timestamptz, logo_url text, user_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.admin_session_email(p_token) is null then
    raise exception 'Not an admin' using errcode = '42501';
  end if;
  return query select r.id, r.name, r.email, r.phone, r.is_active, r.created_at, r.logo_url, r.user_id
               from restaurants r order by r.created_at desc;
end;
$$;

drop function public.toggle_restaurant_status(uuid, boolean, text);
create function public.toggle_restaurant_status(p_restaurant_id uuid, p_is_active boolean, p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_email text := public.admin_session_email(p_token);
begin
  if v_email is null then
    raise exception 'Not an admin' using errcode = '42501';
  end if;
  update restaurants set is_active = p_is_active where id = p_restaurant_id;
  if not found then
    return false;
  end if;
  insert into admin_actions_log (admin_email, action_type, restaurant_id, details)
  values (v_email, case when p_is_active then 'restaurant_enabled' else 'restaurant_disabled' end,
          p_restaurant_id, jsonb_build_object('is_active', p_is_active));
  return true;
end;
$$;

-- Password changes are logged here too, so the browser no longer needs to write to the log
create or replace function public.update_admin_password(p_email text, p_current_password text, p_new_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(p_new_password) < 8 or not public.verify_admin_password(p_email, p_current_password) then
    return false;
  end if;
  update admin_users set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')), updated_at = now()
  where email = lower(trim(p_email));
  insert into admin_actions_log (admin_email, action_type, details) values (lower(trim(p_email)), 'password_changed', '{}');
  return true;
end;
$$;

-- Anyone could append fake entries to the admin log; only the functions above write to it now
drop policy "Admin panel appends log" on public.admin_actions_log;

-- Owner contact details stay private. Guests get the public menu columns; signed-in owners also get user_id
-- (they look up their own restaurant by it). The admin list reads email/phone through admin_list_restaurants.
-- ponytail: column allow-list, so a new restaurants column must be added to these grants to be readable.
revoke select on public.restaurants from anon, authenticated;
grant select (id, name, description, logo_url, cover_url, qr_code_url, social_links, upi_id, business_type, qr_mode,
              table_config, orders_enabled, waiter_call_enabled, is_active, created_at, updated_at)
  on public.restaurants to anon;
grant select (id, user_id, name, description, logo_url, cover_url, qr_code_url, social_links, upi_id, business_type, qr_mode,
              table_config, orders_enabled, waiter_call_enabled, is_active, created_at, updated_at)
  on public.restaurants to authenticated;
