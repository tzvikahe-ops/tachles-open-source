import { buildRRuleString, nextOccurrence } from "./rrule.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("buildRRuleString emits DTSTART + RRULE in iCal UTC", () => {
  const s = buildRRuleString(new Date("2026-05-27T06:00:00.000Z"), "FREQ=DAILY;BYHOUR=9");
  assertEquals(s, "DTSTART:20260527T060000Z\nRRULE:FREQ=DAILY;BYHOUR=9");
});

Deno.test("nextOccurrence returns the next daily fire strictly after a moment", () => {
  const rule = buildRRuleString(new Date("2026-05-27T06:00:00.000Z"), "FREQ=DAILY");
  const next = nextOccurrence(rule, new Date("2026-05-28T06:00:00.000Z"));
  assertEquals(next?.toISOString(), "2026-05-29T06:00:00.000Z");
});

Deno.test("nextOccurrence returns null after a bounded series ends", () => {
  const rule = buildRRuleString(new Date("2026-05-27T06:00:00.000Z"), "FREQ=DAILY;COUNT=2");
  // Series fires 05-27 and 05-28; nothing strictly after 05-28.
  const next = nextOccurrence(rule, new Date("2026-05-28T06:00:00.000Z"));
  assertEquals(next, null);
});

// What does `instant` read as on the Asia/Jerusalem wall clock?
function jerusalemTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

Deno.test("nextOccurrence(tz) keeps a daily reminder at the same local time across DST", () => {
  // Anchor: 07:00 Asia/Jerusalem on 2025-03-26 (winter, UTC+2) = 05:00Z.
  // Israel springs forward on 2025-03-28; without re-anchoring the fire would
  // drift to 08:00 local. With the timezone passed it must stay 07:00.
  const rule = buildRRuleString(new Date("2025-03-26T05:00:00.000Z"), "FREQ=DAILY");
  const tz = "Asia/Jerusalem";

  const beforeDst = nextOccurrence(rule, new Date("2025-03-26T05:30:00.000Z"), tz);
  assertEquals(beforeDst?.toISOString(), "2025-03-27T05:00:00.000Z"); // still UTC+2
  assertEquals(jerusalemTime(beforeDst!.toISOString()), "07:00");

  const afterDst = nextOccurrence(rule, new Date("2025-03-27T05:30:00.000Z"), tz);
  assertEquals(afterDst?.toISOString(), "2025-03-28T04:00:00.000Z"); // now UTC+3
  assertEquals(jerusalemTime(afterDst!.toISOString()), "07:00");
});

Deno.test("nextOccurrence(tz) holds a weekly BYHOUR reminder steady across DST", () => {
  // Sundays 08:00 local, anchored the Sunday before the DST switch.
  const rule = buildRRuleString(
    new Date("2025-03-23T06:00:00.000Z"),
    "FREQ=WEEKLY;BYDAY=SU;BYHOUR=8;BYMINUTE=0;BYSECOND=0",
  );
  const tz = "Asia/Jerusalem";
  const next = nextOccurrence(rule, new Date("2025-03-23T06:30:00.000Z"), tz);
  // 2025-03-30 is after the switch (UTC+3) → 08:00 local = 05:00Z.
  assertEquals(next?.toISOString(), "2025-03-30T05:00:00.000Z");
  assertEquals(jerusalemTime(next!.toISOString()), "08:00");
});

Deno.test("nextOccurrence(tz) still ends a bounded series", () => {
  const rule = buildRRuleString(new Date("2026-05-27T04:00:00.000Z"), "FREQ=DAILY;COUNT=2");
  const next = nextOccurrence(rule, new Date("2026-05-28T04:30:00.000Z"), "Asia/Jerusalem");
  assertEquals(next, null);
});
