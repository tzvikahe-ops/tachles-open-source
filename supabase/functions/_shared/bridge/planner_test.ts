import { planTasks } from "./planner.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("planTasks prioritizes urgent work and skips busy windows", () => {
  const result = planTasks(
    [
      { id: "low", title: "רגיל", priority: 0, dueAt: null, estimatedMinutes: 30 },
      {
        id: "high",
        title: "חשוב",
        priority: 2,
        dueAt: "2026-06-14T12:00:00.000Z",
        estimatedMinutes: 60,
      },
    ],
    [{ start: "2026-06-14T09:00:00.000Z", end: "2026-06-14T10:00:00.000Z" }],
    { start: "2026-06-14T08:00:00.000Z", end: "2026-06-14T12:00:00.000Z" },
  );
  assertEquals(result.blocks.map((block) => [block.taskId, block.start]), [
    ["high", "2026-06-14T08:00:00.000Z"],
    ["low", "2026-06-14T10:00:00.000Z"],
  ]);
  assertEquals(result.unscheduled.length, 0);
});

Deno.test("planTasks reports work that does not fit", () => {
  const result = planTasks(
    [{ id: "large", title: "גדול", priority: 1, dueAt: null, estimatedMinutes: 90 }],
    [],
    { start: "2026-06-14T08:00:00.000Z", end: "2026-06-14T09:00:00.000Z" },
  );
  assertEquals(result.blocks.length, 0);
  assertEquals(result.unscheduled.map((task) => task.id), ["large"]);
});
