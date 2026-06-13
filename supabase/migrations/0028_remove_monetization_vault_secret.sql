-- Remove the obsolete Edge Function URL left in Supabase Vault.
do $$
begin
  delete from vault.secrets
  where name = 'subscription_tick_url';
exception
  when undefined_table or invalid_schema_name then
    null;
end
$$;
