import OpenAI from "openai";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return _openai;
}

export function formatConversationForReply(
  messages: Array<{ role: string; content: string }>,
): string {
  return messages
    .map(
      (m) =>
        `${m.role === "lead" || m.role === "user" ? "Customer" : "Agent"}: ${m.content}`,
    )
    .join("\n");
}

function buildLanguageRule(
  conversationContext: Array<{ role: string; content: string }>,
): string {
  const userMessages = conversationContext
    .filter((m) => m.role === "lead" || m.role === "user")
    .slice(-4);

  if (!userMessages.length) return "";

  return [
    "FINAL LANGUAGE INSTRUCTION — override everything else:",
    "Determine the reply language from the customer's messages ONLY. Ignore the agent's language entirely.",
    `Customer messages:\n${userMessages.map((m) => `"${m.content}"`).join("\n")}`,
    "Rules:",
    "- If the customer uses Hindi words (kitna, lagega, sir, kya, hai, bhai, etc.) in Roman script → reply in Hinglish (Roman-script Hindi, same as the customer)",
    "- If the customer writes in Devanagari script → reply in Hindi (Devanagari)",
    "- If the customer writes in clear English sentences → reply in English",
    '- Short neutral words ("Hi", "ok", place names, "12th pass") are not enough to determine — look at the dominant pattern across all messages above',
    "The agent's past language does NOT matter.",
  ].join("\n");
}

/**
 * Generates a WhatsApp reply for the MBBS admissions context.
 *
 * @param conversationContext - Full conversation up to and including the message being replied to.
 * @param instruction         - What the reply should achieve (trainer-supplied or auto-derived).
 * @param styleExamples       - Optional: formatted embedded training examples for tone reference.
 * @param previousSuggestions - Optional: replies already shown to the trainer to avoid repetition.
 */
export async function generateReply(params: {
  conversationContext: Array<{ role: string; content: string }>;
  instruction: string;
  styleExamples?: string;
  previousSuggestions?: string[];
}): Promise<string> {
  const {
    conversationContext,
    instruction,
    styleExamples,
    previousSuggestions,
  } = params;

  const conversationText = formatConversationForReply(conversationContext);
  const languageRule = buildLanguageRule(conversationContext);

  const prevBlock = previousSuggestions?.length
    ? `\nPrevious suggestions already tried (do NOT produce something similar to these):\n${previousSuggestions.map((s, i) => `${i + 1}. "${s}"`).join("\n")}\n`
    : "";

  const prompt = [
    "You are an expert WhatsApp sales consultant for MBBS abroad admissions at Global Grads.",
    "",
    styleExamples ?? "",
    "",
    conversationText ? `Conversation so far:\n${conversationText}` : "",
    "",
    prevBlock,
    styleExamples
      ? `Fallback instruction (use only if none of the examples above are a good fit):\n"${instruction}"`
      : `Instruction:\n"${instruction}"`,
    "",
    "Generate a reply that:",
    styleExamples
      ? "1. Adapts the most relevant example above — same structure, tone, and approach, tailored to this specific conversation"
      : "1. Follows the instruction exactly (tone, style, length)",
    "2. Fits naturally into the conversation flow",
    "3. Is short and WhatsApp-appropriate (2–4 lines max)",
    "4. Stays focused on MBBS abroad admissions",
    "5. Sounds like a real person texting, not a bot",
    "",
    languageRule,
    "",
    "Output ONLY the reply text — no explanations, no quotes, no prefix.",
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-5.4-mini-2026-03-17",
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 500,
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}
