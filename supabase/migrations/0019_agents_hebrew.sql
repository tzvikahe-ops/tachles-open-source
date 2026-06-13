-- Translate agent role text to Hebrew. The `name` column stays as a stable
-- identifier (used as the argument to /agents enable <name>); only the
-- user-facing role string is rewritten.

update agents set role = 'ראש מטה — מבט פעמיים ביום' where name = 'chief_of_staff';
update agents set role = 'נגד כאוס — בדיקת עומס בוקר שני' where name = 'anti_chaos';
update agents set role = 'מודיעין בריאות — סיכום שבועי ראשון בבוקר' where name = 'health_intelligence';
update agents set role = 'סוכן זיכרון — נכנס לפעולה בשאלות recall' where name = 'memory_agent';
