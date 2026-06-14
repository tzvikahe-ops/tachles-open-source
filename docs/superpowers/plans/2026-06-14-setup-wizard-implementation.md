# תוכנית מימוש: אשף התקנה מקומי לתכלס

מסמך מקור:
[`docs/superpowers/specs/2026-06-14-setup-wizard-design.md`](../specs/2026-06-14-setup-wizard-design.md)

## עקרונות ביצוע

- האשף חייב להיפתח על Windows לפני שמותקנים Node, Deno או כלי CLI.
- קובצי הממשק הסטטיים ייכללו במאגר ולא יידרש build להפעלת האשף.
- PowerShell יהיה שכבת ההרצה היחידה.
- כל פעולה תהיה allowlist מפורש, תפיק תוצאה מובנית ותהיה ניתנת לניסיון חוזר.
- אין לבצע פעולות אמיתיות בחשבונות ענן במהלך בדיקות אוטומטיות.
- כל שלב יושלם רק לאחר בדיקת מצב, לא רק לאחר יציאת פקודה בקוד הצלחה.

## מבנה קבצים מתוכנן

```text
Start-Tachles-Setup.cmd
scripts/
  setup-wizard/
    Start-SetupWizard.ps1
    server/
      SetupServer.psm1
      Router.psm1
      Security.psm1
    core/
      Types.psm1
      StateStore.psm1
      EnvStore.psm1
      ProcessRunner.psm1
      Redaction.psm1
    actions/
      Prerequisites.psm1
      Supabase.psm1
      Vercel.psm1
      Secrets.psm1
      Google.psm1
      Verification.psm1
    ui/
      index.html
      app.js
      styles.css
      assets/
    tests/
      Run-Tests.ps1
      StateStore.Tests.ps1
      EnvStore.Tests.ps1
      Redaction.Tests.ps1
      Router.Tests.ps1
      ProcessRunner.Tests.ps1
      Actions.Tests.ps1
```

## שלב 1: מעטפת הפעלה ושרת מקומי

### קבצים

- יצירה: `Start-Tachles-Setup.cmd`
- יצירה: `scripts/setup-wizard/Start-SetupWizard.ps1`
- יצירה: `scripts/setup-wizard/server/SetupServer.psm1`
- יצירה: `scripts/setup-wizard/server/Security.psm1`
- יצירה: `scripts/setup-wizard/ui/index.html`
- יצירה: `scripts/setup-wizard/ui/app.js`
- יצירה: `scripts/setup-wizard/ui/styles.css`

### עבודה

1. ה-CMD יפעיל PowerShell עם `-NoProfile` ו-ExecutionPolicy ברמת התהליך בלבד.
2. הסקריפט יבחר פורט פנוי באמצעות `TcpListener`.
3. ייווצר אסימון אקראי חדש בכל הפעלה.
4. השרת יאזין רק ל-`127.0.0.1`.
5. הדפדפן ייפתח עם כתובת הכוללת מזהה הפעלה חד-פעמי.
6. השרת יגיש רק קבצים מתוך תיקיית `ui`.
7. סגירת חלון ה-PowerShell תפסיק את השרת.

### בדיקות

- שרת לא מאזין על `0.0.0.0`.
- traversal כגון `../` מוחזר כ-404.
- קובץ מחוץ ל-`ui` אינו ניתן לקריאה.
- API ללא אסימון מוחזר כ-401.
- שני אשפים במקביל מקבלים פורטים ואסימונים שונים.

### שער השלמה

הרצת `Start-Tachles-Setup.cmd` במכונת Windows נקייה פותחת מסך עברי בדפדפן
ללא תלות ב-Node, Deno או npm.

## שלב 2: מודל מצב, סודות ויומן בטוח

### קבצים

- יצירה: `scripts/setup-wizard/core/Types.psm1`
- יצירה: `scripts/setup-wizard/core/StateStore.psm1`
- יצירה: `scripts/setup-wizard/core/EnvStore.psm1`
- יצירה: `scripts/setup-wizard/core/Redaction.psm1`
- עדכון: `.gitignore`

### עבודה

1. להגדיר מצבי פעולה:
   `pending`, `running`, `needs_user_action`, `succeeded`, `failed`.
2. לשמור state תחת:
   `.tachles-setup/state.json`.
3. לשמור לוגים תחת:
   `.tachles-setup/logs/`.
4. לקרוא ולכתוב `.env.local` בלי למחוק הערות או משתנים לא מוכרים.
5. להגביל ACL של `.env.local` ושל תיקיית `.tachles-setup` למשתמש הנוכחי.
6. לבנות redactor שמחליף סודות ידועים, Bearer tokens, API keys וסיסמאות.
7. לא להחזיר סוד מלא דרך API לאחר שנשמר.
8. להוסיף `.tachles-setup/` ל-`.gitignore`.

### בדיקות

- כתיבה אטומית של state באמצעות קובץ זמני והחלפה.
- קובץ state פגום נשמר כגיבוי ומתחיל state תקין.
- עדכון משתנה ENV אינו מוחק שורות אחרות.
- redactor מסתיר ערכים גם בתוך URL ופלט שגיאה.
- state ולוגים אינם מכילים ערכי בדיקה סודיים.

### שער השלמה

אפשר לסגור את האשף באמצע, לפתוח אותו מחדש ולחזור לשלב האחרון ללא אובדן
התקדמות וללא סודות ב-state או ביומן.

## שלב 3: נתב API ומריץ תהליכים

### קבצים

- יצירה: `scripts/setup-wizard/server/Router.psm1`
- יצירה: `scripts/setup-wizard/core/ProcessRunner.psm1`
- יצירה: `scripts/setup-wizard/tests/Router.Tests.ps1`
- יצירה: `scripts/setup-wizard/tests/ProcessRunner.Tests.ps1`

### עבודה

1. להגדיר נתיבי API סגורים:
   - `GET /api/session`
   - `GET /api/state`
   - `POST /api/action/<name>`
   - `POST /api/secret`
   - `GET /api/log`
   - `POST /api/shutdown`
2. לא לאפשר שם פקודה או נתיב קובץ חופשיים מהדפדפן.
3. להעביר ארגומנטים לתהליכים כמערך.
4. להזרים stdout ו-stderr ליומן לאחר redaction.
5. להחזיר לממשק אירועי התקדמות באמצעות polling בגרסה הראשונה.
6. לתמוך בביטול תהליך פעיל.
7. להגביל פעולה אחת רצה בכל רגע.

### בדיקות

- פעולה שאינה ברשימה מוחזרת כ-404.
- בקשה מ-Origin אחר נדחית.
- לא ניתן להזריק `;`, `|` או `&` כפקודה.
- stdout ו-stderr נשמרים בסדר סביר ומושחרים.
- ביטול מעביר את הפעולה למצב `failed` עם סיבה מובנת.

### שער השלמה

הממשק יכול להפעיל פעולת דמה, להציג התקדמות, לבטל אותה ולראות יומן בטוח.

## שלב 4: מסכי האשף והניווט

### קבצים

- עדכון: `scripts/setup-wizard/ui/index.html`
- עדכון: `scripts/setup-wizard/ui/app.js`
- עדכון: `scripts/setup-wizard/ui/styles.css`
- יצירה: `scripts/setup-wizard/ui/assets/icon.svg`

### עבודה

1. לבנות את שמונת המסכים שאושרו.
2. להוסיף בחירת התקנה בסיסית או מלאה.
3. להציג סרגל התקדמות ורשימת שלבים צדדית במסך רחב.
4. במובייל להציג ניווט מקוצר בראש המסך.
5. להוסיף יומן מתקפל למשתמשים מתקדמים.
6. להציג `needs_user_action` עם קישור, ערך להעתקה וכפתור "בדיקה חוזרת".
7. להוסיף אישור מפורש לפני התקנת כלי או שינוי ענן.
8. לשמור את כל הטקסט המוצג בעברית.

### בדיקות

- ניווט מקלדת מלא ו-focus ברור.
- יעדי לחיצה בגודל 44 פיקסלים לפחות.
- תמיכה ברוחב 320 פיקסלים.
- אין גלילה אופקית.
- רענון הדף שומר את השלב הפעיל.
- שגיאה אינה מוחקת נתונים שכבר הוזנו.

### שער השלמה

אפשר לעבור את כל האשף עם פעולות מדומות, כולל סגירה, חזרה ושחזור.

## שלב 5: בדיקת והתקנת prerequisites

### קבצים

- יצירה: `scripts/setup-wizard/actions/Prerequisites.psm1`
- יצירה: `scripts/setup-wizard/tests/Actions.Tests.ps1`

### עבודה

1. לזהות Git, Node.js, npm, Deno, Supabase CLI ו-Vercel CLI.
2. לבדוק גרסאות מינימום:
   - Node.js 22
   - npm 10
   - Deno 2
3. להציע התקנה דרך `winget` כאשר הוא קיים.
4. להציג את הפקודה והמקור לפני אישור.
5. להשתמש רק במזהי חבילות קבועים בקוד.
6. לאפשר התקנה ידנית וקישור לעמוד הרשמי.
7. לבצע בדיקה חוזרת לאחר התקנה.

### בדיקות

- פענוח גרסאות תקינות ולא תקינות.
- `winget` חסר עובר להדרכה ידנית.
- גרסה ישנה אינה מסומנת כמוכנה.
- משתמש שמסרב להתקנה נשאר ב-`needs_user_action`.

### שער השלמה

ב-Windows Sandbox האשף מזהה כלים חסרים ומביא את הסביבה למצב מוכן לאחר
אישור המשתמש.

## שלב 6: פירוק ועטיפת פריסת Supabase

### קבצים

- יצירה: `scripts/setup-wizard/actions/Supabase.psm1`
- יצירה: `scripts/setup-wizard/actions/Secrets.psm1`
- עדכון: `scripts/deploy-self-host.ps1`
- יצירה: `scripts/setup-wizard/tests/Supabase.Tests.ps1`

### עבודה

1. לחלץ מ-`deploy-self-host.ps1` פונקציות עבור:
   - link
   - migrations
   - secrets
   - function deployments
   - Vault SQL
2. לשמור את הסקריפט הקיים תואם להפעלה ישירה.
3. להוסיף מצב פלט מובנה עבור האשף.
4. לבצע `supabase login` ולזהות אם כבר קיימת התחברות.
5. לנסות יצירת פרויקט רק אם Supabase CLI/API הרשמי מאפשרים זאת בבטחה.
6. אחרת לפתוח את Dashboard ולאסוף Project Ref וסיסמת DB.
7. להפיק ולהריץ Vault SQL אוטומטית אם יש API רשמי מתאים.
8. אם לא, להציג SQL להעתקה ולבדוק אחר כך שהסודות קיימים.
9. לפרוס רק פונקציות המתאימות למצב ההתקנה.

### בדיקות

- בדיקות עם executable מדומה, ללא פרויקט Supabase אמיתי.
- ניסיון חוזר אינו יוצר migrations או secrets כפולים.
- כישלון בפריסת פונקציה אחת מאפשר להמשיך ממנה.
- `IncludeTelegram` אינו מופעל בהתקנה בסיסית או מלאה כברירת מחדל.
- פלט מובנה אינו כולל סיסמת DB או service-role key.

### שער השלמה

פרויקט Supabase חדש מגיע לסכמה ולפונקציות עובדות, או שהאשף עוצר בפעולה
ידנית אחת ברורה וממשיך לאחר אימות.

## שלב 7: פריסת Vercel וחיבור הכתובות

### קבצים

- יצירה: `scripts/setup-wizard/actions/Vercel.psm1`
- יצירה: `scripts/setup-wizard/tests/Vercel.Tests.ps1`
- עדכון: `apps/web-app/vercel.json` רק אם יידרש

### עבודה

1. לזהות התחברות קיימת ל-Vercel CLI.
2. ליצור או לבחור פרויקט.
3. לקבע Root Directory ל-`apps/web-app`.
4. להגדיר את שלושת משתני `VITE_*`.
5. להריץ build מקומי לפני פריסה.
6. לפרוס ל-production רק לאחר אישור.
7. לקרוא את כתובת הפריסה מהפלט המובנה.
8. לעדכן `WEB_APP_URL`, Supabase Auth URLs ו-CORS.
9. לפרוס מחדש רכיבים שתלויים בכתובת.

### בדיקות

- פלט Vercel מדומה מפוענח לכתובת תקינה.
- כתובת שאינה HTTPS נדחית.
- משתני Vite אינם כוללים סודות שרת.
- ניסיון חוזר מעדכן את אותו פרויקט.

### שער השלמה

כתובת HTTPS של ה-PWA נטענת ומצב הדגמה או מסך הכניסה מוצגים ללא שגיאת build.

## שלב 8: AI, Push ו-Google

### קבצים

- עדכון: `scripts/setup-wizard/actions/Secrets.psm1`
- יצירה: `scripts/setup-wizard/actions/Google.psm1`
- יצירה: `scripts/setup-wizard/tests/Google.Tests.ps1`

### עבודה

1. לקלוט מפתחות AI בשדות password.
2. לבדוק Anthropic ו-OpenAI בבקשות מינימליות.
3. לייצר סודות פנימיים שונים באמצעות RNG של .NET.
4. לייצר VAPID באמצעות `npx web-push` לאחר התקנת Node.
5. לבנות עבור Google:
   - רשימת APIs
   - consent screen
   - שני Redirect URIs
   - Client ID ו-Client Secret
6. לפתוח קישורי Google Cloud מדויקים כאשר הדבר אפשרי.
7. להציג ערכים מוכנים להעתקה.
8. לבדוק את תצורת Google בלי לשמור access token בדפדפן.

### בדיקות

- מפתח שגוי מחזיר הודעה עברית ואינו נשמר כמוכן.
- זוג VAPID נוצר פעם אחת ונשמר מחדש רק באישור.
- Redirect URIs נבנים מ-Project Ref ומכתובת Vercel הנכונים.
- מסלול בסיסי יכול לדלג על Google בלי לחסום סיום.

### שער השלמה

התקנה מלאה מגיעה לנקודה שבה כל פעולה אוטומטית הושלמה ו-Google דורש רק
את פעולות ה-Dashboard שאין להן API בטוח.

## שלב 9: בדיקות קצה לקצה ומסך סיום

### קבצים

- יצירה: `scripts/setup-wizard/actions/Verification.psm1`
- יצירה: `scripts/setup-wizard/tests/Verification.Tests.ps1`
- עדכון: `scripts/setup-wizard/ui/app.js`

### עבודה

1. לבדוק PWA, Auth ו-`api-web`.
2. לבדוק ש-endpoint פרטי דוחה בקשה ללא JWT.
3. להדריך כניסה בחלון חדש ולבדוק session לאחר החזרה.
4. ליצור ולמחוק רשומת בדיקה מסומנת:
   - משימה
   - זיכרון
   - תזכורת
5. לבצע Push test רק לאחר הרשאת המשתמש.
6. לבדוק התחלת OAuth של Google אם הוגדר.
7. לנקות נתוני בדיקה גם לאחר כישלון.
8. להציג דוח סיום עם קישורים ויכולות פעילות.

### בדיקות

- verifier מדווח בנפרד על כל תת-מערכת.
- כישלון Google אינו מסמן את כל ההתקנה ככושלת אם Google אופציונלי.
- נתוני בדיקה נמחקים.
- אין טוקנים או JWT בדוח הסיום.

### שער השלמה

משתמש מקבל כתובת אפליקציה ודוח שמוכיח אילו יכולות עובדות בפועל.

## שלב 10: תיעוד, CI והפצה

### קבצים

- עדכון: `README.md`
- עדכון: `SELF_HOSTING.md`
- עדכון: `SELF_HOSTING.en.md`
- עדכון: `.github/workflows/ci.yml`
- יצירה: `scripts/setup-wizard/tests/Run-Tests.ps1`

### עבודה

1. להפוך את האשף למסלול ההתקנה הראשי ב-README.
2. להשאיר את המדריך הידני כחלופה ופתרון תקלות.
3. להוסיף CI על Windows:
   - בדיקות PowerShell
   - פתיחת שרת
   - בדיקת API מקומי
   - בדיקת קבצים סטטיים
4. לבצע lint בסיסי באמצעות PSScriptAnalyzer אם זמין, בלי להפוך אותו לתלות
   מקומית לפתיחת האשף.
5. להוסיף צילום של האשף ל-README לאחר מימוש הממשק.
6. לתעד במפורש אילו פעולות עדיין ידניות.

### בדיקות

```powershell
powershell -NoProfile -File scripts/setup-wizard/tests/Run-Tests.ps1
deno task verify
npm --prefix apps/web-app ci
npm --prefix apps/web-app run build
```

### שער השלמה

CI עובר ב-Windows וב-Linux, המסלול הגרפי מתועד, והמסלול הידני נשאר תקין.

## סדר PRs מומלץ

1. **Bootstrap and security foundation**
   שלבים 1 עד 3.
2. **Wizard UI and resumable flow**
   שלב 4.
3. **Prerequisites automation**
   שלב 5.
4. **Supabase deployment integration**
   שלב 6.
5. **Vercel deployment integration**
   שלב 7.
6. **AI, Push and Google guidance**
   שלב 8.
7. **End-to-end verification**
   שלב 9.
8. **Documentation and release hardening**
   שלב 10.

כל PR יכלול בדיקות ממוקדות ולא יערבב חיבורי ענן נוספים לפני שהתשתית
המקומית שלפניהם יציבה.
