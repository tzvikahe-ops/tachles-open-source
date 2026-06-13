import type { SupabaseClient } from "@supabase/supabase-js";

// Extracts structured user_facts from free-text messages with Claude tool-use.
// Runs async after a message is routed (fire-and-forget). Conservative:
// emits zero facts when nothing concrete is stated; SCD-closes any prior fact
// with the same (type, predicate) before inserting a new one.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MIN_CONFIDENCE_TO_SAVE = 0.5;

export type FactType =
  | "priority"
  | "goal"
  | "preference"
  | "relationship"
  | "routine"
  | "value"
  | "constraint"
  | "meta";

export interface ExtractedFact {
  fact_type: FactType;
  subject: string;
  predicate: string;
  object: unknown;
  confidence: number;
}

const SYSTEM = `אתה מחלץ עובדות מובנות על המשתמש מתוך הודעות בעברית/אנגלית. תפקידך:
- לזהות *הצהרות יציבות* על המשתמש: ערכים, מטרות, עדיפויות, הרגלים, יחסים, אילוצים.
- **לא** לחלץ פעילויות חולפות, רגשות רגעיים, או פרטים שאינם generalizable.

לכל הצהרה: בחר fact_type מהרשימה, צייני subject (כברירת מחדל "user"), predicate
תיאורי קצר (snake_case), ו-object כ-JSON שמייצג את התוכן.

דוגמאות:

"משפחה היא הדבר הכי חשוב לי"
→ {fact_type: "value", predicate: "top_value", object: "family", confidence: 0.85}

"אני רוצה לעשות 3 אימונים בשבוע"
→ {fact_type: "goal", predicate: "weekly_workout_target", object: {count: 3}, confidence: 0.9}

"דנה היא אשתי"
→ {fact_type: "relationship", subject: "user", predicate: "spouse", object: "דנה", confidence: 0.95}

"אני לא אוכל לאכול גלוטן"
→ {fact_type: "constraint", predicate: "dietary", object: {avoid: "gluten"}, confidence: 0.9}

"אני הכי פרודוקטיבי בבוקר"
→ {fact_type: "preference", predicate: "productive_time", object: "morning", confidence: 0.8}

"קניתי חלב היום" → לא חולצים — זה event, לא fact.
"כועס על הבוס" → לא חולצים — רגע, לא דפוס.

קרא לכלי emit_facts פעם אחת. אם אין מה לחלץ — facts: []`;

const TOOL = {
  name: "emit_facts",
  description: "Return the structured user facts extracted from the message, if any.",
  input_schema: {
    type: "object",
    properties: {
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fact_type: {
              type: "string",
              enum: [
                "priority",
                "goal",
                "preference",
                "relationship",
                "routine",
                "value",
                "constraint",
                "meta",
              ],
            },
            subject: { type: "string" },
            predicate: { type: "string" },
            object: {},
            confidence: { type: "number" },
          },
          required: ["fact_type", "predicate", "object", "confidence"],
        },
      },
    },
    required: ["facts"],
  },
} as const;

interface AnthropicBlock {
  type: string;
  name?: string;
  input?: unknown;
}

export async function callExtractor(text: string): Promise<ExtractedFact[]> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return [];
  const model = Deno.env.get("LLM_MODEL") ?? DEFAULT_MODEL;
  try {
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
        tool_choice: { type: "tool", name: "emit_facts" },
        messages: [{ role: "user", content: text }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { content?: AnthropicBlock[] };
    const block = data.content?.find((b) => b.type === "tool_use" && b.name === "emit_facts");
    if (!block) return [];
    const input = (block.input ?? {}) as { facts?: ExtractedFact[] };
    return (input.facts ?? []).filter((f) =>
      f &&
      typeof f.predicate === "string" &&
      f.predicate.trim().length > 0 &&
      typeof f.confidence === "number"
    );
  } catch (err) {
    console.error("fact extractor failed:", err);
    return [];
  }
}

// Closes any existing active row with the same identity and inserts the new
// one. Idempotent on identical replays (same value → still closes + reopens,
// which is wasteful but correct). Skips facts below the confidence floor.
export async function persistFact(
  supabase: SupabaseClient,
  ownerId: string,
  fact: ExtractedFact,
  sourceEventId?: string | null,
): Promise<void> {
  if (fact.confidence < MIN_CONFIDENCE_TO_SAVE) return;
  const subject = fact.subject || "user";
  const now = new Date().toISOString();

  const { data: prior } = await supabase
    .from("user_facts")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("fact_type", fact.fact_type)
    .eq("subject", subject)
    .eq("predicate", fact.predicate)
    .is("valid_to", null)
    .maybeSingle<{ id: string }>();

  if (prior) {
    await supabase
      .from("user_facts")
      .update({ valid_to: now })
      .eq("id", prior.id);
  }

  await supabase.from("user_facts").insert({
    owner_id: ownerId,
    fact_type: fact.fact_type,
    subject,
    predicate: fact.predicate,
    object: fact.object,
    confidence: fact.confidence,
    source_event_id: sourceEventId ?? null,
    supersedes_id: prior?.id ?? null,
  });
}

// Convenience: extract + persist + log. Best-effort; never throws.
export async function extractAndSave(
  supabase: SupabaseClient,
  ownerId: string,
  text: string,
  sourceEventId?: string | null,
): Promise<number> {
  if (!text || text.trim().length < 10) return 0;
  const facts = await callExtractor(text);
  if (facts.length === 0) return 0;
  for (const f of facts) {
    try {
      await persistFact(supabase, ownerId, f, sourceEventId);
    } catch (err) {
      console.error("persistFact failed:", err, f);
    }
  }
  return facts.length;
}

export interface ActiveFact {
  id: string;
  fact_type: FactType;
  subject: string;
  predicate: string;
  object: unknown;
  confidence: number;
  valid_from: string;
}

export async function listActiveFacts(
  supabase: SupabaseClient,
  ownerId: string,
  types?: FactType[],
): Promise<ActiveFact[]> {
  let q = supabase
    .from("user_facts")
    .select("id, fact_type, subject, predicate, object, confidence, valid_from")
    .eq("owner_id", ownerId)
    .is("valid_to", null)
    .order("valid_from", { ascending: false });
  if (types && types.length > 0) q = q.in("fact_type", types);
  const { data, error } = await q.returns<ActiveFact[]>();
  if (error) throw new Error(`listActiveFacts failed: ${error.message}`);
  return data ?? [];
}
