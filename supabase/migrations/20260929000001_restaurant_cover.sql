-- Cover photo shown behind the restaurant name on the public menu (owners upload it in Settings)
alter table public.restaurants add column cover_url text;
grant update (cover_url) on public.restaurants to authenticated;
