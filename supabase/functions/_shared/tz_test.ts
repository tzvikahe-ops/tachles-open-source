import { nextLocalTime, parseHHMM } from "./tz.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("parseHHMM accepts HH:MM and HH:MM:SS, rejects garbage", () => {
  assertEquals(parseHHMM("07:00"), { hour: 7, minute: 0 });
  assertEquals(parseHHMM("23:59:59"), { hour: 23, minute: 59 });
  assertEquals(parseHHMM("7:5"), null);
  assertEquals(parseHHMM("25:00"), null);
  assertEquals(parseHHMM("not time"), null);
});

Deno.test("nextLocalTime picks today if not yet past, else tomorrow", () => {
  // Force a fixed "now" (UTC noon on a known summer day in Asia/Jerusalem = 15:00 local).
  const now = new Date("2026-07-15T12:00:00Z");
  const at7 = nextLocalTime("Asia/Jerusalem", 7, 0, now); // 07:00 local already passed
  // 07:00 Asia/Jerusalem on 2026-07-16 = 04:00 UTC (DST = UTC+3 in summer).
  assertEquals(at7.toISOString(), "2026-07-16T04:00:00.000Z");

  const at18 = nextLocalTime("Asia/Jerusalem", 18, 0, now); // 18:00 local still ahead today
  assertEquals(at18.toISOString(), "2026-07-15T15:00:00.000Z");
});

Deno.test("nextLocalTime tracks winter (UTC+2) for Asia/Jerusalem", () => {
  const now = new Date("2026-01-15T05:00:00Z"); // 07:00 local
  const at8 = nextLocalTime("Asia/Jerusalem", 8, 0, now);
  // 08:00 Asia/Jerusalem winter = 06:00 UTC.
  assertEquals(at8.toISOString(), "2026-01-15T06:00:00.000Z");
});
