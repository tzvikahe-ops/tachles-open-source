# התקנה עצמית של תכלס

המדריך הזה מקים עותק עצמאי של תכלס בחשבונות שלכם.

Telegram אינו חובה. אפשר להפעיל PWA מלאה עם כניסה באימייל, תזכורות Push,
משימות, זיכרונות ופרויקטים. Google, AI, Obsidian ו-Telegram מופעלים לפי הצורך.

## 1. דרישות

- חשבון GitHub
- חשבון [Supabase](https://supabase.com/)
- חשבון [Vercel](https://vercel.com/)
- Deno 2.x, Node.js 22+, npm 10+
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- מפתח Anthropic לפענוח בקשות ויצירת תוכניות
- מפתח OpenAI לתמלול, embeddings ומחקר

ל-Google Calendar, Drive וכניסה עם Google נדרש גם פרויקט Google Cloud.

## 2. שכפול והתקנה

```powershell
git clone https://github.com/tzvikahe-ops/tachles-open-source.git
cd tachles-open-source
Copy-Item .env.example .env.local
Copy-Item apps/web-app/.env.example apps/web-app/.env
npm --prefix apps/web-app ci
```

מלאו את `.env.local`. אל תבצעו לו commit.

## 3. יצירת Supabase

1. צרו פרויקט חדש ב-Supabase.
2. העתיקו מ-Project Settings:
   - Project URL
   - Publishable key
   - Project reference
   - Database password
3. מלאו ב-`.env.local` את משתני השרת.
4. מלאו ב-`apps/web-app/.env`:

```dotenv
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_API_BASE=https://PROJECT_REF.supabase.co/functions/v1/api-web
```

## 4. פריסת שלד ה-PWA ב-Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftzvikahe-ops%2Ftachles-open-source&root-directory=apps%2Fweb-app&env=VITE_SUPABASE_URL,VITE_SUPABASE_PUBLISHABLE_KEY,VITE_API_BASE)

בפרויקט Vercel:

- Root Directory: `apps/web-app`
- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

הגדירו את שלושת משתני `VITE_*` משלב 3. שמרו את כתובת Vercel שקיבלתם והגדירו
אותה ב-`.env.local` בתור `WEB_APP_URL`.

האתר עשוי להציג שגיאת חיבור עד ששלב ה-Backend יושלם.

## 5. מפתחות אבטחה

צרו ערכים אקראיים עבור:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

השתמשו בערכים שונים עבור:

- `DISPATCH_SECRET`
- `PROFILE_LINK_SECRET`
- `TELEGRAM_WEBHOOK_SECRET`, אם Telegram מופעל

צרו מפתחות Push:

```powershell
npx --yes web-push generate-vapid-keys --json
```

הכניסו את התוצאה אל:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT=mailto:you@example.com`

## 6. הגבלת משתמשים

ברירת המחדל היא שכל מי שמצליח להירשם לעותק שלכם יכול להשתמש בו.

לעותק אישי הגדירו:

```dotenv
WEB_ALLOWED_EMAILS=you@example.com
```

אפשר להוסיף כמה כתובות, מופרדות בפסיקים. השאירו ריק לעותק רב-משתמשים.

## 7. פריסת ה-Backend

אפשר להשתמש בסקריפט האוטומטי:

```powershell
.\scripts\deploy-self-host.ps1 `
  -ProjectRef "PROJECT_REF" `
  -DatabasePassword "DATABASE_PASSWORD"
```

הסקריפט:

1. בודק את כלי הפיתוח וקובץ הסביבה.
2. מקשר את המאגר לפרויקט Supabase.
3. מחיל את כל המיגרציות.
4. מעלה את הסודות שאינם ריקים.
5. פורס את פונקציות ה-PWA והמשימות המתוזמנות.
6. מפיק קובץ SQL זמני להגדרת Vault.

בסיום, פתחו את Supabase SQL Editor והריצו את הקובץ:

`supabase/.temp/self-host-vault.sql`

הקובץ כולל את `DISPATCH_SECRET`, ולכן הוא מוחרג מ-Git ויש למחוק אותו לאחר ההרצה.

### פריסה ידנית

```powershell
supabase link --project-ref PROJECT_REF
supabase db push --password "DATABASE_PASSWORD" --include-all

supabase functions deploy api-web --no-verify-jwt --project-ref PROJECT_REF
supabase functions deploy dispatch-reminders --project-ref PROJECT_REF
supabase functions deploy sync-calendars --project-ref PROJECT_REF
supabase functions deploy agent-tick --project-ref PROJECT_REF
supabase functions deploy snapshot-daily --project-ref PROJECT_REF
supabase functions deploy oauth-callback --no-verify-jwt --project-ref PROJECT_REF
```

את סודות הפונקציות העלו בשמות המופיעים ב-`.env.example`. אל תעלו את כל
`.env.local` באופן עיוור: משתני `SUPABASE_*` מנוהלים על ידי הפלטפורמה. הסקריפט
האוטומטי מסנן ומעלה רק את השמות המתאימים.

## 8. Supabase Auth

ב-Supabase Dashboard:

1. Authentication → URL Configuration.
2. הגדירו את כתובת Vercel שלכם כ-Site URL.
3. הוסיפו אותה ל-Redirect URLs.
4. הפעילו Email provider עבור magic links.

לשימוש מעבר לניסוי קטן מומלץ להגדיר Custom SMTP, כדי שהודעות הכניסה לא יהיו
תלויות במכסת הדוא"ל המובנית של Supabase.

לכניסה עם Google:

1. הפעילו Google provider ב-Supabase.
2. צרו OAuth Web Client ב-Google Cloud.
3. הוסיפו ל-Google את כתובת הכניסה של Supabase:

```text
https://PROJECT_REF.supabase.co/auth/v1/callback
```

4. הגדירו Client ID ו-Client Secret ב-Supabase.

## 9. Google Calendar ו-Drive

ב-Google Cloud:

1. הפעילו Google Calendar API ו-Google Drive API.
2. הגדירו OAuth consent screen.
3. הוסיפו Authorized redirect URI:

```text
https://PROJECT_REF.supabase.co/functions/v1/oauth-callback
```

4. מלאו ב-`.env.local`:

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
OAUTH_REDIRECT_URI=https://PROJECT_REF.supabase.co/functions/v1/oauth-callback
WEB_APP_URL=https://YOUR_APP.vercel.app
```

5. העלו שוב את הסודות ופרסו `oauth-callback`.

## 10. Telegram, אופציונלי

ללא Telegram אין צורך להגדיר משתני Telegram או לפרוס את `telegram-webhook` ו-`api`.

להפעלתו:

1. צרו בוט ב-BotFather.
2. מלאו את משתני Telegram ב-`.env.local`.
3. הריצו:

```powershell
supabase functions deploy telegram-webhook --no-verify-jwt --project-ref PROJECT_REF
supabase functions deploy api --no-verify-jwt --project-ref PROJECT_REF
deno run -A scripts/setup-telegram-ui.ts
```

4. הגדירו webhook עם `TELEGRAM_WEBHOOK_SECRET`.

## 11. בדיקות

```powershell
deno task verify
npm --prefix apps/web-app run build
```

אחרי הפריסה בדקו:

1. כניסה באימייל או Google.
2. יצירת תזכורת לעוד מספר דקות.
3. הפעלת Push במסך "עוד" ושליחת התראת בדיקה.
4. יצירת משימה וזיכרון.
5. חיבור Calendar ו-Drive, אם הוגדרו.

## 12. אבטחה ועלויות

- לעולם אל תכניסו `.env`, מפתחות או סיסמאות ל-Git.
- הגבילו מפתחות Google ו-AI לפי השירותים הנדרשים.
- הפעילו התראות שימוש ותקציב אצל הספקים.
- לעותק אישי הגדירו `WEB_ALLOWED_EMAILS`.
- מחקו את `supabase/.temp/self-host-vault.sql` לאחר השימוש.
- לפני עדכון production, הריצו migrations ובדיקות על פרויקט נפרד.

## פתרון תקלות

- `account_not_allowed`: כתובת האימייל אינה נמצאת ב-`WEB_ALLOWED_EMAILS`.
- `redirect_uri_mismatch`: כתובת ה-callback חסרה ב-Google Cloud.
- `Unsupported provider`: ספק Google אינו מופעל ב-Supabase Auth.
- Push לא נרשם: פתחו את ה-PWA מ-HTTPS; ב-iPhone יש להתקין למסך הבית.
- תזכורות לא נשלחות: בדקו את סודות Vault ואת `DISPATCH_SECRET`.
- CORS: ודאו ש-`WEB_APP_URL` שווה ל-origin המדויק של Vercel.
