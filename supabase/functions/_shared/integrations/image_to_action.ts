// Extracts a structured list of action items from an image using Claude Vision
// + forced tool-use. Used when the caller wants to turn a screenshot of a
// whiteboard / todo list / printed agenda into tasks or list items.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

const SYSTEM =
  `אתה מקבל תמונה (למשל סקרינשוט, לוח, רשימה כתובה ביד). עליך לחלץ ממנה רשימה של פריטים שניתן לטפל בהם:
- פריטים שמהותם "לעשות משהו" (משימות / פעולות).
- פריטים שמהותם "לקנות / להביא" (פריטי רשימה).
- שמור את ניסוח הפריט קצר, בלשון פעולה ("לקנות חלב", "להתקשר ליואב").
- אל תחבר פריטים שונים. כל פריט בנפרד.
- אם אין שום פריט פעולה (זו רק תמונה אקראית) — החזר רשימה ריקה.
- קרא לכלי emit_actions פעם אחת בלבד.`;

const TOOL = {
  name: "emit_actions",
  description: "Return the action items extracted from the image.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Short imperative phrase, in Hebrew." },
            kind: {
              type: "string",
              enum: ["task", "list_item"],
              description: "task=goal/action; list_item=shopping/checklist row",
            },
          },
          required: ["text", "kind"],
        },
      },
      summary: { type: ["string", "null"], description: "One-sentence summary of the image." },
    },
    required: ["items"],
  },
} as const;

export interface ExtractedAction {
  text: string;
  kind: "task" | "list_item";
}

export interface ExtractionResult {
  items: ExtractedAction[];
  summary: string | null;
}

interface AnthropicContentBlock {
  type: string;
  name?: string;
  input?: unknown;
}

export async function extractActions(
  base64: string,
  mimeType: string,
  hint: string | null,
): Promise<ExtractionResult> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");
  const model = Deno.env.get("LLM_MODEL") ?? DEFAULT_MODEL;
  const userText = hint && hint.trim().length > 0
    ? `הקשר מהמשתמש: ${hint.trim()}`
    : "חלץ פריטי פעולה מהתמונה.";
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
      tool_choice: { type: "tool", name: "emit_actions" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
          { type: "text", text: userText },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: AnthropicContentBlock[] };
  const block = data.content?.find((b) => b.type === "tool_use" && b.name === "emit_actions");
  if (!block) throw new Error("no emit_actions tool_use in Anthropic response");
  const input = (block.input ?? {}) as { items?: ExtractedAction[]; summary?: string | null };
  const items = (input.items ?? []).filter((x) => x && typeof x.text === "string" && x.text.trim());
  return { items, summary: input.summary ?? null };
}
