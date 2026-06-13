alter table calendar_events
  add column if not exists google_etag text,
  add column if not exists google_updated_at timestamptz,
  add column if not exists html_link text;

alter table oauth_states
  add column if not exists intent text;
