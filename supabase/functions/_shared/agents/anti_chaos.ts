import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../profiles.ts";
import { registerAgent } from "./registry.ts";
import { loadLatestSnapshot } from "../snapshots.ts";

// Anti-Chaos: weekly check (Monday morning). When the open-tasks count is
// high or the doing-vs-done ratio is bad, suggest 1-3 concrete actions
// (cancel / split / postpone). Stays silent under threshold.

export const SYSTEM_PROMPT = `אתה סוכן "אנטי-כאוס". תפקידך לראות עומס יתר ולקרוא לפעולה ספציפית.

מתי לדבר:
- יותר מ-10 משימות פתוחות
- יותר מ-3 משימות שלא נגעת בהן מעל שבוע
- יחס done/open השבועי גרוע (פחות מ-30% השלמה)

מה לומר:
- ציין את העומס בקצרה.
- הצע 1-3 פעולות **שמות במפורש**: "תבטל X", "תחלק Y לתתי-משימות", "תדחה Z".
- אם לא ברור איזו פעולה — אל תמציא. שאל שאלה ממוקדת.
- 3-5 שורות מקסימום.

אל תדבר אם:
- פחות מ-7 משימות פתוחות.
- ה-completion השבועי מעל 40%.
- כבר דיברת על זה בשבוע הזה (בדוק agent_state).

confidence>=0.7 לשליחה.`;

async function loadContext(
  supabase: SupabaseClient,
  profile: Profile,
  state: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const snapshot = await loadLatestSnapshot(supabase, profile.id);

  const { data: stale } = await supabase
    .from("tasks")
    .select("id, title, status, priority, updated_at")
    .eq("owner_id", profile.id)
    .neq("status", "done")
    .is("parent_task_id", null)
    .lt("updated_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order("updated_at", { ascending: true })
    .limit(8);

  const { data: openTop } = await supabase
    .from("tasks")
    .select("id, title, status, priority")
    .eq("owner_id", profile.id)
    .neq("status", "done")
    .is("parent_task_id", null)
    .order("priority", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(10);

  return {
    snapshot: snapshot ?? null,
    stale_tasks: stale ?? [],
    top_open_tasks: openTop ?? [],
    state_memory: state,
  };
}

registerAgent("anti_chaos", { systemPrompt: SYSTEM_PROMPT, loadContext });
