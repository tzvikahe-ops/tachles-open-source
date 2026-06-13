import { parseResearchResponse } from "./web_research.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("parseResearchResponse returns answer and unique clickable sources", () => {
  const result = parseResearchResponse({
    model: "test-model",
    output: [
      {
        type: "web_search_call",
        action: {
          sources: [{ url: "https://a.example", title: "A" }],
        },
      },
      {
        type: "message",
        content: [{
          type: "output_text",
          text: "תשובה",
          annotations: [
            { type: "url_citation", url: "https://a.example", title: "A duplicate" },
            { type: "url_citation", url: "https://b.example", title: "B" },
          ],
        }],
      },
    ],
  }, "fallback");
  assertEquals(result, {
    answer: "תשובה",
    sources: [
      { title: "A", url: "https://a.example" },
      { title: "B", url: "https://b.example" },
    ],
    model: "test-model",
  });
});
