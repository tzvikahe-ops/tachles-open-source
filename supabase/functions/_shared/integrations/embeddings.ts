// Generates embeddings for memory bubble content. Uses OpenAI's
// text-embedding-3-small (1536 dims) which matches the existing
// memory_bubbles.embedding column. Returns null on missing key or failure so
// callers can keep working with trigram search only.

const ENDPOINT = "https://api.openai.com/v1/embeddings";
const DEFAULT_MODEL = "text-embedding-3-small";
const MAX_INPUT_CHARS = 8000;

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

export async function embed(text: string): Promise<number[] | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  const model = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? DEFAULT_MODEL;
  const input = text.slice(0, MAX_INPUT_CHARS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, input }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as EmbeddingResponse;
    return data.data?.[0]?.embedding ?? null;
  } catch (err) {
    console.error("embed failed:", err);
    return null;
  }
}
