# תכלס (Tachles)

[![CI](https://github.com/tzvikahe-ops/Tachles/actions/workflows/ci.yml/badge.svg)](https://github.com/tzvikahe-ops/Tachles/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

מחברת אישית חכמה בעברית, זמינה כאפליקציית PWA עצמאית וכבוט Telegram:

**אפליקציית PWA:** https://tachles-web.vercel.app

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftzvikahe-ops%2FTachles&root-directory=apps%2Fweb-app&env=VITE_SUPABASE_URL,VITE_SUPABASE_PUBLISHABLE_KEY,VITE_API_BASE)

**התקנה עצמית:** [מדריך בעברית](SELF_HOSTING.md) ·
[English guide](SELF_HOSTING.en.md)

- **המעיין (The Wellspring)** — שכבת ה_זיכרון_. ידע, השראה והרהורים כ"בועות זיכרון".
- **הגשר (The Bridge)** — שכבת ה_פעולה_. תזכורות, רשימות, לוחות זמנים ומשימות.

מעל שתי השכבות פועלת שכבת אינטליגנציה: סוכנים פרואקטיביים, מעקב בריאות, חילוץ עובדות,
תצלומי מצב יומיים, פרויקטים, תוכניות ביצוע, מחקר רשת ותכנון יום.

האפליקציה העצמאית היא הממשק הראשי החדש. הבוט ו-Telegram Mini App נשארים פעילים
כערוצי שימוש נוספים ועוברים דרך אותם שירותים ומסד נתונים.

ב־PWA אפשר להשתמש בלי להגדיר בוט Telegram: הזנה חופשית בטקסט או בקול, תזכורות
Push, יומן Google, משימות ותתי־משימות, רשימות, זיכרונות וקבצים, חילוץ פעולות
מתמונה, פרויקטים ותוכניות ביצוע, בריאות, סוכנים פרואקטיביים, חיפוש מקומי וב־Drive,
ציר זמן, תצלומי מצב, שיתוף בין חברים וסנכרון Obsidian.

הפרויקט מופץ כקוד פתוח וכל היכולות זמינות לכל משתמש, ללא תוכניות תשלום,
תקופת ניסיון או הגבלת פיצ'רים. שיתוף בין חברים הוא ממשק רב-המשתמשים היחיד בחשבון.

## על המאגר הפתוח

המאגר כולל את אפליקציית ה-PWA, קוד הבוט, פונקציות Supabase, מיגרציות ו-Telegram Mini App.
הוא אינו מעניק גישה לשירות המתארח של המתחזק ואינו כולל credentials, מידע ממשתמשים,
הגדרות BotFather או תשתית production.

אפשר להשתמש בפרויקט כבסיס לעוזר אישי משלכם תחת רישיון MIT. הפעלה מלאה דורשת חשבונות
Supabase ו-Vercel משלכם. Telegram אופציונלי; יכולות AI ו-Google דורשות מפתחות והגדרה
בחשבונות שלכם. ראו [SELF_HOSTING.md](SELF_HOSTING.md).

> זהו פרויקט קהילתי ללא התחייבות לזמינות, תמיכה או תאימות לאחור. אל תשתמשו בנתוני
> production בזמן פיתוח מקומי ואל תכניסו מפתחות אמיתיים ל-Git.

## טכנולוגיה

- **Runtime:** TypeScript + Deno, פריסה כ־**Supabase Edge Functions** (מבוסס webhook).
- **Backend:** Supabase — Postgres (+ `pgvector`, `pg_trgm`), Storage, Auth.
- **אפליקציה עצמאית:** React 19 + Vite, ממשק RTL, PWA ו-Web Share Target; פריסה ב-Vercel.
- **הזדהות:** Supabase Auth עם Google או magic link, וקישור אופציונלי לפרופיל Telegram קיים.
- **תזמון:** `pg_cron` + `pg_net` מפעילים ארבע פונקציות מתוזמנות (תזכורות / יומן / סוכנים / תצלומים).
- **פענוח עברית (כוונה, תאריכים, חילוץ):** Anthropic Claude עם structured tool-use, כולל Claude Vision
  ל-OCR ולחילוץ פעולות מתמונות.
- **חיפוש:** trigram (`pg_trgm`) + חיפוש סמנטי (embeddings של OpenAI ב-`pgvector`).
- **קול:** תמלול הקלטות דרך OpenAI.
- **חזרתיות:** מחרוזות `RRULE` (iCal) עם `rrule.js`, מעוגנות לשעת קיר מקומית (תקין גם במעבר שעון/DST).
- **אינטגרציות Google:** OAuth, Calendar (קריאה+כתיבה), Drive (חיפוש + ייצוא Obsidian).

## ארכיטקטורה

```text
PWA (React)       --Bearer JWT-->  Edge Fn: api-web
Telegram Mini App --initData---->  Edge Fn: api
Telegram Bot      --webhook----->  Edge Fn: telegram-webhook
                                       |
                                       | שירותים משותפים:
                                       | Wellspring / Bridge / Projects /
                                       | Social / Integrations / Agents
                                       v
                            Supabase (Auth + Postgres +
                             pgvector + Storage)
                                       ^
  pg_cron + pg_net מפעילים פונקציות מתוזמנות:
    • dispatch-reminders  (כל דקה)    — יורה תזכורות שהגיע זמנן ל-Telegram ול-Web Push
    • sync-calendars      (כל ~30 ד׳) — מסנכרן Google Calendar אל calendar_events
    • agent-tick          (כל 15 ד׳)  — סוכנים פרואקטיביים, לפי cron בשעון המקומי של המשתמש
    • snapshot-daily      (יומי)       — תצלום מצב מצרפי לכל משתמש

  oauth-callback   — מקבל את ה-redirect של Google OAuth (פרוס עם --no-verify-jwt)
```

כל ערוצי השימוש עוטפים את אותם שירותי `_shared/`; אין שכפול של לוגיקה עסקית. הבעלות
נשמרת לפי `profiles.id`, והזהויות של Supabase ו-Telegram ממופות אליו דרך
`profile_identities`.

`telegram-webhook` עונה מהר ושולח תשובות דרך `sendMessage` נפרד. הפונקציות המתוזמנות מוגנות
ב-header secret (`DISPATCH_SECRET`). `dispatch-reminders` הוא idempotent — תופס תזכורת ע"י מעבר
`active -> firing`, כך שריצות חופפות לא ישלחו פעמיים; בכישלון שליחה הוא משחרר את התפיסה.

## מבנה הפרויקט

```
supabase/
  functions/
    _shared/
      telegram.ts        # עוטפי fetch ל-Telegram Bot API
      supabase.ts        # client עם service-role
      profiles.ts        # מיפוי telegram_user_id -> profile
      types.ts           # טיפוסי Telegram update
      router.ts          # LLM intent router (Claude, forced tool-use, 6 כוונות)
      llm.ts             # פענוח תזכורת מטקסט חופשי (Claude)
      transcription.ts   # תמלול הקלטות קוליות (OpenAI)
      rrule.ts           # בניית RRULE + nextOccurrence מעוגן-timezone (DST-safe)
      tz.ts              # עזרי timezone (localParts / utcForLocalWallTime / nextLocalTime)
      search.ts          # חיפוש משולב על פני בועות + רשימות + משימות (/find)
      events.ts          # יומן ביקורת (events) — מזין inbox/timeline/agents/conditional
      conditional_eval.ts# הערכת predicate לתזכורות מותנות
      snapshots.ts       # בניית/שמירת תצלום מצב יומי
      user_settings.ts   # העדפות לכל משתמש (סיכום יומי, Obsidian)
      bridge/
        reminders.ts            # תזכורות (יצירה/רשימה/ביטול/snooze)
        lists.ts                # רשימות (יצירה/הוספה/סימון/מחיקה)
        tasks.ts                # משימות, תזמון ומצב המתנה
        projects.ts             # פרויקטים ומאגרי ידע
        project_plans.ts        # הצעות תוכנית באישור המשתמש
        planner.ts              # תצוגה מקדימה לתכנון יום
        captures.ts             # תיבת קליטה ושיתוף מהנייד
        daily_summary_reminder.ts # ניהול תזכורת הסיכום היומי (recurring dynamic)
      wellspring/
        memories.ts        # בועות זיכרון (שמירה/חיפוש סמנטי+trigram/סיווג)
        file_capture.ts    # קליטת קובץ/תמונה -> OCR/סיכום -> בועה
      integrations/
        oauth.ts           # OAuth state + אחסון טוקנים
        google.ts          # Google OAuth + Calendar (יצירה/עדכון/מחיקה)
        calendar_sync.ts   # סנכרון אירועים -> calendar_events + פעולות על אירוע
        daily_summary.ts   # איסוף הקשר + חיבור הסיכום היומי ע"י Claude
        google_drive.ts    # חיפוש ב-Google Drive (/drive)
        drive_sync.ts      # פעולות קבצים ל-Drive (תשתית ל-Obsidian)
        obsidian.ts        # ייצוא בועות/משימות/סיכומים כ-markdown ל-Drive
        web_research.ts     # מחקר רשת עם תשובה ומקורות
        claude_vision.ts   # OCR / סיכום תמונות ו-PDF
        image_to_action.ts # תמונה + caption -> משימות/פריטי רשימה
        embeddings.ts      # OpenAI text-embedding-3-small
      social/
        friends.ts         # רשימת חברים (f2f_links)
        invites.ts         # קישורי הזמנה (deep-link)
        shares.ts          # שיתוף ברמת resource (list/task/bubble/reminder)
      agents/
        registry.ts        # רישום סוכנים, cronDue, טעינת פרופילים
        runner.ts          # מריץ סוכן: טוען הקשר -> Claude -> output policy
        chief_of_staff.ts  # סוכן "ראש המטה"
        anti_chaos.ts      # סוכן אנטי-כאוס
        health_intelligence.ts # קורלציות בריאות
        memory_agent.ts    # מענה ל-"מה אמרתי על X?" (טריגר מהמשתמש)
        fact_extractor.ts  # חילוץ עובדות מובנות (user_facts)
        timeline.ts        # סיכום נרטיבי של תקופה (/timeline)
      health/
        metrics.ts         # 8 מטריקות בריאות + תוויות/aliases בעברית
      init_data.ts       # אימות initData של Telegram Mini App (HMAC + auth_date)
    telegram-webhook/    # ה-router הראשי לעדכונים (כל הפקודות + callbacks)
    api/                 # REST ל-Mini App (אימות X-Telegram-InitData)
    api-web/             # REST ל-PWA (Supabase Auth + בעלות לפי profile)
    dispatch-reminders/  # cron כל דקה: יורה תזכורות שהגיע זמנן
    sync-calendars/      # cron ~30 ד׳: סנכרון Google Calendar
    agent-tick/          # cron כל 15 ד׳: סוכנים פרואקטיביים
    snapshot-daily/      # cron יומי: תצלום מצב לכל משתמש
    oauth-callback/      # redirect של Google OAuth (--no-verify-jwt)
  migrations/
    0001_init.sql              # סכמה + RLS + הרחבות (vector, pg_trgm)
    0002_cron.sql              # pg_cron + pg_net ל-dispatch-reminders
    0003_active_list.sql       # רשימה פעילה לכל משתמש
    0004_active_task.sql       # משימה פעילה לכל משתמש
    0005_calendar_sync.sql     # oauth_states, calendar_events, user_settings
    0006_sync_calendars_cron.sql # cron לסנכרון יומן
    0007_memory_vault.sql      # ארגז זיכרון: storage + embeddings + match_bubbles
    0008_sharing.sql           # invites + shares (Phase 4)
    0009_obsidian.sql          # מצב Obsidian + מיפוי קבצים ב-Drive
    0010_event_log.sql         # טבלת events (תשתית Phase 6)
    0011_user_facts.sql        # עובדות מובנות (slowly-changing-dimension)
    0012_agents.sql            # agents + agent_runs + agent_state
    0013_agent_cron.sql        # cron ל-agent-tick
    0014_conditional_reminders.sql # kind='conditional' + predicate
    0015_snapshots.sql         # state_snapshots
    0016_snapshot_cron.sql     # cron ל-snapshot-daily
    0017_health.sql            # health_metrics
    0018_seed_agents.sql       # זריעת הגדרות הסוכנים
    0024_subscriptions.sql     # migration היסטורית: שכבת המנויים שהוסרה
    0025_active_owners_views.sql # migration היסטורית: views שהוסרו
    0026_subscription_tick_cron.sql # migration היסטורית: cron שהוסר
    0027_remove_monetization.sql # הסרת טבלאות, types, views ו-cron של המונטיזציה
    0028_remove_monetization_vault_secret.sql # הסרת כתובת הפונקציה הישנה מ-Vault
    0030_profile_identities.sql  # זהות משותפת לווב ו-Telegram
    0031_profile_link_codes.sql  # קוד חד-פעמי לקישור חשבונות
    0032_projects_planning_and_captures.sql # פרויקטים, תכנון ותיבת קליטה
    0033_project_plans_and_research.sql # הצעות תוכנית ומחקר
    0034_web_oauth_return.sql # חזרת Google OAuth אל ה-PWA
    0035_calendar_crud_and_oauth_intent.sql # גרסת Google לאירועים והפרדת מטרת OAuth
apps/
  web-app/             # PWA עצמאית (React + Vite), פרוסה ב-Vercel
  mini-app/            # Telegram Mini App (SvelteKit + Tailwind RTL, SPA סטטי)
scripts/
  setup-telegram-ui.ts # רישום פקודות + כפתור תפריט (אחרי deploy)
  deploy-self-host.ps1 # פריסת Supabase עצמאית והפקת הגדרות Vault
```

## פקודות הבוט

טקסט חופשי מנותב אוטומטית (תזכורת / אירוע יומן / רשימה / בועה / משימה); אם לא ברור — נשאלת הבהרה.
שאלות בסגנון "מה אמרתי על X?" עוברות ל-Memory Agent.

| תחום        | פקודות                                                                          |
| ----------- | ------------------------------------------------------------------------------- |
| כללי        | `/start` · `/menu` (תפריט ראשי) · `/help` · `/find <ביטוי>` (חיפוש משולב)        |
| תזכורות     | `/reminders` · `/remind <טקסט>` · כפתורי snooze על תזכורת שמגיעה                |
| רשימות      | `/lists` · `/newlist <שם>` · `/add <פריט>` · הקלטה קולית 🎤                      |
| המעיין      | `/remember` (`/save`) · `/recall` (`/search`) · `/memories` · `/knowledge` · `/inspiration` · `/reflection` · `/types` |
| משימות      | `/tasks` · `/task <כותרת>` · `/subtask <כותרת>`                                 |
| יומן Google | `/connect [drive]` · `/disconnect` · `/today` · `/events` (עריכה/דחייה/מחיקה) · `/summary on 07:00 \| off` |
| Drive       | `/drive <ביטוי>` · תמונה + caption `/extract` (Image-to-Action)                 |
| Obsidian    | `/obsidian on \| off \| sync \| status`                                          |
| חברים/שיתוף | `/invite` · `/friends` · `/share ...` · `/shared`                               |
| אינטליגנציה | `/inbox` · `/timeline <תקופה>` · `/agents [enable\|disable <name>]` · `/health` |

## התחלה מהירה

להקמת עותק production עצמאי, עברו ישירות אל
[מדריך ההתקנה העצמית](SELF_HOSTING.md). השלבים כאן מיועדים בעיקר לפיתוח מקומי.

דרישות:

- [Deno 2.x](https://deno.com/)
- [Supabase CLI](https://supabase.com/docs/guides/local-development)
- Node.js 22 ומעלה
- npm 10 ומעלה

שכפול והתקנה:

```bash
git clone https://github.com/tzvikahe-ops/Tachles.git
cd Tachles
cp .env.example .env.local

cd apps/web-app
cp .env.example .env
npm ci
cd ../..

cd apps/mini-app
cp .env.example .env
npm ci
cd ../..
```

בדיקות שאינן דורשות secrets:

```bash
deno task verify
cd apps/web-app
npm run build
npm audit --audit-level=high
cd ../..

cd apps/mini-app
npm run check
npm run build
npm audit --audit-level=high
```

## פיתוח מקומי

כדי להפעיל את המערכת המלאה יש ליצור פרויקט מקומי או נפרד ב-Supabase ולמלא רק את
משתני הסביבה הדרושים ליכולות שאתם בודקים.

```bash
# 1. הפעלת הסטאק המקומי (Postgres + Storage + Edge runtime)
supabase start

# 2. החלת המיגרציות
supabase db reset            # מריץ את כל ה-migrations מאפס

# 3. משתני סביבה
cp .env.example .env.local   # אין לבצע commit לקובץ הזה

# 4. הרצת הפונקציות מקומית
deno task serve              # supabase functions serve --env-file .env.local

# 5. type-check / lint / בדיקות
deno task verify

# 6. אפליקציית ה-PWA
cd apps/web-app
cp .env.example .env
npm ci
npm run dev                    # http://localhost:5173
```

לחיבור טלגרם מקומי חושפים את הפונקציה דרך tunnel (למשל `cloudflared`) ומגדירים webhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d url="https://<tunnel>/telegram-webhook" \
  -d secret_token="$TELEGRAM_WEBHOOK_SECRET"
```

## פריסה (production)

הפקודות הבאות הן תבנית לפריסה עצמאית. הן אינן משתמשות בפרויקט production של
המתחזק. מומלץ להגדיר פרויקט Supabase נפרד, לשמור secrets רק דרך Supabase ולבדוק
כל migration בסביבה שאינה production.

```bash
supabase db push                                   # החלת migrations על הפרויקט המרוחק
supabase functions deploy telegram-webhook
supabase functions deploy dispatch-reminders
supabase functions deploy sync-calendars
supabase functions deploy agent-tick
supabase functions deploy snapshot-daily
supabase functions deploy oauth-callback --no-verify-jwt   # מקבל redirect מ-Google
supabase functions deploy api --no-verify-jwt              # backend ל-Mini App (אימות דרך X-Telegram-InitData)
supabase functions deploy api-web --no-verify-jwt          # backend ל-PWA; מאמת JWT בקוד
supabase secrets set --env-file .env               # TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, DISPATCH_SECRET, ...
```

את `apps/web-app` אפשר לפרוס כפרויקט Vite ב-Vercel. יש להגדיר את תיקיית השורש
ל-`apps/web-app` ולהוסיף את שלושת המשתנים הציבוריים המפורטים בהמשך. בפרויקט הרשמי
הענף `main` מחובר ל-Vercel ונפרס אוטומטית.

אחרי ה-deploy הראשון (וכל שינוי ברשימת הפקודות), מריצים פעם אחת את סקריפט הקמת ה-UI של טלגרם —
רושם את רשימת הפקודות בעברית ואת כפתור התפריט (אידמפוטנטי, אפשר להריץ שוב):

```bash
deno run -A scripts/setup-telegram-ui.ts           # קורא TELEGRAM_BOT_TOKEN מ-env או מ-.env.local
```

לפני שה־cron מתחיל לפעול, מגדירים ב-Vault עבור כל פונקציה מתוזמנת את כתובת הפונקציה ואת
`dispatch_secret` (זהה ל-`DISPATCH_SECRET`); ראו ההערות במיגרציות ה-cron
(`0002`, `0006`, `0013`, `0016`).

`TELEGRAM_WEBHOOK_SECRET` ו-`DISPATCH_SECRET` הם חובה. נקודות הכניסה נכשלות
במצב סגור אם הם חסרים, כדי שפריסה שגויה לא תהפוך webhook או cron job לציבורי.

## משתני סביבה

| משתנה                                        | תיאור                                                  |
| -------------------------------------------- | ------------------------------------------------------ |
| `TELEGRAM_BOT_TOKEN`                         | טוקן הבוט מ-BotFather                                  |
| `TELEGRAM_WEBHOOK_SECRET`                    | secret לאימות קריאות webhook (header)                  |
| `BOT_USERNAME`                               | שם המשתמש של הבוט (לקישורי הזמנה deep-link)             |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | גישת service-role (מוזרק מקומית ע"י `supabase start`)  |
| `ANTHROPIC_API_KEY`                          | ניתוב כוונות, פענוח תזכורות, Vision, סוכנים            |
| `LLM_MODEL`                                  | אופציונלי; ברירת מחדל `claude-sonnet-4-6`              |
| `OPENAI_API_KEY`                             | תמלול קול + embeddings (חיפוש סמנטי)                   |
| `OPENAI_TRANSCRIBE_MODEL`                    | אופציונלי; מודל תמלול                                   |
| `OPENAI_EMBEDDING_MODEL`                     | אופציונלי; מודל embeddings                              |
| `DISPATCH_SECRET`                            | secret משותף בין pg_cron לפונקציות המתוזמנות           |
| `VAPID_SUBJECT`                              | כתובת `mailto:` לזיהוי שולח התראות Web Push            |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`     | זוג מפתחות VAPID לשליחת התראות PWA                      |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`  | OAuth ל-Google Calendar / Drive                       |
| `OAUTH_REDIRECT_URI`                         | כתובת ה-redirect של `oauth-callback`                  |
| `MINI_APP_URL`                               | אופציונלי; כתובת ה-Mini App — מפנה את כפתור התפריט לאפליקציה |
| `WEB_APP_URL`                                | כתובת ה-PWA; משמשת ל-CORS ולחזרה מ-Google OAuth          |
| `WEB_ALLOWED_EMAILS`                         | רשימת אימיילים מורשים; ריק משאיר התקנה עצמאית פתוחה      |
| `PROFILE_LINK_SECRET`                        | pepper שרת לקודי קישור חד-פעמיים בין Telegram לווב       |
| `OPENAI_RESEARCH_MODEL`                      | אופציונלי; מודל למחקר רשת                                |
| `VITE_API_BASE`                              | כתובת פונקציית ה-API המתאימה לאפליקציה                   |
| `VITE_SUPABASE_URL`                          | כתובת פרויקט Supabase עבור `apps/web-app`                |
| `VITE_SUPABASE_PUBLISHABLE_KEY`              | המפתח הציבורי של Supabase עבור הדפדפן                    |

## אפליקציית PWA עצמאית (`apps/web-app`)

האפליקציה החדשה בנויה ב-React וב-Vite, מותאמת קודם כל לנייד ופועלת ללא תלות
ב-Telegram. היא כוללת:

- [x] **התראות Web Push** — הרשאה ומינוי נפרדים לכל מכשיר, התראת בדיקה, פתיחת מסך
      התזכורות בלחיצה, ניקוי אוטומטי של מינויים שפגו ושליחה במקביל ל-Telegram.
- כניסה עם Google או קישור magic link באימייל.
- קישור מאובטח לחשבון Telegram קיים דרך `/linkweb`.
- בית, משימות ומצב "ממתין לתשובה".
- יומן שבועי עם חיבור Google, סנכרון ויצירה, עריכה ומחיקה של אירועים.
- זרם זיכרונות עם חיפוש, סינון ויצירה, עריכה ומחיקה מלאות.
- פרויקטים, ציר ביצוע ומאגר ידע לכל פרויקט.
- תיבת קליטה ויעד שיתוף מובנה של PWA מהנייד.
- תשתית להצעות תוכנית באישור, מחקר עם מקורות ותכנון יום.
- חיבור Obsidian דרך Google Drive, סנכרון ידני ופתיחת תיקיית ה-Vault.

```bash
cd apps/web-app
cp .env.example .env
npm ci
npm run dev
npm run build
```

הסנכרון עם Obsidian הוא חד-כיווני:

```text
Tachles -> Google Drive -> Obsidian
```

תכלס נשארת מקור האמת; עריכה ידנית ב-Obsidian אינה דורסת את הנתונים באפליקציה.

## Mini App (`apps/mini-app`)

אפליקציית Telegram Mini App (SvelteKit + Tailwind RTL, SPA סטטי). מסכי MVP: בית, יומן, רשימות.
האימות הוא דרך `initData` החתום של טלגרם (header `X-Telegram-InitData`) מול פונקציית `api` — אין login,
אין session. כל ה-CRUD עובר דרך אותם שירותי `_shared/` של הבוט.

```bash
cd apps/mini-app
cp .env.example .env            # מלא VITE_API_BASE = כתובת פונקציית api
npm install
npm run dev                     # פיתוח
npm run build                   # SPA סטטי -> apps/mini-app/build
npm run check                   # type-check (svelte-check)
```

פריסה: build → אירוח סטטי ב-HTTPS (Vercel / Cloudflare Pages / Supabase Storage). אחר כך:

1. ב-BotFather: `/myapps` → בחירת הבוט → שם קצר `tachles` → URL של האפליקציה.
2. הגדרת `MINI_APP_URL` והרצת `deno run -A scripts/setup-telegram-ui.ts` — כפתור התפריט יצביע לאפליקציה.

**Deep links**: `https://t.me/<bot>/tachles?startapp=<יעד>` פותח ישירות מסך. ערכים נתמכים:
`calendar`, `lists`, `tasks`, `memories`, `agents`, `settings`, או `list_<id>` למסך רשימה ספציפי.

## סטטוס ומפת דרכים

### בנוי ופרוס לפרודקשן (Supabase Cloud + Vercel)

- [x] **PWA עצמאית** — React + Vite, Supabase Auth, RTL, manifest, service worker,
      Web Share Target ופריסה אוטומטית מ-`main` אל Vercel.
- [x] **זהות רב-ערוצית** — חשבון ווב עצמאי וקישור אופציונלי לפרופיל Telegram קיים.
- [x] **פרויקטים ותכנון** — פרויקטים, משימות משויכות, מצב המתנה, תיבת קליטה,
      ציר ביצוע, מאגר ידע והצעות תוכנית באישור.
- [x] **מחקר ותכנון יום** — backend למחקר רשת עם מקורות ותצוגה מקדימה לתכנון
      משימות סביב אירועי היומן.
- [x] **Obsidian באפליקציה** — חיבור Google Drive, סטטוס, סנכרון מלא וקישור לתיקייה.
- [x] **שלב 0** — תשתית: סכמה, RLS, cron, webhook עם `/start`.
- [x] **שלב 1א** — תזכורות: יצירה מטקסט חופשי בעברית (חד־פעמי/חוזר), רשימה וביטול.
- [x] **שלב 1ב** — רשימות עם הקלטה קולית: תמלול (OpenAI) → פריטים ברשימה הפעילה, סימון ומחיקה.
- [x] **שלב 1ג** — בועות זיכרון (המעיין): שמירה, תיוג, סיווג סוג, חיפוש (trigram).
- [x] **שלב 1ד** — לוח משימות (הגשר): משימות, תתי־משימות, סטטוס ועדיפויות.
- [x] **תשתית** — LLM intent router: 6 כוונות בקריאת Claude אחת (reminder / calendar_event /
      list_add / memory_save / task_create / unclear), עם פולבק להבהרה.
- [x] **שלב 2** — Google Calendar: OAuth, sync חצי־שעתי לטבלת `calendar_events`, יצירת
      אירועים מהבוט (`calendar.events` scope), סיכום יומי דינמי מורכב ע"י Claude.
- [x] **שלב 3** — ארגז הזיכרון: bucket `memory-trunk` (50MB/קובץ), OCR לתמונות וסיכום ל-PDF
      ב-Claude Vision, embeddings (OpenAI `text-embedding-3-small`) + חיפוש סמנטי דרך
      `match_bubbles` (pgvector / ivfflat). פילטור בועות לפי סוג עם כפתורי inline.
- [x] **שלב 4** — F2F: `invites` (deep-link `?start=inv_<token>`), `f2f_links`, `shares`
      ברמת resource (list / task / bubble / reminder), פקודות `/invite`, `/friends`,
      `/share`, `/shared`. ללא RLS מורחב — service-role + בדיקה בקוד.
- [x] **שלב 5** — Google Drive search (`/drive`) + Image-to-Action (תמונה + caption
      `/extract` → tasks/list_items חולצים דרך Claude Vision).
- [x] **Obsidian sync** — ייצוא בועות / משימות / סיכומים כ-markdown לתיקיית `Tachles` ב-Drive
      (`/obsidian on|off|sync|status`), עם מיפוי קבצים לעדכון/מחיקה במקום כפילויות.
- [x] **שלב 6.1** — יומן ביקורת (`events`): מזין `/inbox`, timeline, הקשר לסוכנים וספירות
      לתזכורות מותנות.
- [x] **שלב 6.2** — עובדות מובנות (`user_facts`): חילוץ אוטומטי מטקסט (fact_extractor) בתבנית
      slowly-changing-dimension; Memory Agent משיב על "מה אמרתי על X?" (`/recall`-שאלות חופשיות).
- [x] **שלב 6.3** — סוכנים פרואקטיביים: רישום + היסטוריית ריצות + מצב לכל משתמש, מריץ
      (`agent-tick`, כל 15 ד׳) לפי cron מקומי. סוכנים: Chief of Staff, Anti-Chaos,
      Health Intelligence. ניהול דרך `/agents`. `/timeline` לסיכום נרטיבי של תקופה.
- [x] **שלב 6.4** — תזכורות מותנות (`kind='conditional'`): predicate (inactivity / streak_break /
      threshold) נבדק מול `events` בכל דקה; יורה רק כשהתנאי מתקיים.
- [x] **שלב 6.5** — תצלומי מצב יומיים (`state_snapshots`, `snapshot-daily`): צבירה יומית מראש
      כדי שהסוכנים לא יחשבו מחדש בכל ריצה.
- [x] **שלב 7** — מעקב בריאות (`health_metrics`): 8 מטריקות (שינה, מצב רוח, אימון, תרופות, מים,
      משקל, כאב, צעדים), רישום ב-`/health` + ממוצעי 7 ימים, מוזן לסוכן Health Intelligence.
- [x] **DST drift בסיכום יומי** — תוקן. `nextOccurrence` מקבל timezone ומעגן כל הופעה חוזרת
      לשעת הקיר המקומית (rrule חסר תמיכת TZID בריצה הזו, ו-VTIMEZONE לא נתמך). מכוסה בטסטים.
- [x] **עריכה/מחיקת ארועים מהבוט** — `/events` מציג אירועים קרובים עם כפתורי דחייה (+15/+30/+שעה/+יום)
      ומחיקה; מסונכרן ל-Google ולמטמון המקומי.
- [x] **כפתורי snooze לתזכורות** — תזכורות static נשלחות עם כפתורי דחייה (+10 דק׳ / +שעה / בוקר);
      דחייה יוצרת תזכורת חד־פעמית חדשה ולא נוגעת בסדרה.
- [x] **חיפוש משולב** — `/find` מחפש בו־זמנית בבועות (סמנטי/trigram), ברשימות ובמשימות.
- [x] **גישה פתוחה** — כל היכולות זמינות לכל פרופיל ללא תוכניות תשלום או שערי הרשאה מסחריים.

## תרומה ואבטחה

- התקנה עצמית: [עברית](SELF_HOSTING.md) · [English](SELF_HOSTING.en.md)
- הנחיות לפיתוח ו-Pull Requests: [CONTRIBUTING.md](CONTRIBUTING.md)
- דיווח פרטי על חולשות: [SECURITY.md](SECURITY.md)
- כללי התנהגות בקהילה: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- דוח ההכנה לפרסום: [docs/open-source-readiness-report.md](docs/open-source-readiness-report.md)

## יוצר ומתחזק

נוצר ומתוחזק על ידי [Zvika Hershkovitz](https://github.com/tzvikahe-ops).

אם תכלס שימושי לכם, אפשר לתמוך בפרויקט באמצעות כוכב ב-GitHub.

**Author and maintainer:** [Zvika Hershkovitz](https://github.com/tzvikahe-ops).

## רישיון

הפרויקט מופץ תחת [MIT License](LICENSE).
