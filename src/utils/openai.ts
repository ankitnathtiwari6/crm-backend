import OpenAI from "openai";
import dotenv from "dotenv";
import { getToneInjection } from "./toneInjector";
import { buildSystemPrompt, buildReplyContext, buildFollowUpContext, loadKnowledgeBase } from "./prompts";

dotenv.config();

let client: OpenAI | null = null;

const getClient = (): OpenAI => {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeadContext {
  contactType?: string;
  name?: string;
  studentName?: string;
  city?: string;
  state?: string;
  preferredCountry?: string;
  preferredCollege?: string;
  neetScore?: number | null;
  neetYear?: number;
  qualification?: string;
  targetYear?: number;
  budget?: string;
  email?: string;
  // Engagement metadata for accurate scoring across all sessions
  totalMessages?: number;
  sessionCount?: number;
}

export interface AgentResult {
  agentMessage: string;
  extractedData: Partial<LeadContext>;
  conversationComplete?: boolean;
  leadQualityScore?: number;
  leadQualityScoreReason?: string;
}

export interface FollowUpContext {
  isFollowUp: boolean;
  followUpStep: number; // 1-5
}

// ─── Main agent function ──────────────────────────────────────────────────────

export const runCounselorAgent = async (
  chatHistory: Array<{ role: "lead" | "assistant"; content: string }>,
  leadData: LeadContext,
  followUp?: FollowUpContext,
  companyId?: string,
  ragEnabled: boolean = true
): Promise<AgentResult> => {
  try {
    const [knowledgeBase, toneSection] = await Promise.all([
      loadKnowledgeBase(companyId),
      companyId ? getToneInjection(chatHistory, companyId, ragEnabled) : Promise.resolve(""),
    ]);

    const systemPrompt = buildSystemPrompt(knowledgeBase, toneSection);

    const contextNote = followUp?.isFollowUp
      ? buildFollowUpContext(leadData, followUp.followUpStep)
      : buildReplyContext(leadData, chatHistory.length <= 1);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = chatHistory.map((msg) => ({
      role: msg.role === "lead" ? ("user" as const) : ("assistant" as const),
      content: msg.content,
    }));

    const response = await getClient().chat.completions.create({
      model: "gpt-5.4-mini-2026-03-17",
      messages: [
        { role: "system", content: systemPrompt + contextNote },
        ...messages,
      ],
      max_completion_tokens: 2000,
      temperature: followUp?.isFollowUp ? 0.9 : 0.7,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";

    const parseResult = (parsed: any): AgentResult => ({
      agentMessage: parsed.agentMessage ?? "I'm here to help! Could you share a bit more about yourself?",
      extractedData: sanitizeExtracted(parsed.extractedData ?? {}),
      conversationComplete: parsed.conversationComplete === true,
      leadQualityScore: typeof parsed.leadQualityScore === "number" ? Math.min(100, Math.max(0, parsed.leadQualityScore)) : undefined,
      leadQualityScoreReason: parsed.leadQualityScoreReason ?? undefined,
    });

    try {
      return parseResult(JSON.parse(raw));
    } catch {
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      try {
        return parseResult(JSON.parse(cleaned));
      } catch {
        console.error("Could not parse agent JSON:", raw);
        const match = raw.match(/"agentMessage"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        const fallbackMessage = match
          ? match[1].replace(/\\n/g, "\n")
          : "I'm here to help! Could you share a bit more about yourself?";
        return { agentMessage: fallbackMessage, extractedData: {}, conversationComplete: false };
      }
    }
  } catch (error) {
    console.error("Counselor agent error:", error);
    throw error;
  }
};

// Remove null values so we don't accidentally overwrite existing DB fields with null
const sanitizeExtracted = (data: any): Partial<LeadContext> => {
  const result: any = {};
  for (const key of Object.keys(data)) {
    if (data[key] !== null && data[key] !== undefined && data[key] !== "") {
      result[key] = data[key];
    }
  }
  return result;
};
