// rrule ships as CommonJS; under Deno only the default export carries the named
// members at runtime, so destructure RRule from it rather than a named import.
import rrulePkg from "rrule";
import { localParts, utcForLocalWallTime } from "./tz.ts";

const { RRule } = rrulePkg;

// Format a Date as an iCal UTC timestamp, e.g. 20260527T060000Z.
function toICalUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// Build a full RRULE string from a first-occurrence anchor and a pattern body.
// `pattern` is the RRULE without DTSTART, e.g. "FREQ=WEEKLY;BYDAY=SU;BYHOUR=8;BYMINUTE=0".
export function buildRRuleString(dtstart: Date, pattern: string): string {
  return `DTSTART:${toICalUtc(dtstart)}\nRRULE:${pattern}`;
}

// Next occurrence strictly after `after`, or null when the series has ended.
//
// When `timezone` is given, each candidate is re-anchored to the wall-clock
// time-of-day the rule was created at, so a "07:00 local" reminder keeps firing
// at 07:00 local across DST transitions. We do this ourselves because rrule has
// no usable timezone support in this runtime (a TZID DTSTART is treated as UTC),
// and a plain UTC DTSTART drifts by 1h twice a year. Without `timezone` the raw
// rrule occurrence is returned (UTC-anchored, legacy behaviour).
export function nextOccurrence(
  rruleStr: string,
  after: Date,
  timezone?: string,
): Date | null {
  const rule = RRule.fromString(rruleStr);
  if (!timezone) return rule.after(after, false);

  // Intended local time-of-day, recovered from the anchor (DTSTART).
  const want = localParts(timezone, rule.options.dtstart);
  // rrule occurrences drift by the DST delta, so a re-anchored candidate can
  // land on or before `after`; step forward until one is strictly after it.
  let cursor = after;
  for (let i = 0; i < 8; i++) {
    const raw = rule.after(cursor, false);
    if (!raw) return null;
    const day = localParts(timezone, raw); // local calendar day it lands on
    const anchored = utcForLocalWallTime(
      timezone,
      day.year,
      day.month,
      day.day,
      want.hour,
      want.minute,
      want.second,
    );
    if (anchored.getTime() > after.getTime()) return anchored;
    cursor = raw;
  }
  return null;
}
