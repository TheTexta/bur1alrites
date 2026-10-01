-- R2 now receives browser uploads. Keep Supabase originals readable for rollback,
-- but prevent old clients from adding/upserting sources during final reconciliation.
-- Restrictive policies leave other projects' permissive upload policies unchanged.
drop policy if exists "Pause legacy bur1alrites browser inserts" on storage.objects;
create policy "Pause legacy bur1alrites browser inserts"
  on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'bur1alrites');

drop policy if exists "Pause legacy bur1alrites browser updates" on storage.objects;
create policy "Pause legacy bur1alrites browser updates"
  on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'bur1alrites')
  with check (bucket_id <> 'bur1alrites');

-- Rollback: drop these two policies before restoring the Supabase upload app.
-- Original permissive policies and source objects are retained.
