-- Expand staged admin uploads to MP4 while preserving the existing MOV access.
drop policy if exists "Portfolio admins can upload staged MOVs" on storage.objects;
drop policy if exists "Portfolio admins can read staged MOV metadata" on storage.objects;
drop policy if exists "Portfolio admins can upload staged videos" on storage.objects;
drop policy if exists "Portfolio admins can read staged video metadata" on storage.objects;

create policy "Portfolio admins can upload staged videos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'bur1alrites'
    and name ~ '^portfolio-images/incoming/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](mov|mp4)$'
    and ((select auth.jwt()) -> 'app_metadata' ->> 'bur1alrites_admin') = 'true'
  );

create policy "Portfolio admins can read staged video metadata"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'bur1alrites'
    and name ~ '^portfolio-images/incoming/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](mov|mp4)$'
    and ((select auth.jwt()) -> 'app_metadata' ->> 'bur1alrites_admin') = 'true'
  );
