# Contributing to Tachles

תודה על הרצון לשפר את תכלס. הפרויקט פונה למשתמשים בעברית, ולכן טקסט שמוצג למשתמש
צריך להישאר בעברית. שמות קוד, לוגים ותיעוד טכני יכולים להיות באנגלית.

## לפני שמתחילים

- לתיקון קטן אפשר לפתוח Pull Request ישירות.
- לשינוי התנהגות, סכימה, אינטגרציה או UX משמעותי, פתחו Issue תחילה.
- חולשות אבטחה אינן מדווחות ב-Issue ציבורי. ראו `SECURITY.md`.

## סביבת פיתוח

נדרשים:

- Deno 2.x
- Supabase CLI
- Node.js 22 ומעלה
- npm 10 ומעלה

התקנה:

```bash
git clone https://github.com/tzvikahe-ops/tachles-open-source.git
cd tachles-open-source
cp .env.example .env.local
cd apps/mini-app
cp .env.example .env
npm ci
```

אין להכניס מפתחות אמיתיים ל-Git. רוב בדיקות האיכות אינן דורשות משתני סביבה.
להקמת עותק production עצמאי ראו `SELF_HOSTING.md`; אין להשתמש בפרויקט Supabase
או בפריסת Vercel של המתחזק.

## בדיקות

מהשורש:

```bash
deno task verify
```

מהתיקייה `apps/mini-app`:

```bash
npm run check
npm run build
npm audit --audit-level=high
```

מהתיקייה `apps/web-app`:

```bash
npm ci
npm run build
npm audit --audit-level=high
```

## כללי שינוי

- שמרו על גבולות השירותים הקיימים תחת `_shared/`.
- כל גישה לנתוני משתמש חייבת להמשיך להסתנן לפי `owner_id`.
- יש לבצע escaping לתוכן משתמש לפני שילוב בהודעות Telegram במצב HTML.
- שינוי התנהגות צריך להגיע עם בדיקה ממוקדת כאשר הדבר מעשי.
- אין לערב refactor שאינו קשור ישירות לתיקון.

## Pull Request

PR טוב כולל:

- תיאור הבעיה והפתרון;
- פירוט הבדיקות שהורצו;
- צילום מסך לשינוי חזותי;
- ציון migration, משתנה סביבה או שינוי פריסה, אם נוספו;
- ללא סודות, נתוני משתמש או קובצי build.

בהגשת תרומה אתם מסכימים שהתרומה תופץ תחת רישיון MIT של הפרויקט.
