import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

const PINECONE_INDEX = "chat-history";
const SIMILARITY_THRESHOLD = 0.8;
const TOP_K = 3;

let _openai: OpenAI | null = null;
let _pinecone: Pinecone | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return _openai;
}

function getPinecone(): Pinecone {
  if (!_pinecone)
    _pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  return _pinecone;
}

// Step 1 — HyDE: convert recent messages into a document that matches
// the exact format of stored embeddings (buildEmbedText output).
async function generateSituationQuery(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const formatted = messages
    .map(
      (m) =>
        `${m.role === "lead" || m.role === "user" ? "Customer" : "Agent"}: ${m.content}`,
    )
    .join("\n");

  const lastMsg = messages[messages.length - 1];
  const isFollowUp = lastMsg?.role === "assistant";
  const followUpNote = isFollowUp
    ? `\nIMPORTANT: The last message is from the Agent with no Customer reply — this is a FOLLOW-UP. Prefix Situation with "Follow-up: " and prefix the Stage line with "Follow-up / ".`
    : "";

  const prompt = `You are preparing a retrieval query for a RAG system that stores MBBS abroad admissions conversation patterns.

The stored documents follow EXACTLY this format — your output must match it:

MBBS abroad consultancy.

Situation: [one sentence — what is happening. If agent is following up with no reply, start with "Follow-up: "]
[Stage label: Early/Mid/Late-stage — what lead info has been collected so far. If follow-up, prefix with "Follow-up / "]

User intent: [short phrase — what the user is trying to achieve]
Constraints: [any limits the user expressed or implied — budget, score, timeline]

Signals: [user's emotional state, comma-separated — e.g. price-sensitive, hesitant]

Countries of interest: [countries explicitly mentioned or clearly implied — e.g. Kyrgyzstan, Kazakhstan. Omit line if none]

Recent conversation:
${formatted}
${followUpNote}
Generate the retrieval document in EXACTLY the format above. Every section is required.
Output only the formatted text — no explanation, no extra lines.`;

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-5.4-mini-2026-03-17",
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 300,
    temperature: 0.2,
  });

  return response.choices[0]?.message?.content?.trim() ?? formatted;
}

// Step 2 — embed the situation query
async function createEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: "text-embedding-3-large",
    input: text.slice(0, 8000),
  });
  return response.data[0].embedding;
}

// Step 3 — query Pinecone and format matched examples
async function queryPinecone(
  embedding: number[],
  companyId: string,
): Promise<Array<{ score: number; metadata: Record<string, any> }>> {
  const index = getPinecone().index(PINECONE_INDEX).namespace(companyId);
  const result = await index.query({
    vector: embedding,
    topK: TOP_K,
    includeMetadata: true,
  });

  return (result.matches ?? [])
    .filter((m) => (m.score ?? 0) >= SIMILARITY_THRESHOLD)
    .map((m) => ({
      score: m.score ?? 0,
      metadata: (m.metadata ?? {}) as Record<string, any>,
    }));
}

// Step 4 — format matched examples into the injection string
function formatMatches(
  matches: Array<{ score: number; metadata: Record<string, any> }>,
): string {
  const examples = matches.map((match, i) => {
    const m = match.metadata;
    const strategy = m.strategy
      ? String(m.strategy)
          .split(" | ")
          .map((s: string) => `  - ${s.trim()}`)
          .join("\n")
      : "";
    const antiPatterns = m.antiPatterns
      ? String(m.antiPatterns)
          .split(" | ")
          .map((s: string) => `  - ${s.trim()}`)
          .join("\n")
      : "";

    return [
      `[Example ${i + 1}]`,
      `How we replied:`,
      `"${m.suggestedReply ?? ""}"`,
      strategy ? `\nApproach:\n${strategy}` : "",
      antiPatterns ? `\nAvoid:\n${antiPatterns}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `

## Tone & Style Reference (matched from your training examples)

Use these as tone and approach reference only — adapt to this specific conversation, do not copy verbatim.

---
${examples.join("\n\n---\n")}`;
}

// Main export — returns injection string or null if no match above threshold
export async function getRagInjection(
  messages: Array<{ role: string; content: string }>,
  companyId: string,
): Promise<string | null> {
  try {
    const situationQuery = await generateSituationQuery(messages);
    console.log(`[RAG] HyDE query generated (${situationQuery.length} chars)`);

    const embedding = await createEmbedding(situationQuery);
    const matches = await queryPinecone(embedding, companyId);

    if (matches.length === 0) {
      console.log(
        `[RAG] No matches above threshold ${SIMILARITY_THRESHOLD} — using generic fallback`,
      );
      return null;
    }

    console.log(
      `[RAG] ${matches.length} match(es) found, top score: ${matches[0].score.toFixed(3)}`,
    );
    return formatMatches(matches);
  } catch (err: any) {
    console.error("[RAG] ragInjector error:", err?.message ?? err);
    return null;
  }
}
