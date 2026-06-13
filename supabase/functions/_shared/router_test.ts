import { normalizeRouted } from "./router.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

Deno.test("normalizeRouted: reminder requires run_at + schedule_type, else unclear", () => {
  const ok = normalizeRouted(
    {
      intent: "reminder",
      title: "לקחת תרופה",
      body: null,
      schedule_type: "once",
      run_at: "2026-05-27T09:00:00+03:00",
      recurrence: null,
    },
    "תזכיר לי מחר ב-9 לקחת תרופה",
  );
  assertEquals(ok.intent, "reminder");

  const missing = normalizeRouted(
    { intent: "reminder", title: "x", schedule_type: "once", run_at: null },
    "תזכיר לי משהו",
  );
  assertEquals(missing.intent, "unclear");
});

Deno.test("normalizeRouted: recurring strips recurrence when schedule_type=once", () => {
  const out = normalizeRouted(
    {
      intent: "reminder",
      title: "ויטמין",
      schedule_type: "once",
      run_at: "2026-05-27T07:00:00+03:00",
      recurrence: "FREQ=DAILY;BYHOUR=7",
    },
    "ב-7 בבוקר ויטמין",
  );
  if (out.intent !== "reminder") throw new Error("expected reminder");
  assertEquals(out.recurrence, null);
});

Deno.test("normalizeRouted: list_add trims + drops empty items, falls back to unclear", () => {
  const out = normalizeRouted(
    { intent: "list_add", items: ["לחם", "  ", "חלב "], list_name: " קניות " },
    "תוסיף לקניות: לחם, חלב",
  );
  if (out.intent !== "list_add") throw new Error("expected list_add");
  assertEquals(out.items, ["לחם", "חלב"]);
  assertEquals(out.list_name, "קניות");

  const empty = normalizeRouted({ intent: "list_add", items: ["", " "] }, "תוסיף");
  assertEquals(empty.intent, "unclear");
});

Deno.test("normalizeRouted: memory_save strips # from tags, uses original text when content missing", () => {
  const out = normalizeRouted(
    { intent: "memory_save", content: null, tags: ["#רעיון", "פרודוקטיביות"] },
    "ריבית דריבית היא הכוח השמיני",
  );
  if (out.intent !== "memory_save") throw new Error("expected memory_save");
  assertEquals(out.content, "ריבית דריבית היא הכוח השמיני");
  assertEquals(out.tags, ["רעיון", "פרודוקטיביות"]);
});

Deno.test("normalizeRouted: task_create requires a title", () => {
  const ok = normalizeRouted({ intent: "task_create", title: "להכין מצגת" }, "להכין מצגת");
  assertEquals(ok.intent, "task_create");

  const empty = normalizeRouted({ intent: "task_create", title: "   " }, "   ");
  assertEquals(empty.intent, "unclear");
});

Deno.test("normalizeRouted: unclear passes through clarification, else default", () => {
  const withMsg = normalizeRouted(
    { intent: "unclear", clarification: "מתי?" },
    "תזכיר",
  );
  if (withMsg.intent !== "unclear") throw new Error("expected unclear");
  assertEquals(withMsg.clarification, "מתי?");

  const fallback = normalizeRouted({ intent: "unclear" }, "...");
  if (fallback.intent !== "unclear") throw new Error("expected unclear");
  if (!fallback.clarification) throw new Error("expected default clarification");
});
