// Routes a free-text (usually Hebrew) message to the right feature(s) using
// Claude with forced tool-use. The model may emit MULTIPLE route_message
// tool_use blocks when a message contains more than one distinct intent
// (e.g. "תזכיר לי לקנות חלב + שמור שדנה אוהבת אמנות").

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

export type Intent =
  | "reminder"
  | "calendar_event"
  | "list_add"
  | "memory_save"
  | "task_create"
  | "health_log"
  | "recall_question"
  | "conditional_reminder"
  | "unclear";

export interface RoutedReminder {
  intent: "reminder";
  title: string;
  body: string | null;
  schedule_type: "once" | "recurring";
  run_at: string; // ISO 8601 with offset
  recurrence: string | null; // iCal RRULE body without DTSTART
}

export interface RoutedCalendarEvent {
  intent: "calendar_event";
  title: string;
  description: string | null;
  location: string | null;
  start_at: string; // ISO 8601 with offset
  end_at: string; // ISO 8601 with offset
  all_day: boolean;
}

export interface RoutedListAdd {
  intent: "list_add";
  items: string[]; // one item per element, already split
  list_name: string | null; // null = active list
  suggested_followup: string | null; // e.g. "use /share to share this list"
}

export interface RoutedMemorySave {
  intent: "memory_save";
  content: string;
  tags: string[];
  bubble_type: "knowledge" | "inspiration" | "reflection" | null;
}

export interface RoutedTaskCreate {
  intent: "task_create";
  title: string;
}

export interface RoutedHealthLog {
  intent: "health_log";
  metric: string; // raw metric token; webhook normalizes via normalizeMetric()
  value: number;
  unit: string | null;
  occurred_at: string | null; // ISO 8601 with offset; null = now
  note: string | null;
}

export interface RoutedRecallQuestion {
  intent: "recall_question";
  question: string;
}

export interface RoutedConditionalReminder {
  intent: "conditional_reminder";
  title: string;
  body: string | null;
  event_kind: string; // matches events.kind, e.g. "message_in"
  condition_type: "inactivity" | "streak_break" | "threshold";
  condition_params: Record<string, unknown>;
}

export interface RoutedUnclear {
  intent: "unclear";
  clarification: string; // short Hebrew question
}

export type Routed =
  | RoutedReminder
  | RoutedCalendarEvent
  | RoutedListAdd
  | RoutedMemorySave
  | RoutedTaskCreate
  | RoutedHealthLog
  | RoutedRecallQuestion
  | RoutedConditionalReminder
  | RoutedUnclear;

const SYSTEM = `You are the intent router for "תכלס", a Hebrew personal-assistant bot.
Classify the user's free-text message into one or more intents and return each
structured payload by calling the route_message tool. **Call the tool ONCE PER
INTENT.** Most messages have a single intent; call it multiple times only when
the message clearly bundles distinct actions ("תזכיר לי X + שמור Y").

The user turn provides CURRENT_DATETIME (ISO 8601 with offset) and TIMEZONE (IANA name).

Intents:

1. "reminder" — user wants the bot itself to ping them at a specific time (one-time or recurring).
   Signals: "תזכיר לי", "תזכורת", "תזכור להזכיר לי". An explicit personal action ("לקחת תרופה",
   "להוציא כביסה") at a time — usually solo, no third party. Recurring patterns ("כל בוקר").
   Required: title (concise, user's language), schedule_type ("once" | "recurring"),
   run_at (ISO 8601 WITH the offset that TIMEZONE has at that moment — never invent times).
   For recurring: recurrence = iCal RRULE body WITHOUT DTSTART (e.g.
   "FREQ=WEEKLY;BYDAY=SU;BYHOUR=8;BYMINUTE=0;BYSECOND=0"), and run_at MUST equal the first
   occurrence at or after CURRENT_DATETIME.

2. "calendar_event" — user wants an entry in their external calendar (Google Calendar).
   Signals: "תקבע פגישה", "פגישה עם", "תוסיף ליומן", "אסיפה", "פגישת עבודה", a meeting with another
   person, an event at a place. Has a START time and usually a duration (default 1 hour if
   unspecified). NOT recurring unless explicit; for recurring meetings still use this intent
   (we'll create separate events for now — leave repetition out of scope).
   Required: title, start_at + end_at (ISO 8601 with offset), all_day (true if user says "כל היום"
   or no time given for a date-only request). Optional location, description.

3. "list_add" — user wants to add items to a list (shopping, todo-style enumerations).
   Signals: "תוסיף לרשימה", "קניות", dictation-like lists, imperative noun lists w/o time.
   Required: items (array, one normalized phrase per element). Optional list_name.

4. "memory_save" — user wants to remember knowledge, an idea, an insight, a reflection
   (no action, no time). Signals: "תזכור ש...", "רעיון:", "תובנה:", URLs, quotes, facts.
   Required: content. Optional tags (without #) and bubble_type
   ("knowledge"/"inspiration"/"reflection").

5. "task_create" — user wants a task on their task board (action/goal, no specific time).
   Signals: "משימה:", "צריך לעשות", project-style outcomes.
   Required: title.

6. "health_log" — user reports a self-measurement: sleep, mood, workout, water, weight, pain, meds, steps.
   Signals (Hebrew): "ישנתי 6 שעות", "מצב רוח 7", "עשיתי 40 דק כושר", "שתיתי 2 ליטר", "שקלתי 81",
   "כאב 6", "לקחתי תרופות". (English aliases also fine: "sleep 7", "mood 8".)
   Required: metric (one of: sleep_hours, mood_1_10, workout_minutes, water_ml, weight_kg, pain_1_10,
   meds_taken, steps — or the user's Hebrew shorthand like "שינה", "מצב רוח"), value (number).
   Optional: unit, occurred_at (default now), note.
   NOT to be confused with reminder ("תזכיר לי לרשום שינה" → reminder, not health_log).

7. "recall_question" — user is asking the bot to recall something from past conversations / bubbles /
   events. Signals: "מה אמרתי על...", "מתי דיברנו על...", "תזכיר לי מה אמרנו על...", "איך קראו ל...",
   "מה כתבתי על...". A QUESTION about the past, not a new memory save.
   Required: question (the full original question text).

8. "conditional_reminder" — user wants a reminder that fires only if a condition about activity is
   (or isn't) met. Signals: "אם לא התקשרתי לאמא השבוע — תזכיר", "תזכיר לי אם לא עשיתי כושר 3 ימים",
   "תתריע אם לא רשמתי שינה יומיים". Distinguished from plain "reminder" by the conditional phrasing.
   Required: title, event_kind (one of: message_in, bubble_created, task_created, task_status_changed,
   reminder_fired, health_logged), condition_type (one of: inactivity, streak_break, threshold),
   condition_params (jsonb). Examples:
   - inactivity: { window_days: 7, payload_match?: {metric:"workout_minutes"} }
   - streak_break: { gap_days: 2, payload_match?: {metric:"sleep_hours"} }
   - threshold: { agg:"sum_value", limit: 5, window_days: 7, payload_match?: {metric:"workout_minutes"} }

9. "unclear" — the request is ambiguous, not actionable as-is, OR requires a step the bot
   cannot do via free text (sharing, connecting accounts, inviting friends, etc.).
   Required: clarification (short Hebrew message).
   IMPORTANT: If the request is CLOSE to a known intent but needs an extra step (e.g. "רשימה
   משותפת" → create the list is possible, but sharing requires /invite + /share), DO the part
   you can (e.g. return list_add to create it) and set suggested_followup to explain the next
   step the user needs. Only return unclear when you truly cannot act on ANY part.
   Optional: suggested_followup (short Hebrew string explaining what command to use for the
   part you couldn't handle, e.g. "כדי לשתף את הרשימה, קודם הזמינו את בן/בת הזוג עם /invite ואז /share list קניות @שם").

Disambiguation:
- reminder vs calendar_event: pings the user vs adds to their calendar with other people / a
  location. "תזכיר לי לקחת ויטמין ב-7" → reminder. "פגישה עם דנה מחר ב-10" → calendar_event.
  When ambiguous, prefer calendar_event if a person/place is named, reminder otherwise.
- Explicit future time + personal action only → reminder.
- Multiple short items, no time → list_add.
- Single goal/outcome, no time → task_create.
- Knowledge / insight / URL without action → memory_save.
- Self-measurement (number + body/activity domain) → health_log.
- Question about the past → recall_question.
- "If ... then remind" → conditional_reminder.
- "רשימה משותפת עם X" / "שיתוף רשימה" → list_add (create the list), with suggested_followup
  explaining how to share: /invite to add friend, then /share list <name> @friend.
- Never invent times. If a request is calendar-shaped but missing a time → return unclear.`;

const TOOL = {
  name: "route_message",
  description:
    "Classify ONE intent and return its structured payload. Call again for each additional intent in the message.",
  input_schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: [
          "reminder",
          "calendar_event",
          "list_add",
          "memory_save",
          "task_create",
          "health_log",
          "recall_question",
          "conditional_reminder",
          "unclear",
        ],
      },
      // reminder fields
      title: { type: ["string", "null"] },
      body: { type: ["string", "null"] },
      schedule_type: { type: ["string", "null"], enum: ["once", "recurring", null] },
      run_at: { type: ["string", "null"], description: "ISO 8601 with offset" },
      recurrence: { type: ["string", "null"], description: "iCal RRULE body without DTSTART" },
      // calendar_event fields (in addition to title above)
      description: { type: ["string", "null"] },
      location: { type: ["string", "null"] },
      start_at: { type: ["string", "null"], description: "ISO 8601 with offset" },
      end_at: { type: ["string", "null"], description: "ISO 8601 with offset" },
      all_day: { type: ["boolean", "null"] },
      // list_add fields
      items: { type: ["array", "null"], items: { type: "string" } },
      list_name: { type: ["string", "null"] },
      // memory_save fields
      content: { type: ["string", "null"] },
      tags: { type: ["array", "null"], items: { type: "string" } },
      bubble_type: {
        type: ["string", "null"],
        enum: ["knowledge", "inspiration", "reflection", null],
      },
      // health_log fields
      metric: { type: ["string", "null"] },
      value: { type: ["number", "null"] },
      unit: { type: ["string", "null"] },
      occurred_at: { type: ["string", "null"], description: "ISO 8601 with offset; null = now" },
      note: { type: ["string", "null"] },
      // recall_question fields
      question: { type: ["string", "null"] },
      // conditional_reminder fields
      event_kind: { type: ["string", "null"] },
      condition_type: {
        type: ["string", "null"],
        enum: ["inactivity", "streak_break", "threshold", null],
      },
      condition_params: { type: ["object", "null"] },
      // unclear fields
      clarification: { type: ["string", "null"] },
      // cross-intent: followup hint when the bot handled part of the request
      suggested_followup: { type: ["string", "null"] },
    },
    required: ["intent"],
  },
} as const;

interface AnthropicContentBlock {
  type: string;
  name?: string;
  input?: unknown;
}
interface AnthropicResponse {
  content?: AnthropicContentBlock[];
}

interface RouterInput {
  intent: Intent;
  title?: string | null;
  body?: string | null;
  schedule_type?: "once" | "recurring" | null;
  run_at?: string | null;
  recurrence?: string | null;
  description?: string | null;
  location?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  all_day?: boolean | null;
  items?: string[] | null;
  list_name?: string | null;
  content?: string | null;
  tags?: string[] | null;
  bubble_type?: "knowledge" | "inspiration" | "reflection" | null;
  metric?: string | null;
  value?: number | null;
  unit?: string | null;
  occurred_at?: string | null;
  note?: string | null;
  question?: string | null;
  event_kind?: string | null;
  condition_type?: "inactivity" | "streak_break" | "threshold" | null;
  condition_params?: Record<string, unknown> | null;
  clarification?: string | null;
  suggested_followup?: string | null;
}

export function normalizeRouted(raw: RouterInput, originalText: string): Routed {
  const intent = raw.intent;
  if (intent === "reminder") {
    if (
      !raw.run_at ||
      !raw.schedule_type ||
      (raw.schedule_type !== "once" && raw.schedule_type !== "recurring")
    ) {
      return {
        intent: "unclear",
        clarification: raw.clarification ??
          'לא הצלחתי להבין מתי להזכיר. נסו למשל: "מחר ב-9 לשלוח דוח".',
      };
    }
    return {
      intent: "reminder",
      title: raw.title ?? originalText.slice(0, 80),
      body: raw.body ?? null,
      schedule_type: raw.schedule_type,
      run_at: raw.run_at,
      recurrence: raw.schedule_type === "recurring" ? (raw.recurrence ?? null) : null,
    };
  }
  if (intent === "calendar_event") {
    if (!raw.start_at) {
      return {
        intent: "unclear",
        clarification: raw.clarification ?? "מתי הפגישה?",
      };
    }
    // Default 1-hour duration if end not provided.
    const start = new Date(raw.start_at);
    const end = raw.end_at ? new Date(raw.end_at) : new Date(start.getTime() + 60 * 60 * 1000);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { intent: "unclear", clarification: "התאריך לא ברור — נסו לנסח אחרת." };
    }
    return {
      intent: "calendar_event",
      title: raw.title?.trim() || originalText.slice(0, 80),
      description: raw.description ?? null,
      location: raw.location ?? null,
      start_at: raw.start_at,
      end_at: end.toISOString(),
      all_day: raw.all_day === true,
    };
  }
  if (intent === "list_add") {
    const items = (raw.items ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
    const list_name = raw.list_name?.trim() || null;
    const suggested_followup = raw.suggested_followup?.trim() || null;
    // Empty items is OK if the user is creating a (named) list and we have a followup
    // hint to surface — e.g. "create a shared shopping list with my wife". Otherwise
    // we have nothing useful to do.
    if (items.length === 0 && !(list_name && suggested_followup)) {
      return {
        intent: "unclear",
        clarification: raw.clarification ?? "מה להוסיף לרשימה?",
      };
    }
    return { intent: "list_add", items, list_name, suggested_followup };
  }
  if (intent === "memory_save") {
    const content = raw.content?.trim() || originalText.trim();
    return {
      intent: "memory_save",
      content,
      tags: (raw.tags ?? []).map((t) => t.replace(/^#/, "").trim()).filter((t) => t.length > 0),
      bubble_type: raw.bubble_type ?? null,
    };
  }
  if (intent === "task_create") {
    const title = raw.title?.trim() || originalText.trim();
    if (!title) {
      return { intent: "unclear", clarification: "מה כותרת המשימה?" };
    }
    return { intent: "task_create", title };
  }
  if (intent === "health_log") {
    const metric = raw.metric?.trim() ?? "";
    const value = typeof raw.value === "number" ? raw.value : Number(raw.value);
    if (!metric || !Number.isFinite(value)) {
      return {
        intent: "unclear",
        clarification: raw.clarification ?? "לא הצלחתי להבין מה למדוד. למשל: 'ישנתי 7 שעות'.",
      };
    }
    return {
      intent: "health_log",
      metric,
      value,
      unit: raw.unit?.trim() || null,
      occurred_at: raw.occurred_at ?? null,
      note: raw.note?.trim() || null,
    };
  }
  if (intent === "recall_question") {
    const question = raw.question?.trim() || originalText.trim();
    if (!question) {
      return { intent: "unclear", clarification: "מה לחפש בזיכרון?" };
    }
    return { intent: "recall_question", question };
  }
  if (intent === "conditional_reminder") {
    const title = raw.title?.trim();
    const eventKind = raw.event_kind?.trim();
    const condType = raw.condition_type;
    if (
      !title ||
      !eventKind ||
      !condType ||
      (condType !== "inactivity" && condType !== "streak_break" && condType !== "threshold")
    ) {
      return {
        intent: "unclear",
        clarification: raw.clarification ??
          "לא הצלחתי להבין את התנאי. נסחו למשל: 'אם לא רשמתי אימון 3 ימים — תזכיר'.",
      };
    }
    return {
      intent: "conditional_reminder",
      title,
      body: raw.body?.trim() || null,
      event_kind: eventKind,
      condition_type: condType,
      condition_params: raw.condition_params ?? {},
    };
  }
  return {
    intent: "unclear",
    clarification: raw.clarification ?? "לא הבנתי לגמרי — אפשר לנסח אחרת?",
  };
}

export async function routeMessage(
  text: string,
  nowIso: string,
  timezone: string,
): Promise<Routed[]> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");
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
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [{ ...TOOL, cache_control: { type: "ephemeral" } }],
      tool_choice: { type: "any" },
      messages: [{
        role: "user",
        content: `CURRENT_DATETIME: ${nowIso}\nTIMEZONE: ${timezone}\n\nUSER_MESSAGE:\n${text}`,
      }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as AnthropicResponse;
  const blocks = (data.content ?? []).filter(
    (b) => b.type === "tool_use" && b.name === "route_message",
  );
  if (blocks.length === 0) {
    return [{
      intent: "unclear",
      clarification: "לא הצלחתי להבין — אפשר לנסח אחרת?",
    }];
  }
  return blocks.map((b) => normalizeRouted((b.input ?? {}) as RouterInput, text));
}
