import { normalizeProjectPlan } from "./project_plans.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("normalizeProjectPlan keeps actionable Hebrew tasks and clamps fields", () => {
  const plan = normalizeProjectPlan({
    summary: "תוכנית",
    milestones: [{
      title: "הכנה",
      outcome: "מוכנים",
      tasks: [
        { title: "  לבנות תקציב ", estimated_minutes: 2, priority: 9, due_at: "" },
        { title: " ", estimated_minutes: 20, priority: 1, due_at: null },
      ],
    }],
    risks: ["עיכוב"],
  });
  assertEquals(plan.milestones[0].tasks, [{
    title: "לבנות תקציב",
    estimated_minutes: 5,
    priority: 0,
    due_at: null,
  }]);
});
