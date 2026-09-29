-- The browser sends an authenticated admin JWT with each signed TUS upload.
-- Storage still checks the caller's INSERT policy for the staged object.
drop policy if exists "Portfolio admins can upload staged MOVs" on storage.objects;

create policy "Portfolio admins can upload staged MOVs"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'bur1alrites'
    and name ~ '^portfolio-images/incoming/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]mov$'
    and ((select auth.jwt()) -> 'app_metadata' ->> 'bur1alrites_admin') = 'true'
  );

-- Storage returns the inserted row's metadata as part of the upload response.
drop policy if exists "Portfolio admins can read staged MOV metadata" on storage.objects;

create policy "Portfolio admins can read staged MOV metadata"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'bur1alrites'
    and name ~ '^portfolio-images/incoming/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]mov$'
    and ((select auth.jwt()) -> 'app_metadata' ->> 'bur1alrites_admin') = 'true'
  );
