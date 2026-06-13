import { nextPriority, nextStatus } from "./tasks.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("nextStatus cycles todo -> doing -> done -> todo", () => {
  assertEquals(nextStatus("todo"), "doing");
  assertEquals(nextStatus("doing"), "done");
  assertEquals(nextStatus("waiting"), "done");
  assertEquals(nextStatus("done"), "todo");
});

Deno.test("nextPriority cycles 0 -> 1 -> 2 -> 0", () => {
  assertEquals(nextPriority(0), 1);
  assertEquals(nextPriority(1), 2);
  assertEquals(nextPriority(2), 0);
});
