-- Phase 10.4: pinned bubbles. /pin marks a bubble as always-visible on the
-- user's /board. CoS context loader also pulls these as "user values / goals".
-- Partial index keeps the lookup cheap (max ~10 pinned per user).

alter table memory_bubbles
  add column if not exists pinned boolean not null default false;

create index if not exists memory_bubbles_pinned_idx
  on memory_bubbles (owner_id)
  where pinned = true;
