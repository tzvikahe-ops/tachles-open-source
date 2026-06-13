// Hebrew (he-IL) date/time formatting. The user's timezone is enforced
// server-side; here we render in the device locale, which for the Mini App is
// the same user. Asia/Jerusalem is the product default.

const TZ = "Asia/Jerusalem";

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

// "2026-05-28" key in the user's timezone, for grouping events by day.
export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// Compact relative time in Hebrew, handles past + future:
// "לפני 5 ד׳", "בעוד 2 שעות", "מחר 09:00", "בעוד 3 ימים".
export function formatRelative(iso: string): string {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = target - now;
  const absMin = Math.round(Math.abs(diffMs) / 60_000);
  const isFuture = diffMs >= 0;
  const prefix = isFuture ? "בעוד" : "לפני";
  if (absMin < 1) return "עכשיו";
  if (absMin < 60) return `${prefix} ${absMin} ד׳`;
  const absHour = Math.round(absMin / 60);
  if (absHour < 6) return `${prefix} ${absHour} ש׳`;
  const todayKey = dayKey(new Date(now).toISOString());
  const targetKey = dayKey(iso);
  if (todayKey === targetKey) return `היום ${formatTime(iso)}`;
  if (isFuture) {
    const tomorrow = new Date(now + 86_400_000);
    if (dayKey(tomorrow.toISOString()) === targetKey) return `מחר ${formatTime(iso)}`;
  } else {
    const yesterday = new Date(now - 86_400_000);
    if (dayKey(yesterday.toISOString()) === targetKey) return `אתמול ${formatTime(iso)}`;
  }
  const absDays = Math.round(Math.abs(diffMs) / 86_400_000);
  if (absDays < 7) return `${prefix} ${absDays} ימים`;
  return formatDateTime(iso);
}

// "בוקר טוב" / "צהריים טובים" / "ערב טוב" / "לילה טוב" by local hour.
export function greetingForHour(hour: number): string {
  if (hour < 5) return "לילה טוב";
  if (hour < 12) return "בוקר טוב";
  if (hour < 17) return "צהריים טובים";
  if (hour < 21) return "ערב טוב";
  return "לילה טוב";
}
