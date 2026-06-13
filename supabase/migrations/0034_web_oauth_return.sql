-- Let the standalone web app initiate the existing Google OAuth flow and
-- return to the PWA after authorization. Telegram flows keep using chat_id.

alter table oauth_states
  alter column chat_id drop not null,
  add column if not exists return_url text;
