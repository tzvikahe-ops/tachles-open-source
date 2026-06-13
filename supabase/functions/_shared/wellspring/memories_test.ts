import { extractTags, extractUrl } from "./memories.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

Deno.test("extractUrl finds the first http(s) link", () => {
  assertEquals(
    extractUrl("מאמר מעולה: https://example.com/x?y=1 שווה לקרוא"),
    "https://example.com/x?y=1",
  );
  assertEquals(extractUrl("בלי קישור כאן"), null);
});

Deno.test("extractTags returns unique hashtags including Hebrew", () => {
  assertEquals(extractTags("רעיון על #פרודוקטיביות ו-#focus ושוב #פרודוקטיביות"), [
    "פרודוקטיביות",
    "focus",
  ]);
  assertEquals(extractTags("בלי תגיות"), []);
});
