-- These SECURITY DEFINER RPCs write gallery data without checking the caller.
-- Application requests use service_role after their own admin authorization.
-- Revoking PUBLIC alone is insufficient when anon/authenticated have direct grants.
-- Run as the function owner (supabase_admin) or a role that can change its grants;
-- a non-owner may print REVOKE warnings without changing effective permissions.
revoke all on function public.create_gallery_item(text, text, integer, integer, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.move_gallery_item(text, text)
  from public, anon, authenticated;

grant execute on function public.create_gallery_item(text, text, integer, integer, text, text, text, text)
  to service_role;
grant execute on function public.move_gallery_item(text, text)
  to service_role;

-- Abort the transaction if either public role still has effective access, or
-- the service-role path needed by the application has been lost.
do $$
begin
  if has_function_privilege('anon', 'public.create_gallery_item(text, text, integer, integer, text, text, text, text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.create_gallery_item(text, text, integer, integer, text, text, text, text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.move_gallery_item(text, text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.move_gallery_item(text, text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.create_gallery_item(text, text, integer, integer, text, text, text, text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.move_gallery_item(text, text)', 'EXECUTE') then
    raise exception 'Gallery RPC execution privileges remain unsafe';
  end if;
end;
$$;

notify pgrst, 'reload schema';
