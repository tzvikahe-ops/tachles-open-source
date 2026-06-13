const RESPONSES_URL = "https://api.openai.com/v1/responses";

export interface ResearchSource {
  title: string | null;
  url: string;
}

export interface ResearchResult {
  answer: string;
  sources: ResearchSource[];
  model: string;
}

interface OutputAnnotation {
  type: string;
  url?: string;
  title?: string;
}

interface OutputContent {
  type: string;
  text?: string;
  annotations?: OutputAnnotation[];
}

interface ResponsesPayload {
  model?: string;
  output?: Array<{
    type: string;
    content?: OutputContent[];
    action?: {
      sources?: Array<{ url?: string; title?: string }>;
    };
  }>;
}

export function parseResearchResponse(
  data: ResponsesPayload,
  fallbackModel: string,
): ResearchResult {
  const texts = (data.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text");
  const answer = texts.map((content) => content.text ?? "").join("\n").trim();
  if (!answer) throw new Error("OpenAI research returned no answer");
  const seen = new Set<string>();
  const sources: ResearchSource[] = [];
  for (const item of data.output ?? []) {
    for (const source of item.action?.sources ?? []) {
      if (!source.url || seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push({ title: source.title ?? null, url: source.url });
    }
  }
  for (const content of texts) {
    for (const annotation of content.annotations ?? []) {
      if (annotation.type !== "url_citation" || !annotation.url || seen.has(annotation.url)) {
        continue;
      }
      seen.add(annotation.url);
      sources.push({ title: annotation.title ?? null, url: annotation.url });
    }
  }
  return { answer, sources, model: data.model ?? fallbackModel };
}

export async function researchWeb(
  query: string,
  allowedDomains: string[] = [],
): Promise<ResearchResult> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_RESEARCH_MODEL") ?? "gpt-5.5";
  const webSearch: Record<string, unknown> = {
    type: "web_search",
    search_context_size: "medium",
  };
  if (allowedDomains.length > 0) {
    webSearch.filters = { allowed_domains: allowedDomains.slice(0, 20) };
  }
  const response = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      tools: [webSearch],
      include: ["web_search_call.action.sources"],
      input:
        `חקור את השאלה הבאה והשב בעברית. הפרד בין עובדות למסקנות, אל תמציא מידע, והסתמך על מקורות שניתן לפתוח:\n\n${query}`,
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI research ${response.status}: ${await response.text()}`);
  }
  return parseResearchResponse(await response.json() as ResponsesPayload, model);
}
