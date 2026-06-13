-- Tasks feature: track each profile's currently-active task so /subtask targets
-- the right parent without an ephemeral session store.
alter table profiles
  add column active_task_id uuid references tasks(id) on delete set null;
