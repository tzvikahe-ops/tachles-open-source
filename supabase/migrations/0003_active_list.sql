-- Lists feature: track each profile's currently-active list so dictated/added
-- items have a target without an ephemeral session store.
alter table profiles
  add column active_list_id uuid references lists(id) on delete set null;
