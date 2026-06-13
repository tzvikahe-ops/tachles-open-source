import { assertEquals } from "jsr:@std/assert@1";
import { normalizeEvent } from "./google.ts";

Deno.test("normalizeEvent preserves Google version metadata", () => {
  const result = normalizeEvent({
    id: "event-1",
    etag: '"version-2"',
    updated: "2026-06-13T08:15:00Z",
    htmlLink: "https://calendar.google.com/event?eid=event-1",
    summary: "פגישה",
    start: { dateTime: "2026-06-13T10:00:00+03:00" },
    end: { dateTime: "2026-06-13T11:00:00+03:00" },
  }, "primary");

  assertEquals(result?.google_etag, '"version-2"');
  assertEquals(result?.google_updated_at, "2026-06-13T08:15:00Z");
  assertEquals(result?.html_link, "https://calendar.google.com/event?eid=event-1");
  assertEquals(result?.all_day, false);
});

Deno.test("normalizeEvent converts all-day dates to an exclusive range", () => {
  const result = normalizeEvent({
    id: "event-2",
    summary: "חופשה",
    start: { date: "2026-06-14" },
    end: { date: "2026-06-16" },
  }, "primary");

  assertEquals(result?.start_at, "2026-06-14T00:00:00Z");
  assertEquals(result?.end_at, "2026-06-16T00:00:00Z");
  assertEquals(result?.all_day, true);
});
