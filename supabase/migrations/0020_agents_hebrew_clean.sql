-- Earlier migration 0019 set role to "ראש מטה — מבט פעמיים ביום" etc., but the
-- /agents UI now prepends a Hebrew display label, so the role was repeated.
-- Rewrite role to just the description.

update agents set role = 'מבט יומי קצר על המצב — הודעה רק כשבאמת חשוב' where name = 'chief_of_staff';
update agents set role = 'מזהה עומס משימות ומציע מה לדחות / לבטל / לחלק' where name = 'anti_chaos';
update agents set role = 'מקשר בין שינה, מצב רוח ואימונים — תובנה שבועית' where name = 'health_intelligence';
update agents set role = 'עונה על שאלות מהזיכרון: "מה אמרתי על…", "מתי דיברנו על…"' where name = 'memory_agent';
