import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../profiles.ts";
import { searchBubbles } from "../wellspring/memories.ts";
import { listActiveFacts } from "./fact_extractor.ts";
import { searchDrive } from "../integrations/google_drive.ts";

// Memory Agent: answers free-form "what did I say about X?" questions. Pulls
// from bubbles (semantic + trigram), facts, and recent events; lets Claude
// compose a Hebrew answer with brief references. Unlike the other agents
// this is triggered by the user (not scheduled), so it doesn't go through
// the runner / output_policy machinery.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

const SYSTEM = `אתה הזיכרון של המשתמש. הוא שואל שאלה. תפקידך לענות מתוך החומר שיוצג לך
(בועות זיכרון 💭, עובדות שאמר עליו עצמו, אירועים ⚡, וקבצי Drive 📄).

עקרונות:
- ענה ישירות בעברית. 2-6 שורות.
- ציין מתי הדבר נאמר/נצפה ("לפני שבוע", "ב-3 במאי") כשרלוונטי.
- אם אין תשובה בתוך החומר — אמור זאת בכנות ("אני לא רואה את זה בזיכרון שלי").
- אל תמציא. אל תפנה לאמירה כללית של "בדרך כלל...".
- אם יש כמה בועות רלוונטיות — סכם אותן (לא רשימה ארוכה).
- כשאתה מצטט קובץ Drive, ציין אותו עם 📄 והשם.`;

interface AnthropicBlock {
  type: string;
  text?: string;
}

interface QuestionContext {
  question: string;
  bubbles: Array<{ id: string; type: string; content: string; tags: string[] }>;
  facts: Array<{ type: string; predicate: string; object: unknown; since: string }>;
  recent_events_sample: Array<{ kind: string; payload: unknown; at: string }>;
  drive_files: Array<{ name: string; mime: string; link: string | null }>;
}

async function gatherContext(
  supabase: SupabaseClient,
  profile: Profile,
  question: string,
): Promise<QuestionContext> {
  const bubbles = await searchBubbles(supabase, profile.id, question, 8);
  const facts = await listActiveFacts(supabase, profile.id);
  // A sample of recent events that mention the question keywords. Cheap
  // substring match over payload preview — good enough for "what did I say".
  const { data: events } = await supabase
    .from("events")
    .select("kind, payload, occurred_at")
    .eq("owner_id", profile.id)
    .in("kind", ["message_in", "intent_routed", "bubble_created"])
    .order("occurred_at", { ascending: false })
    .limit(50);
  // Drive search is best-effort: silently skipped if not connected or on failure.
  let drive_files: Array<{ name: string; mime: string; link: string | null }> = [];
  try {
    const files = await searchDrive(supabase, profile.id, question, 5);
    drive_files = files.map((f) => ({
      name: f.name,
      mime: f.mimeType,
      link: f.webViewLink ?? null,
    }));
  } catch (_) { /* not connected / failed — drop silently */ }

  return {
    question,
    bubbles: bubbles.map((b) => ({
      id: b.id,
      type: b.type,
      content: b.content.slice(0, 500),
      tags: b.tags,
    })),
    facts: facts.map((f) => ({
      type: f.fact_type,
      predicate: f.predicate,
      object: f.object,
      since: f.valid_from,
    })),
    recent_events_sample: (events ?? []).slice(0, 20).map((e) => ({
      kind: e.kind as string,
      payload: e.payload,
      at: e.occurred_at as string,
    })),
    drive_files,
  };
}

export async function answerRecallQuestion(
  supabase: SupabaseClient,
  profile: Profile,
  question: string,
): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return "אין מפתח Anthropic מוגדר.";
  const model = Deno.env.get("LLM_MODEL") ?? DEFAULT_MODEL;
  const ctx = await gatherContext(supabase, profile, question);
  if (
    ctx.bubbles.length === 0 &&
    ctx.facts.length === 0 &&
    ctx.drive_files.length === 0
  ) {
    return "לא מצאתי בזיכרון שלי שום דבר שמתחבר לשאלה הזו.";
  }
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
      messages: [{ role: "user", content: JSON.stringify(ctx) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: AnthropicBlock[] };
  const text = data.content?.find((b) => b.type === "text")?.text;
  return text?.trim() ?? "לא הצלחתי לבנות תשובה.";
}

const RECALL_TRIGGERS = [
  /מה אמרתי/,
  /מה כתבתי/,
  /מה אמרנו/,
  /מתי אמרתי/,
  /איך קראו ל/,
  /מי זה היה/,
  /תזכיר לי מה אמרנו/,
  /איפה רשמתי/,
];

export function looksLikeRecallQuestion(text: string): boolean {
  return RECALL_TRIGGERS.some((re) => re.test(text));
}
