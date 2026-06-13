import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../profiles.ts";
import { listRecentEvents } from "../events.ts";

// Generates a narrative timeline for a given window. Triggered by /timeline.
// Pulls events + done tasks + new bubbles, hands them to Claude with a brief
// "tell me what happened" prompt.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

const SYSTEM = `אתה כותב סיכום נרטיבי קצר על תקופת זמן בחיי המשתמש לפי הנתונים שיוצגו לך.

עקרונות:
- כתוב כאילו אתה מספר סיפור קצר על מה שעבר עליו — לא טבלה.
- חלק לפי נושאים בולטים (עבודה, בריאות, אנשים, רעיונות) אם יש משהו לחלק.
- 6-15 שורות. עברית טבעית. בלי כותרות גרנדיוזיות.
- ציין דברים חוזרים, דפוסים שראית, רגעי שיא.
- אל תמציא תוכן. אם הנתונים דלים — אמור זאת בקצרה.`;

interface Window {
  fromIso: string;
  toIso: string;
  label: string;
}

export function parseTimelineWindow(arg: string, timezone: string): Window {
  const trimmed = arg.trim().toLowerCase();
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(now);
  if (trimmed === "" || trimmed === "שבוע" || trimmed === "week") {
    const from = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    return { fromIso: from, toIso: now.toISOString(), label: `שבוע שעבר (${today})` };
  }
  if (trimmed === "חודש" || trimmed === "month") {
    const from = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    return { fromIso: from, toIso: now.toISOString(), label: `30 ימים אחרונים` };
  }
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const [y, m] = trimmed.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
    const end = new Date(Date.UTC(y, m, 1)).toISOString();
    return { fromIso: start, toIso: end, label: `${trimmed}` };
  }
  if (/^\d+$/.test(trimmed)) {
    const days = Number(trimmed);
    const from = new Date(now.getTime() - days * 86_400_000).toISOString();
    return { fromIso: from, toIso: now.toISOString(), label: `${days} ימים אחרונים` };
  }
  // fallback: week
  const from = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  return { fromIso: from, toIso: now.toISOString(), label: `שבוע שעבר` };
}

interface AnthropicBlock {
  type: string;
  text?: string;
}

export async function buildTimeline(
  supabase: SupabaseClient,
  profile: Profile,
  window: Window,
): Promise<string> {
  const events = await listRecentEvents(supabase, profile.id, 300, window.fromIso);
  // Filter events to the window's upper bound; listRecentEvents only takes since.
  const within = events.filter((e) => e.occurred_at < window.toIso);

  // Done tasks in the window.
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, status, updated_at, created_at")
    .eq("owner_id", profile.id)
    .gte("updated_at", window.fromIso)
    .lt("updated_at", window.toIso);

  // New bubbles in the window.
  const { data: bubbles } = await supabase
    .from("memory_bubbles")
    .select("id, type, content, tags, created_at")
    .eq("owner_id", profile.id)
    .gte("created_at", window.fromIso)
    .lt("created_at", window.toIso)
    .order("created_at", { ascending: true });

  const ctx = {
    window: window.label,
    events_count: within.length,
    event_kinds_breakdown: within.reduce<Record<string, number>>((acc, e) => {
      acc[e.kind] = (acc[e.kind] ?? 0) + 1;
      return acc;
    }, {}),
    bubbles: (bubbles ?? []).map((b) => ({
      type: b.type,
      preview: (b.content as string).slice(0, 200),
      tags: b.tags,
      at: b.created_at,
    })),
    tasks: tasks ?? [],
    sample_events: within.slice(0, 60).map((e) => ({
      kind: e.kind,
      at: e.occurred_at,
      payload: e.payload,
    })),
  };

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return "אין מפתח Anthropic מוגדר.";
  const model = Deno.env.get("LLM_MODEL") ?? DEFAULT_MODEL;
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify(ctx) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: AnthropicBlock[] };
  const text = data.content?.find((b) => b.type === "text")?.text;
  return text?.trim() ?? "לא הצלחתי לבנות timeline.";
}
