# Tachles — רשימת פיצ'רים מלאה

מעודכן ל־2026-06-06. הבוט הוא עוזר אישי פתוח בטלגרם בעברית. כל היכולות זמינות
לכל משתמש ללא תוכניות תשלום או הגבלת פיצ'רים. חברים יכולים להצטרף דרך הזמנות.
כל הפקודות והממשק בעברית, והמזהים בקוד באנגלית.

---

## תפיסה: שתי שכבות

- **המעיין (Wellspring)** — *זיכרון*. בועות ידע/השראה/הרהור, קבצים עם OCR/סיכום, חיפוש סמנטי.
- **הגשר (Bridge)** — *פעולה*. תזכורות, רשימות, משימות, סיכום יומי.
- **שכבת סוכנים** — *יוזמה*. סוכנים פרואקטיביים שרצים על הדאטה ושולחים הודעות חכמות.

---

## פקודות בסיסיות

1. **`/start`** — מצב התחלה + קבלת קישור הזמנה אם נכנסת דרך חבר.
2. **`/help`** — תפריט הפקודות המלא.

## תזכורות (הגשר)

3. **תזכורת בטקסט חופשי** — "תזכיר לי בעוד שעתיים להוציא כביסה" / "כל בוקר ב־7 לקחת ויטמין". ה־router מזהה ויוצר.
4. **`/remind טקסט`** — לכפות פירוש כתזכורת אם ה־router הסס.
5. **`/reminders`** — רשימת התזכורות הפעילות עם כפתורי ביטול.
6. **תזכורות חד־פעמיות + חוזרות** — תמיכה ב־RRULE (יומי, שבועי לפי יום, חודשי וכו').
7. **תזכורות דינמיות** — תזכורת יומית שמרכיבה את התוכן בזמן אמת ע"י handler רשום (למשל: סיכום יומי).
8. **תזכורות מותנות** — "אם לא רשמתי אימון 3 ימים — תזכיר". סוגי תנאי: `inactivity`, `streak_break`, `threshold` על האירועים שב־DB.
9. **תזכורת בזיהוי קולי 🎤** — הקלטה → תמלול → ניתוב ל־router.

## רשימות (הגשר)

10. **`/lists`** — סקירה של כל הרשימות עם כפתור לבחירת רשימה פעילה.
11. **`/newlist שם`** — יצירת רשימה והפיכתה לפעילה.
12. **`/add פריט`** — הוספה לרשימה הפעילה.
13. **הוספה מהקלטה קולית** — הקלטה → תמלול → פיצול אוטומטי לפי פסיק/שורה → הוספה לרשימה הפעילה.
14. **תיוג + שינוי סטטוס פר־פריט** — לחיצה על פריט מעדכנת done/לא, כפתור מחיקה.
15. **הוספה מטקסט חופשי** — "תוסיף לרשימת הקניות חלב, ביצים, לחם" → 3 פריטים.

## בועות זיכרון — המעיין

16. **`/remember טקסט`** או **`/save`** — שמירת בועת זיכרון. תומך ב־#תגיות וקישורים מזוהים אוטומטית.
17. **שמירה מטקסט חופשי** — "תזכור ש..." / רעיון / ציטוט / URL → ה־router מזהה כ־memory_save.
18. **שלושה סוגי בועה** — 📚 ידע, 💡 השראה, 🪞 הרהור (Claude מסווג אוטומטית; ניתן לשנות בכפתורים).
19. **`/memories`** — כל הבועות עם כפתורי סינון לפי סוג.
20. **`/knowledge` / `/inspiration` / `/reflection`** — קיצורי דרך לסינון לפי סוג.
21. **`/types`** — הסבר על שלושת הסוגים.
22. **`/recall ביטוי` / `/search`** — חיפוש סמנטי (pgvector cosine, fallback ל־trigram/ilike).
23. **שאלה חופשית על הזיכרון** — "מה אמרתי על השקעות?" → Memory Agent מחזיר תשובה אנושית עם ציטוטים מבועות + facts + events + קבצי Drive.
24. **`/pin <חיפוש>`** — הצמדת בועה ל"לוח אישי" (עד 10).
25. **`/unpin <חיפוש>`** — שחרור הצמדה.
26. **`/board`** — הצגת הלוח האישי. ה־Chief of Staff קורא משם בהקשר.

## משימות (הגשר)

27. **`/tasks`** — לוח המשימות. בחירת משימה הופכת אותה ל"פעילה".
28. **`/task כותרת`** — יצירת משימה חדשה.
29. **`/subtask כותרת`** — תת־משימה למשימה הפעילה.
30. **שלושה סטטוסים** — todo / doing / done (לחיצה מעבירה בין סטטוסים).
31. **שלוש רמות עדיפות** — חצים/כפתורים. סידור אוטומטי לפי עדיפות.
32. **משימה מטקסט חופשי** — "צריך לעשות..." / "משימה:" → router → task_create.
33. **מחיקת משימה / תת־משימה** — כפתור מחיקה (משימת־על → מוחקת גם את התת־משימות).

## אירועי יומן

34. **שמירת אירוע יומן מטקסט** — "פגישה עם דנה מחר ב־10" → calendar_event ב־router → יצירה ב־Google Calendar.
35. **default 1 שעה** — אם המשתמש לא ציין משך — האירוע נמשך שעה.
36. **`/cal next 7d`** — אירועים ביומן ב־7 הימים הקרובים (גם 1d, 30d).
37. **`/cal עם דנה`** — סינון אירועים לפי שם משתתף/תיאור.
38. **`/today`** — סיכום יומי: אירועי היום + תזכורות + משימות (עם Claude composer).

## סיכום יומי אוטומטי

39. **`/summary on 07:00`** — מפעיל סיכום יומי אוטומטי בשעה שנבחרה. הסיכום מורכב מ־Claude בזמן ההישלחה.
40. **`/summary off`** — כיבוי.
41. **`/summary status`** — בדיקת מצב.

## ארגז זיכרון — קבצים

42. **תמונות 📸** — שולח תמונה → OCR (Claude Vision) → תוכן בבועה. אופציה לעיבוד.
43. **PDF 📄** — שולח PDF → סיכום עם Claude → בועה.
44. **קבצים אחרים** — שמורים כ־blob ב־Supabase Storage עם metadata.
45. **`/extract` על תמונה** — חולץ פעולות (משימות/פריטים) ויוצר אותם אוטומטית — Image-to-Action.

## חברים ושיתוף (Phase 4)

46. **`/invite`** — יצירת קישור הזמנה לחבר.
47. **`/start inv_<id>`** — חבר ניצל את ההזמנה והופך לחבר.
48. **`/friends`** — רשימת חברים עם כפתור הסרה.
49. **`/share list <שם> @חבר`** — שיתוף רשימה (גם task, bubble).
50. **`/share status`** — מה שיתפתי + כפתור ביטול שיתוף.
51. **`/shared`** — מה שותף איתי (inbox שיתופים).
52. **`/share obsidian <חיפוש>`** — דחיפת בועה ספציפית לוולט Obsidian שלך ב־Drive.

## Google Drive

53. **`/connect drive`** — חיבור OAuth ל־Drive.
54. **`/drive ביטוי`** — חיפוש fullText בכל הקבצים ב־Drive (לא רק שלי).
55. **`/disconnect`** — ניתוק.

## Obsidian sync (one-way ל־Drive)

56. **`/obsidian on`** — יוצר תיקיית `Tachles` ב־Drive עם תת־תיקיות (Wellspring/Knowledge, Bridge/Tasks, Daily).
57. **`/obsidian off`** — כיבוי הסנכרון (השאר את הקבצים שכבר נכתבו).
58. **`/obsidian sync`** — סנכרון מלא של כל הבועות+המשימות הקיימות.
59. **`/obsidian status`** — בדיקת מצב סנכרון.
60. **סנכרון אוטומטי** — כל בועה/משימה שנוצרת נדחפת אוטומטית כקובץ markdown עם front-matter.

## הקלטות קוליות 🎤

61. **תמלול אוטומטי** — שליחת הודעה קולית → OpenAI gpt-4o-transcribe (עברית native) → ניתוב.
62. **חתימת תוכן** — תמלול מנותב כמו טקסט רגיל (תזכורת/רשימה/משימה/בועה).
63. **הגנה על הקלטות ארוכות** — קובץ מעל 24MB נדחה עם הודעה ידידותית להבקש לחתוך לקטעים.

---

## שכבת סוכנים (Phase 6-8 + 10-11)

### Event log

64. **`events`** — כל פעולה (הודעה נכנסת, פקודה, intent, יצירת בועה/משימה/תזכורת, callback, summary_sent, reminder_fired, וכו') נכתבת ב־DB עם timestamp + payload.
65. **`/inbox`** — 40 הפעולות האחרונות בקיבוץ לפי יום.

### User facts (SCD)

66. **חילוץ עובדות אוטומטי** — אחרי כל הודעה חופשית, Claude מחלץ עובדות מובנות על המשתמש (priority/goal/preference/relationship/routine/value/constraint/meta) ושומר ב־`user_facts`.
67. **תוקף לאורך זמן (SCD)** — עובדה חדשה עם אותו subject+predicate סוגרת את הקודמת (valid_to=now) ופותחת חדשה. תמיד יודעים מה היה נכון בכל נקודה.
68. **`/people`** — קשרים שאוספו מ־user_facts type=relationship.

### Snapshots יומיים

69. **`state_snapshots`** — כל לילה ב־23:30 רץ cron שכותב snapshot של כל משתמש: משימות פתוחות, משימות שנסגרו בשבוע, בועות חדשות, תזכורות שירו, ממוצעי שינה/mood/אימון/עומס יומן ל־7 ימים.
70. **`/stats`** — דשבורד מילולי שמשווה השבוע האחרון מול הקודם, עם חצים ↑↓.

### Conditional reminders

71. **`inactivity`** — fire אם אין event מסוג מסוים ב־N ימים.
72. **`streak_break`** — fire אם נשבר streak של event יומי.
73. **`threshold`** — fire אם סכום payload.value מעל/מתחת לסף.
74. **דיכוי חזרות** — אחרי fire ה־run_at נדחה ב־24h.

### בריאות (Phase 7)

75. **`/health sleep 6.5`** / **`/health mood 7`** וכו' — רישום מטריקה ידני.
76. **`/health`** (בלי ארגומנט) — ממוצעי 7 ימים לכל מטריקה.
77. **רישום מטקסט חופשי** — "ישנתי 7 שעות" / "מצב רוח 8" / "עשיתי 40 דק כושר" — router מזהה כ־health_log.
78. **מטריקות נתמכות** — sleep_hours, mood_1_10, workout_minutes, water_ml, weight_kg, pain_1_10, meds_taken, steps. עם aliases בעברית ("שינה", "מצב רוח", "אימון" וכו').

### Agent platform

79. **Registry של סוכנים** — כל סוכן הוא שורה בטבלת `agents` + מודול TS שמרשם את עצמו עם system_prompt + context loader.
80. **agent-tick cron** — pg_cron POSTing every 15 min → Edge Function שעוברת על כל הסוכנים × כל המשתמשים ופועלת לפי cron expression בזמן המקומי של כל משתמש.
81. **runner גנרי** — טוען context, קורא ל־Claude עם 2 כלים (`send_message`/`noop`), מאפשר לסוכן לבחור לשתוק.
82. **output policy** — `quiet_hours`, `max_per_day`, `dedupe_window_minutes`, `min_confidence_to_send` פר־סוכן.
83. **ad-hoc triggers** — Anti-Chaos נכנס אד־הוק כשעוברים 10 משימות פתוחות; Health Intelligence נכנס אחרי 7 ימי רישום רצוף.

### חמשת הסוכנים

84. **ראש מטה (`chief_of_staff`)** — פעמיים ביום (08:00, 19:00). בודק יומן/משימות/facts/snapshot. ברירת מחדל: noop. שולח רק כשיש משהו ש**באמת** חשוב. max 2 ביום.
85. **נגד כאוס (`anti_chaos`)** — יום שני בבוקר. מציע מה לבטל / לחלק / לדחות אם יש overload.
86. **מודיעין בריאות (`health_intelligence`)** — יום ראשון בבוקר (פלוס אד־הוק). מחפש קורלציות בין שינה/mood/אימונים.
87. **סוכן זיכרון (`memory_agent`)** — לא scheduled. נכנס לפעולה כשהמשתמש שואל "מה אמרתי על..." (גם דרך router וגם דרך regex heuristic).
88. **בוקר חכם (`smart_morning`)** — כל בוקר 07:00. patch קצר וידידותי: יומן + משימה בולטת + שינה של אתמול.
89. **`/timeline שבוע / חודש / 2026-04`** — narrative summary של תקופה (events + bubbles + tasks).
90. **`/agents`** — רואים את כל הסוכנים עם סטטוס + מספר הודעות ב־7 ימים האחרונים.
91. **`/agents enable <name>` / `/agents disable <name>`** — הפעלה/כיבוי פר־משתמש.

### Feedback loop

92. **כפתורי 👍/👎** — מתחת לכל הודעת סוכן. נשמר ב־`agent_runs.feedback`.
93. **התאמה אוטומטית** — אחרי 3 דירוגי "רעש" רצופים על אותו סוכן, ה־`min_confidence_to_send` עולה ב־0.1 (cap 0.95) דרך `user_agent_settings.policy_override`.

### `/focus` (Phase 10)

94. **`/focus`** — 3 שורות שמרכיבות ב־Claude מהיומן + 5 משימות חשובות + facts: "🎯 הכי חשוב היום" / "➕ אופציה" / "⏸️ מה לדחות".

---

## אינטגרציות

### Supabase (Cloud)

95. **Postgres** — DB ראשי, כל הטבלאות.
96. **pgvector** — embeddings 1536-dim לחיפוש סמנטי בבועות. RPC `match_bubbles` עם ivfflat cosine.
97. **pg_trgm** — fallback לחיפוש trigram כשאין embedding.
98. **pg_cron** — schedules: dispatch-reminders (כל דקה), sync-calendars (כל 15 דק'), agent-tick (כל 15 דק'), snapshot-daily (23:30 יומי).
99. **pg_net** — pg_cron עושה HTTP POST ל־Edge Functions.
100. **Vault** — מאחסן את ה־DISPATCH_SECRET וה־URLs של ה־Edge Functions (לא בקוד).
101. **Storage** — bucket `memory-trunk` לקבצים שהמשתמש שולח.
102. **Edge Functions** — 7 פונקציות: `telegram-webhook`, `dispatch-reminders`, `sync-calendars`, `oauth-callback`, `agent-tick`, `snapshot-daily`, `api`.
103. **RLS** — מופעל על כל הטבלאות אבל **ללא user-facing policies**. שכבת השירות עוקפת RLS עם service-role key; הבעלות נאכפת בקוד עם `eq("owner_id", profile.id)`.

### Telegram

104. **Bot API** — webhook עם `x-telegram-bot-api-secret-token` header. HTML parse mode (`<b>`, `<i>`, `<code>`, `<a>`).
105. **callback queries** — לכל הכפתורים (cancel, toggle, bset, tprio, agentfb וכו').
106. **קבצים** — getFile + הורדה ישירה (תמונה/PDF/קול/מסמך).

### Anthropic (Claude)

107. **Claude Sonnet 4.6** — ברירת מחדל. נקרא ל־intent routing, fact extraction, daily summary composer, /focus, recall answer, agent decisions.
108. **Prompt caching** — `cache_control: ephemeral` על system + tool schema כדי לחסוך עלות בכל הקריאות החוזרות.
109. **Tool-use** — forced tool calls (`route_message`, `save_reminder`, `emit_facts`, `send_message`/`noop`).
110. **Multi-tool-use** — router מאפשר מספר tool_use blocks בקריאה אחת (multi-intent).

### OpenAI

111. **text-embedding-3-small** — embeddings 1536-dim לבועות.
112. **gpt-4o-transcribe** — תמלול קולי בעברית (native).
113. **הגנה על קבצים גדולים** — מעל 24MB → דחיית הקלטה עם הודעה.

### Google OAuth + Calendar + Drive

114. **OAuth 2.0** — `/connect` (calendar.events, calendar.readonly, openid, email), `/connect drive` (drive.file, drive.readonly).
115. **oauth-callback** — נפרס עם `--no-verify-jwt` כי גוגל פונה אליו לא־חתום.
116. **state token** — atomic delete-if-valid דרך `oauth_states`.
117. **refresh** — `ensureFreshToken` מרענן את הטוקן בעצלות לפני כל קריאה.
118. **Calendar — read** — sync-calendars cron מושך אירועים מ־`calendar_events` לתצוגה ב־`/today`.
119. **Calendar — write** — יצירת אירועים מ־"פגישה עם דנה מחר ב־10".
120. **Drive — search** — `/drive ביטוי` עם fullText על כל הקבצים.
121. **Drive — Obsidian export** — כתיבת markdown לתיקיית `Tachles/...` עם mapping ב־`obsidian_exports`.

---

## ממשק משתמש בטלגרם (UX Level 1)

122. **`/menu` — תפריט ראשי** — מקלדת inline 2×5: היום · תזכורות · רשימות · בועות · משימות · אירועים · סוכנים · תיבת נכנס · פוקוס · עזרה. כל כפתור (`menu:<key>`) מנתב ל־handler הקיים.
123. **סרגל תחתון קבוע** — Reply Keyboard שנשלח ב־`/start`: 📅 היום · 🔔 תזכורות · 📝 רשימות · 🧠 בועות · ✅ משימות · ⚙️ עוד. הלחיצה מגיעה כטקסט וממופה לפקודה (`BAR_MAP`); "עוד" פותח את `/menu`.
124. **רשימת פקודות מאוצרת** — 11 פקודות גלויות באוטוקומפליט (`menu`, `today`, `reminders`, `lists`, `memories`, `tasks`, `events`, `agents`, `inbox`, `connect`, `help`) נרשמות דרך `scripts/setup-telegram-ui.ts` (`setMyCommands`, default + he). שאר הפקודות עובדות אך מוסתרות. אידמפוטנטי — מריצים שוב אחרי כל שינוי ברשימה.
125. **כפתור תפריט (menu button)** — מצביע ל־Mini App כש־`MINI_APP_URL` מוגדר, אחרת ברירת מחדל (רשימת הפקודות).

## Telegram Mini App (`apps/mini-app`)

126. **אפליקציית SvelteKit** — SPA סטטי (`adapter-static`) + Tailwind RTL, נטענת כ־webview בתוך טלגרם דרך `telegram-web-app.js`.
127. **אימות `initData`** — כל בקשה נושאת header `X-Telegram-InitData`; פונקציית `api/` מאמתת HMAC + טריות `auth_date` (24h) דרך `verifyInitData` וממפה למשתמש דרך `getOrCreateProfile`. אין login/session. נפרסת `--no-verify-jwt`.
128. **`api/` — REST ל־Mini App** — עוטפת בדיוק את אותם שירותי `_shared/` של הבוט (reminders / lists / tasks / memories / calendar_sync / events / router), בלי לוגיקה כפולה. כתיבת אירועי יומן עדיין לא נחשפת.
129. **מסכים** — בית, יומן, רשימות (+ מסך רשימה בודדת), בועות, משימות, סוכנים, הגדרות.
130. **ניווט תחתון** — סרגל טאבים תחתון, כולל טאב סוכנים.
131. **deep links** — `https://t.me/<bot>/tachles?startapp=<יעד>` פותח מסך ישירות: `calendar`, `lists`, `tasks`, `memories`, `agents`, `settings`, או `list_<id>`.
132. **פוליש** — מעברי מסך, skeletons בזמן טעינה, favicon.
133. **CORS allowlist** — ה־`api` מגביל origin ל־Mini App (ברירת מחדל לכתובת Vercel, ניתן לדריסה ב־`MINI_APP_URL`); הגנת עומק מעבר לאימות ה־initData.
134. **פריסה** — `npm run build` → אירוח סטטי ב־HTTPS (Vercel) עם `vercel.json` (SPA fallback rewrites); הגדרת האפליקציה ב־BotFather (`/myapps`) + `MINI_APP_URL`.

## טוקנים וסודות נדרשים

ב־`.env.local` (לפיתוח ולסקריפטים של דפלוי, gitignored) וגם ב־`supabase secrets` (ל־Edge Functions בענן):

| שם | מטרה |
|---|---|
| `TELEGRAM_BOT_TOKEN` | מ־BotFather. מאמת קריאות החוצה ל־Telegram API. |
| `TELEGRAM_WEBHOOK_SECRET` | רנדומלי. בודק כל webhook נכנס. |
| `SUPABASE_PROJECT_REF` | מזהה הפרויקט (`<ref>`). |
| `SUPABASE_DB_PASSWORD` | סיסמת ה־DB ל־`supabase db push`. |
| `SUPABASE_ACCESS_TOKEN` | PAT לסקריפט deploy (sbp_*). |
| `DISPATCH_SECRET` | רנדומלי. בודק שקריאות pg_cron ל־dispatch/agent-tick/snapshot חוקיות. |
| `ANTHROPIC_API_KEY` | מ־Anthropic Console. |
| `LLM_MODEL` (אופציונלי) | דריסה של ברירת המחדל `claude-sonnet-4-6`. |
| `GOOGLE_CLIENT_ID` | מ־Google Cloud Console (OAuth 2.0 client). |
| `GOOGLE_CLIENT_SECRET` | מ־Google Cloud Console. |
| `OPENAI_API_KEY` | מ־OpenAI dashboard. |
| `OPENAI_TRANSCRIBE_MODEL` (אופציונלי) | דריסה של ברירת המחדל `gpt-4o-transcribe`. |

ב־Google Cloud Console נדרשים: OAuth consent screen מאושר, Authorized redirect URI = `https://<ref>.supabase.co/functions/v1/oauth-callback`, scopes מאופשרים (Calendar API + Drive API).

---

## מה לא נכנס למוצר (deferred)

רעיונות לעתיד שעדיין לא מומשו:

- **Life CFO + expenses** - "סמנכ"ל כספים אישי": מעקב הוצאות/הכנסות, תקציב והתראות.
- **Relationship Guardian פעיל** - שומר על קשרים: מזכיר ימי הולדת או "לא דיברת עם X כבר חודשיים".
- **AI Journal ערב** - יומן ערב מונחה: שאלות רפלקציה לסיכום היום, ביוזמתך.
- **Decision Auditor** - מתעד החלטות והנימוק שלהן, ובודק בדיעבד אם התבררו כטובות.
- **Anti-Procrastination** - מזהה דחיינות ועוזר לפרק משימה ולהתחיל אותה.
- **Learning Synthesizer + KG** - לוקח מה שלמדת, מסכם, ובונה גרף ידע שמקשר רעיונות זה לזה.
- **Family Helper + shared inboxes** - מצב משפחתי: רשימות/משימות בתיבות משותפות לכל המשפחה.
- **Context Awareness (location)** - מודעות למיקום: תזכורת שמופעלת "כשתגיע לסופר".
- **Passive Intelligence** - אוסף תובנות ברקע בלי שתבקש, ומציף את מה שחשוב.
- **Future Self Simulator** - מדמה את "האני העתידי": איך החלטות של היום ישפיעו עליך בהמשך.
- **AI Reflection ערב** - רפלקציית ערב, אבל ביוזמת המערכת (לעומת היומן שאתה פותח).
- **/searchall (Second Brain)** - חיפוש אחד על פני הכול (בועות, משימות, יומן, קבצים): "מוח שני".
- **War Room dashboard** - לוח בקרה מרכזי עם תצוגת-על של כל המצב במקום אחד.
- **Autonomous Life Assistant** - עוזר שפועל בשמך (מבצע, לא רק מציע).
- **Mood Predictor / Digital Twin** - חוזה מצב רוח / "תאום דיגיטלי" שמדמה אותך כדי לנבא תגובות.

הערה: זו רשימת חזון בלבד - שום דבר מהם לא בנוי כרגע. שתי נקודות שכבר כן קיימות בצורה חלקית: רפלקציה/יומן ערב נוגע למה שהסוכנים עושים, וחיפוש-הכול דומה ל-/find הקיים (שמחפש בבועות+רשימות+משימות, אך לא ביומן/קבצים).
