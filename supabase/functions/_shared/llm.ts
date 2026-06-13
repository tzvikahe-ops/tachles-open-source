// Parses a free-text (usually Hebrew) message into a structured reminder using
// Claude with forced tool-use. The static system prompt and tool schema are
// cached (prompt caching) so repeated calls only pay for the short user turn.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface ParsedReminder {
  understood: boolean;
  title: string | null;
  body: string | null;
  schedule_type: "once" | "recurring";
  run_at: string | null; // ISO 8601 with timezone offset — first/only fire time
  recurrence: string | null; // iCal RRULE body without DTSTART (recurring only)
  clarification: string | null; // short Hebrew question when understood = false
}

const SYSTEM =
  `You turn a user's natural-language message (usually Hebrew) into exactly one reminder.

The user turn provides CURRENT_DATETIME (ISO 8601 with offset) and TIMEZONE (IANA name).
Resolve relative expressions ("מחר", "עוד שעה", "כל יום ראשון") against CURRENT_DATETIME.

Rules:
- Always emit run_at as ISO 8601 WITH the UTC offset that TIMEZONE has at that moment.
- One-time: schedule_type="once", recurrence=null.
- Recurring: schedule_type="recurring", recurrence=an iCal RRULE body WITHOUT DTSTART
  (e.g. "FREQ=WEEKLY;BYDAY=SU;BYHOUR=8;BYMINUTE=0;BYSECOND=0"), and run_at MUST equal the
  first occurrence of that rule at or after CURRENT_DATETIME.
- title: concise, in the user's own language (Hebrew if they wrote Hebrew).
- body: optional extra detail, else null.
- If the message is not a reminder request, or no time can be determined, set
  understood=false and put a short Hebrew question in clarification (everything else null).
- Never invent a time. Always call the save_reminder tool exactly once.`;

const TOOL = {
  name: "save_reminder",
  description: "Record the structured reminder parsed from the user's message.",
  input_schema: {
    type: "object",
    properties: {
      understood: {
        type: "boolean",
        description: "true only if this is a clear reminder request with a determinable time",
      },
      title: { type: ["string", "null"] },
      body: { type: ["string", "null"] },
      schedule_type: { type: "string", enum: ["once", "recurring"] },
      run_at: {
        type: ["string", "null"],
        description: "ISO 8601 with offset; first/only fire time",
      },
      recurrence: {
        type: ["string", "null"],
        description: "iCal RRULE body without DTSTART; null for one-time",
      },
      clarification: { type: ["string", "null"] },
    },
    required: ["understood", "schedule_type"],
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

export async function parseReminder(
  text: string,
  nowIso: string,
  timezone: string,
): Promise<ParsedReminder> {
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
      tool_choice: { type: "tool", name: "save_reminder" },
      messages: [{
        role: "user",
        content: `CURRENT_DATETIME: ${nowIso}\nTIMEZONE: ${timezone}\n\nUSER_MESSAGE:\n${text}`,
      }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as AnthropicResponse;
  const block = data.content?.find((b) => b.type === "tool_use" && b.name === "save_reminder");
  if (!block) throw new Error("No save_reminder tool_use in Anthropic response");

  const input = (block.input ?? {}) as Partial<ParsedReminder>;
  return {
    understood: input.understood === true,
    title: input.title ?? null,
    body: input.body ?? null,
    schedule_type: input.schedule_type === "recurring" ? "recurring" : "once",
    run_at: input.run_at ?? null,
    recurrence: input.recurrence ?? null,
    clarification: input.clarification ?? null,
  };
}
