import { assertEquals } from "jsr:@std/assert@1";
import { escapeHtml } from "./html.ts";

Deno.test("escapeHtml escapes text-significant HTML characters", () => {
  assertEquals(
    escapeHtml(`<script data-x="1">alert('x') & more</script>`),
    "&lt;script data-x=&quot;1&quot;&gt;alert(&#39;x&#39;) &amp; more&lt;/script&gt;",
  );
});
