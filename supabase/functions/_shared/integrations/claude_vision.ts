// Image / PDF understanding via Claude (Anthropic). For images we ask Claude
// to OCR + describe; for PDFs we ask for a structured summary. Both return
// plain Hebrew text suitable for a memory bubble. Falls back to a placeholder
// if the API call fails so the bubble still gets created.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

async function callClaude(content: unknown[], maxTokens: number): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");
  const model = Deno.env.get("LLM_MODEL") ?? DEFAULT_MODEL;
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: AnthropicContentBlock[] };
  const text = data.content?.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("no text block in Anthropic response");
  return text.trim();
}

const IMAGE_PROMPT = `קיבלת תמונה ששלח המשתמש לעוזר אישי. עליך:
1. אם יש טקסט בתמונה — לחלץ אותו מילה-במילה (OCR מדויק, שמור על שורות).
2. אחרי הטקסט (או אם אין טקסט) — לתאר בקצרה (משפט אחד) מה רואים בתמונה.
3. החזר טקסט פשוט בעברית, ללא Markdown. אם יש טקסט באנגלית בתמונה, השאר אותו באנגלית.
4. אל תוסיף הקדמות או הסברים מעבר.`;

const PDF_PROMPT = `קיבלת מסמך PDF ששלח המשתמש לעוזר אישי. עליך:
1. לסכם את עיקרי המסמך בעברית — מבנה, נושאים מרכזיים, נקודות פעולה אם יש.
2. הסיכום צריך להיות עד 10 שורות, ממוקד.
3. אם המסמך מכיל פרטים מבצעיים (תאריכים, סכומים, שמות, מספרי טלפון) — הזכר אותם במפורש.
4. החזר טקסט פשוט, ללא Markdown.`;

export async function ocrImage(base64: string, mimeType: string): Promise<string> {
  return await callClaude(
    [
      { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
      { type: "text", text: IMAGE_PROMPT },
    ],
    2048,
  );
}

export async function summarizePdf(base64: string): Promise<string> {
  return await callClaude(
    [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
      { type: "text", text: PDF_PROMPT },
    ],
    2048,
  );
}
