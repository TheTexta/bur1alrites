with ranked as (
  select id, row_number() over (order by sort_order, created_at, id) - 1 as position
  from public.gallery_items
)
update public.gallery_items
set sort_order = ranked.position
from ranked
where gallery_items.id = ranked.id;

create or replace function public.create_gallery_item(
  item_slug text,
  item_extension text,
  item_width integer,
  item_height integer,
  item_title text,
  item_client text,
  item_type text,
  item_year text
)
returns setof public.gallery_items
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('gallery_items_order'));

  return query
  insert into public.gallery_items (
    slug, extension, width, height, title, client, type, year, status, sort_order
  )
  values (
    item_slug,
    item_extension,
    item_width,
    item_height,
    item_title,
    item_client,
    item_type,
    item_year,
    'processing',
    coalesce((select max(gallery_items.sort_order) + 1 from public.gallery_items), 0)
  )
  returning *;
end;
$$;

revoke all on function public.create_gallery_item(text, text, integer, integer, text, text, text, text) from public;
grant execute on function public.create_gallery_item(text, text, integer, integer, text, text, text, text) to service_role;

create or replace function public.move_gallery_item(item_slug text, direction text)
returns setof public.gallery_items
language plpgsql
security definer
set search_path = public
as $$
declare
  current_position bigint;
  neighbor_slug text;
begin
  if direction not in ('up', 'down') then
    raise exception 'Invalid gallery move direction';
  end if;

  perform pg_advisory_xact_lock(hashtext('gallery_items_order'));

  with ranked as (
    select id, row_number() over (order by sort_order, created_at, id) - 1 as position
    from public.gallery_items
  )
  update public.gallery_items
  set sort_order = ranked.position
  from ranked
  where gallery_items.id = ranked.id;

  select position into current_position
  from (
    select slug, row_number() over (order by sort_order, created_at, id) as position
    from public.gallery_items
  ) ordered_items
  where slug = item_slug;

  if current_position is null then
    raise exception 'Gallery item not found';
  end if;

  select slug into neighbor_slug
  from (
    select slug, row_number() over (order by sort_order, created_at, id) as position
    from public.gallery_items
  ) ordered_items
  where position = current_position + case when direction = 'up' then -1 else 1 end;

  if neighbor_slug is not null then
    update public.gallery_items
    set sort_order = case
      when slug = item_slug then current_position + case when direction = 'up' then -2 else 0 end
      when slug = neighbor_slug then current_position + case when direction = 'up' then -1 else -1 end
    end
    where slug in (item_slug, neighbor_slug);
  end if;

  return query
  select * from public.gallery_items
  order by sort_order, created_at, id;
end;
$$;

revoke all on function public.move_gallery_item(text, text) from public;
grant execute on function public.move_gallery_item(text, text) to service_role;