import { assertEquals } from "jsr:@std/assert@1";
import { notificationBody } from "../_shared/integrations/web_push.ts";

Deno.test("notificationBody removes Telegram HTML and avoids repeating the title", () => {
  assertEquals(notificationBody("<b>לקנות חלב</b>", "לקנות חלב"), "הגיע הזמן.");
  assertEquals(
    notificationBody("<b>סיכום</b>\n• פגישה בעשר", "היום שלך"),
    "סיכום • פגישה בעשר",
  );
});

Deno.test("notificationBody limits long push messages", () => {
  const body = notificationBody("א".repeat(300), "כותרת");
  assertEquals(body.length, 240);
  assertEquals(body.endsWith("..."), true);
});
