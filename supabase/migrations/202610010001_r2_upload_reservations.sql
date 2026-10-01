-- A durable owner makes multipart completion retries safe across server instances.
alter table public.gallery_items add column if not exists upload_session_id uuid unique;

create or replace function public.reserve_gallery_upload(session_id uuid, item jsonb)
returns setof public.gallery_items
language plpgsql security definer set search_path = public
as $$
declare existing public.gallery_items;
begin
  perform pg_advisory_xact_lock(hashtext('gallery_items_order'));
  select * into existing from public.gallery_items where slug = item->>'slug';
  if found then
    if existing.upload_session_id is distinct from session_id then
      raise unique_violation using message = 'A clip with that slug already exists.';
    end if;
    return next existing;
    return;
  end if;
  return query
  insert into public.gallery_items (slug, extension, width, height, title, client, type, year, status, sort_order, upload_session_id)
  values (item->>'slug', item->>'extension', (item->>'width')::integer, (item->>'height')::integer,
    item->>'title', item->>'client', item->>'type', item->>'year', 'processing',
    coalesce((select max(sort_order) + 1 from public.gallery_items), 0), session_id)
  returning *;
end;
$$;

revoke all on function public.reserve_gallery_upload(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_gallery_upload(uuid, jsonb) to service_role;
notify pgrst, 'reload schema';
