# Self-hosting Tachles

This guide deploys an independent Tachles instance into your own accounts.

Telegram is optional. The standalone PWA supports email authentication, Push
reminders, tasks, memories, and projects. Google, AI, Obsidian, and Telegram can
be enabled separately.

## Requirements

- GitHub, Supabase, and Vercel accounts
- Deno 2.x, Node.js 22+, npm 10+
- Supabase CLI
- Anthropic API key for routing and project plans
- OpenAI API key for transcription, embeddings, and research
- A Google Cloud project for Google login, Calendar, or Drive

## Install

```powershell
git clone https://github.com/tzvikahe-ops/tachles-open-source.git
cd tachles-open-source
Copy-Item .env.example .env.local
Copy-Item apps/web-app/.env.example apps/web-app/.env
npm --prefix apps/web-app ci
```

Fill `.env.local` and never commit it.

## Supabase

Create a Supabase project and collect its project reference, database password,
project URL, and publishable key.

Set `apps/web-app/.env`:

```dotenv
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_API_BASE=https://PROJECT_REF.supabase.co/functions/v1/api-web
```

Generate independent random values for `DISPATCH_SECRET`,
`PROFILE_LINK_SECRET`, and, when Telegram is enabled,
`TELEGRAM_WEBHOOK_SECRET`.

Generate Web Push keys:

```powershell
npx --yes web-push generate-vapid-keys --json
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and a `VAPID_SUBJECT` mailto value.

## Deploy the PWA shell

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftzvikahe-ops%2Ftachles-open-source&root-directory=apps%2Fweb-app&env=VITE_SUPABASE_URL,VITE_SUPABASE_PUBLISHABLE_KEY,VITE_API_BASE)

Use `apps/web-app` as the root directory, Vite as the framework, `npm run build`
as the build command, and `dist` as the output directory. Add the three
`VITE_*` variables above, then set the assigned Vercel URL as `WEB_APP_URL` in
`.env.local`.

The shell may show a connection error until the backend deployment is complete.

## Access policy

By default, a self-hosted instance accepts every account that can sign in.
For a private instance, set a comma-separated allowlist:

```dotenv
WEB_ALLOWED_EMAILS=you@example.com
```

Leave it empty for a normal multi-user installation.

## Deploy the backend

On Windows, run:

```powershell
.\scripts\deploy-self-host.ps1 `
  -ProjectRef "PROJECT_REF" `
  -DatabasePassword "DATABASE_PASSWORD"
```

The script verifies prerequisites, links Supabase, applies migrations, uploads
non-empty secrets, deploys the PWA backend and scheduled functions, and writes
a temporary Vault SQL file.

Run this generated file in the Supabase SQL Editor:

`supabase/.temp/self-host-vault.sql`

It contains `DISPATCH_SECRET`. It is gitignored and should be deleted after use.

## Supabase Auth

In Authentication → URL Configuration, set the Vercel URL as the Site URL and
an allowed redirect URL. Enable the Email provider for magic links.
For more than light testing, configure custom SMTP instead of relying on
Supabase's built-in email quota.

For Google login, enable the Google provider in Supabase, create a Google OAuth
Web Client, and add this Supabase Auth callback to Google Cloud:

```text
https://PROJECT_REF.supabase.co/auth/v1/callback
```

## Google Calendar and Drive

Enable Google Calendar API and Google Drive API. Configure the OAuth consent
screen and add:

```text
https://PROJECT_REF.supabase.co/functions/v1/oauth-callback
```

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, and
`WEB_APP_URL`, then redeploy `oauth-callback`.

## Telegram, optional

Without Telegram, do not deploy `telegram-webhook` or the Telegram Mini App
`api` function.

To enable it, create a BotFather bot, fill the Telegram environment variables,
deploy both functions, configure the webhook secret, and run:

```powershell
deno run -A scripts/setup-telegram-ui.ts
```

## Verify

```powershell
deno task verify
npm --prefix apps/web-app run build
```

Then verify login, a reminder scheduled a few minutes ahead, Push activation
and test delivery, task and memory creation, and optional Google integrations.

## Security

- Never commit `.env` files, credentials, or generated Vault SQL.
- Restrict provider API keys and configure usage alerts.
- Use `WEB_ALLOWED_EMAILS` for private instances.
- Test migrations on a separate Supabase project before production upgrades.

## Common errors

- `account_not_allowed`: email is not in `WEB_ALLOWED_EMAILS`.
- `redirect_uri_mismatch`: Google OAuth callback is missing.
- `Unsupported provider`: Google is not enabled in Supabase Auth.
- Push registration fails: use HTTPS; install the PWA to the iPhone Home Screen.
- Reminders do not fire: check Vault URLs and `DISPATCH_SECRET`.
- CORS failure: `WEB_APP_URL` must exactly match the Vercel origin.
