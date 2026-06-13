// Tiny timezone helpers. We compute UTC for a given local wall-clock time by
// formatting a candidate UTC date back into the target timezone and inverting
// the observed offset. This is exact at all instants except inside the ~1h DST
// gap/overlap (where local "02:30" doesn't exist or is ambiguous), which these
// helpers resolve to one of the two adjacent offsets. Recurring reminders use
// these via nextOccurrence to stay anchored to local wall-clock time across DST
// transitions (see rrule.ts).

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

// Break a UTC instant into the wall-clock parts an observer in `timezone` reads.
export function localParts(timezone: string, instant: Date): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMs(timezone: string, atUtcMs: number): number {
  // What does this UTC moment look like in the target timezone?
  const p = localParts(timezone, new Date(atUtcMs));
  const tzMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return tzMs - atUtcMs;
}

// Inverse of localParts: the UTC instant at which `timezone`'s wall clock reads
// the given local date+time. Exact except inside the ~1h DST gap/overlap, where
// it resolves to one of the two adjacent offsets.
export function utcForLocalWallTime(
  timezone: string,
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(naive - offsetMs(timezone, naive));
}

// Returns the UTC Date for the next occurrence of `HH:MM` local wall-clock time
// in `timezone`, strictly after `now`.
export function nextLocalTime(
  timezone: string,
  hour: number,
  minute: number,
  now: Date = new Date(),
): Date {
  // Today's local date in the target timezone.
  const localDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = localDateStr.split("-").map(Number);

  // Naive: pretend the wall-clock time is UTC; then correct by the actual offset.
  const naiveUtcMs = Date.UTC(y, m - 1, d, hour, minute, 0);
  let target = new Date(naiveUtcMs - offsetMs(timezone, naiveUtcMs));
  if (target.getTime() <= now.getTime()) {
    const next = naiveUtcMs + 86_400_000;
    target = new Date(next - offsetMs(timezone, next));
  }
  return target;
}

// Parse "HH:MM" or "HH:MM:SS" -> {hour, minute}; returns null on bad input.
export function parseHHMM(input: string): { hour: number; minute: number } | null {
  const m = input.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}
