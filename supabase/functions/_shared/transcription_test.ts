import { splitDictation } from "./transcription.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

Deno.test("splitDictation splits on newlines, commas and semicolons", () => {
  assertEquals(splitDictation("חלב, ביצים\nלחם; חמאה"), ["חלב", "ביצים", "לחם", "חמאה"]);
});

Deno.test("splitDictation keeps a single phrase intact", () => {
  assertEquals(splitDictation("לקנות מתנה ליום הולדת"), ["לקנות מתנה ליום הולדת"]);
});

Deno.test("splitDictation trims and drops empty fragments", () => {
  assertEquals(splitDictation("  פריט ראשון ,, , פריט שני  "), ["פריט ראשון", "פריט שני"]);
});
