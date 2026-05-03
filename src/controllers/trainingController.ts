import { Request, Response } from "express";
import mongoose from "mongoose";
import asyncHandler from "../utils/asyncHandler";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import TrainingSuggestion from "../models/TrainingSuggestion";
import ChatHistory from "../models/ChatHistory";
import Lead from "../models/Lead";
import Company from "../models/Company";
import { generateReply } from "../utils/replyGenerator";

const PINECONE_INDEX = "chat-history";

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

async function createEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: "text-embedding-3-large",
    input: text.slice(0, 8000),
  });
  return response.data[0].embedding;
}

async function analyzeForTraining(params: {
  conversationContext: Array<{ role: string; content: string }>;
  suggestedReply: string;
  originalAiReply: string;
}): Promise<{
  situation: string;
  stage: string;
  userIntent: string;
  constraints: string;
  signals: string;
  preferredCountries: string[];
  strategy: string[];
  antiPatterns: string[];
}> {
  const conversationText = formatConversation(params.conversationContext);

  const ctx = params.conversationContext;
  const secondLastMsg = ctx.length >= 2 ? ctx[ctx.length - 2] : null;
  const isFollowUp = secondLastMsg?.role === "assistant";
  const followUpNote = isFollowUp
    ? `NOTE: The last message in the conversation is from the AGENT with no lead reply after it — this is a FOLLOW-UP scenario. You MUST prefix the situation with "Follow-up: " and prefix the stage with "Follow-up / ".`
    : "";

  const prompt = `You are building a RAG training dataset for a WhatsApp MBBS abroad admissions AI agent.

Analyze the conversation and the trainer's correction. Output a JSON object with exactly these fields.

Conversation:
${conversationText}

Original AI reply (may be wrong or off-tone):
"${params.originalAiReply}"

Trainer's better reply:
"${params.suggestedReply}"
${followUpNote ? `\n${followUpNote}\n` : ""}
Output this JSON — each field is a separate string, not nested:

{
  "situation": "One short sentence (max 20 words). Describe what the user just said or did and what triggered this agent reply. No generic wording. No 'Follow-up' prefix unless the NOTE below explicitly instructs it.",
  "stage": "Stage label + what info is known so far. E.g. 'Mid-stage: NEET score and city known, no country selected.' Use Early/Mid/Late. No prefix unless the NOTE below explicitly instructs it.",
  "userIntent": "Short phrase — what the user is trying to achieve. E.g. 'reduce cost, explore low-budget MBBS options.'",
  "constraints": "Short phrase (max 12 words). Only key limits like budget, NEET score. No explanations.",
  "signals": "Emotional state, comma-separated. E.g. 'price-sensitive, hesitant.'",
  "preferredCountries": ["List only countries explicitly mentioned or clearly implied in the conversation. E.g. ['Kyrgyzstan', 'Kazakhstan']. Empty array if none mentioned."],
  "strategy": ["2-3 short actionable steps (max 8 words each), derived from trainer reply. No explanation."],
  "antiPatterns": ["2-3 short mistakes to avoid (max 8 words each), based on original reply issues."]
}

IMPORTANT RULES:
- Keep all fields concise and reusable.
- Do not include names or one-off details.
- Do not mix multiple situations — pick the dominant one.
- Prefer short phrases over sentences.
- Optimize for similarity search, not readability.

Output raw JSON only. No markdown, no explanation.`;

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-5.4-mini-2026-03-17",
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 800,
    temperature: 0.3,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? "{}";
  const parsed = JSON.parse(raw);

  return {
    situation: parsed.situation ?? "",
    stage: parsed.stage ?? "",
    userIntent: parsed.userIntent ?? "",
    constraints: parsed.constraints ?? "",
    signals: parsed.signals ?? "",
    preferredCountries: Array.isArray(parsed.preferredCountries)
      ? parsed.preferredCountries
      : [],
    strategy: Array.isArray(parsed.strategy) ? parsed.strategy : [],
    antiPatterns: Array.isArray(parsed.antiPatterns) ? parsed.antiPatterns : [],
  };
}

async function embedSingleSuggestion(
  suggestion: any,
  chatHistoryId?: string,
): Promise<void> {
  // Use rich structured embed text if available, fall back to raw conversation
  const embedText = suggestion.situation
    ? buildEmbedText(suggestion)
    : formatConversation(suggestion.conversationContext);

  console.log(
    `[Pinecone] Creating OpenAI embedding, text length: ${embedText.length}`,
  );
  const embedding = await createEmbedding(embedText);
  console.log(`[Pinecone] Embedding created, dimensions: ${embedding.length}`);

  const id = (suggestion._id as mongoose.Types.ObjectId).toString();
  const ns = suggestion.companyId.toString();
  console.log(
    `[Pinecone] Upserting to index "${PINECONE_INDEX}", namespace "${ns}", id "${id}"`,
  );

  await getPinecone()
    .index(PINECONE_INDEX)
    .namespace(ns)
    .upsert({
      records: [
        {
          id,
          values: embedding,
          metadata: {
            trainingSuggestionId: id,
            chatHistoryIds: chatHistoryId ? [chatHistoryId] : [],
            leadId: suggestion.leadId.toString(),
            companyId: ns,
            suggestedReply: suggestion.suggestedReply.slice(0, 500),
            strategy: (suggestion.strategy ?? []).join(" | ").slice(0, 500),
            antiPatterns: (suggestion.antiPatterns ?? [])
              .join(" | ")
              .slice(0, 500),
            preferredCountries: (suggestion.preferredCountries ?? [])
              .join(", ")
              .slice(0, 200),
            confirmedBy: suggestion.confirmedBy ?? "",
            confirmedAt: suggestion.confirmedAt?.toISOString() ?? "",
            embedText: embedText.slice(0, 2000),
          },
        },
      ],
    });

  console.log(`[Pinecone] Upsert done, marking isEmbedded in DB`);
  await TrainingSuggestion.findByIdAndUpdate(suggestion._id, {
    isEmbedded: true,
    pineconeId: id,
  });
}

function formatConversation(
  messages: Array<{ role: string; content: string }>,
): string {
  return messages
    .map((m) => `${m.role === "lead" ? "Customer" : "Agent"}: ${m.content}`)
    .join("\n");
}

function buildEmbedText(suggestion: any): string {
  const lines: string[] = [];

  lines.push("MBBS abroad consultancy.");
  lines.push("");

  if (suggestion.situation) lines.push(`Situation: ${suggestion.situation}`);
  if (suggestion.stage) lines.push(suggestion.stage);

  if (suggestion.userIntent || suggestion.constraints) {
    lines.push("");
    if (suggestion.userIntent)
      lines.push(`User intent: ${suggestion.userIntent}`);
    if (suggestion.constraints)
      lines.push(`Constraints: ${suggestion.constraints}`);
  }

  if (suggestion.signals) {
    lines.push("");
    lines.push(`Signals: ${suggestion.signals}`);
  }

  if (suggestion.preferredCountries?.length) {
    lines.push("");
    lines.push(
      `Countries of interest: ${suggestion.preferredCountries.join(", ")}`,
    );
  }

  return lines.join("\n");
}

// GET /api/training/companies
export const getCompanies = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const companies = await Company.find({ "users.userId": userId });
    res.json(companies);
  },
);

// GET /api/training/companies/:companyId/leads
export const getLeadsForCompany = asyncHandler(
  async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;

    const query: any = { companyId, status: { $ne: "archived" } };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { leadPhoneNumber: { $regex: search, $options: "i" } },
      ];
    }

    const total = await Lead.countDocuments(query);
    const leads = await Lead.find(query)
      .select(
        "name leadPhoneNumber stage lastInteraction numberOfChatsMessages messageCount",
      )
      .sort({ lastInteraction: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({ leads, total, pages: Math.ceil(total / limit), page });
  },
);

// GET /api/training/leads/:leadId/chat
export const getChatWithSuggestions = asyncHandler(
  async (req: Request, res: Response) => {
    const { leadId } = req.params;

    const lead = await Lead.findById(leadId).select(
      "name leadPhoneNumber stage lastInteraction companyId",
    );
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    const chatHistory = await ChatHistory.findOne({ leadId });
    const suggestions = await TrainingSuggestion.find({ leadId });

    const suggestionMap = suggestions.reduce(
      (acc, s) => {
        acc[s.messageId] = s;
        return acc;
      },
      {} as Record<string, any>,
    );

    const messages = chatHistory?.messages || [];

    res.json({
      lead,
      messages,
      suggestions: suggestionMap,
      stats: {
        totalMessages: messages.length,
        aiMessages: messages.filter((m: any) => m.role === "assistant").length,
        suggestions: suggestions.length,
        embedded: suggestions.filter((s) => s.isEmbedded).length,
      },
    });
  },
);

// POST /api/training/leads/:leadId/suggestions
// Saves the suggestion + runs GPT analysis. Does NOT embed — trainer must confirm first.
export const saveSuggestion = asyncHandler(
  async (req: Request, res: Response) => {
    const { leadId } = req.params;
    const { messageId, suggestedReply, conversationContext, originalAiReply } =
      req.body;

    const lead = await Lead.findById(leadId);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    const suggestion = await TrainingSuggestion.findOneAndUpdate(
      { leadId, messageId },
      {
        leadId,
        companyId: lead.companyId,
        leadPhoneNumber: lead.leadPhoneNumber,
        messageId,
        conversationContext,
        originalAiReply,
        suggestedReply,
        isEmbedded: false,
        embeddingStatus: "pending_review",
      },
      { upsert: true, new: true },
    );

    // GPT analysis — generate all structured fields for the trainer to review
    let generated = {
      situation: "",
      stage: "",
      userIntent: "",
      constraints: "",
      signals: "",
      preferredCountries: [] as string[],
      strategy: [] as string[],
      antiPatterns: [] as string[],
    };

    try {
      generated = await analyzeForTraining({
        conversationContext,
        suggestedReply,
        originalAiReply,
      });
    } catch (err: any) {
      console.error(
        `[Training] GPT analysis failed for suggestion ${suggestion._id}:`,
        err,
      );
    }

    res.json({ suggestion, generated });
  },
);

// POST /api/training/suggestions/:suggestionId/embed
// Trainer has reviewed and confirmed — save final fields and embed to Pinecone.
export const embedConfirmed = asyncHandler(
  async (req: Request, res: Response) => {
    const { suggestionId } = req.params;
    const userId = (req as any).user?.id ?? "unknown";
    const {
      situation,
      stage,
      userIntent,
      constraints,
      signals,
      preferredCountries,
      strategy,
      antiPatterns,
    } = req.body;

    const suggestion = await TrainingSuggestion.findById(suggestionId);
    if (!suggestion)
      return res.status(404).json({ message: "Suggestion not found" });

    // Save trainer's confirmed edits
    if (situation !== undefined) suggestion.situation = situation;
    if (stage !== undefined) suggestion.stage = stage;
    if (userIntent !== undefined) suggestion.userIntent = userIntent;
    if (constraints !== undefined) suggestion.constraints = constraints;
    if (signals !== undefined) suggestion.signals = signals;
    if (preferredCountries !== undefined)
      suggestion.preferredCountries = preferredCountries;
    if (strategy !== undefined) suggestion.strategy = strategy;
    if (antiPatterns !== undefined) suggestion.antiPatterns = antiPatterns;
    suggestion.confirmedBy = userId;
    suggestion.confirmedAt = new Date();
    await suggestion.save();

    // Embed to Pinecone
    try {
      const chatHistory = await ChatHistory.findOne({
        leadId: suggestion.leadId,
      });
      const chatHistoryId = chatHistory?._id?.toString() ?? "";
      await embedSingleSuggestion(suggestion, chatHistoryId);
      suggestion.embeddingStatus = "embedded";
      suggestion.isEmbedded = true;
      await suggestion.save();
      console.log(
        `[Pinecone] Embed confirmed for suggestion ${suggestion._id}`,
      );
    } catch (err: any) {
      console.error(
        `[Pinecone] Embed failed for suggestion ${suggestion._id}:`,
        err,
      );
      return res
        .status(500)
        .json({ message: "Embed failed", error: err?.message });
    }

    res.json({ suggestion });
  },
);

// PUT /api/training/suggestions/:suggestionId
// Update any field before trainer confirms embedding (auto-save during editing).
export const updateSuggestion = asyncHandler(
  async (req: Request, res: Response) => {
    const { suggestionId } = req.params;
    const {
      situation,
      stage,
      userIntent,
      constraints,
      signals,
      preferredCountries,
      strategy,
      antiPatterns,
      suggestedReply,
    } = req.body;

    const suggestion = await TrainingSuggestion.findById(suggestionId);
    if (!suggestion)
      return res.status(404).json({ message: "Suggestion not found" });

    if (situation !== undefined) suggestion.situation = situation;
    if (stage !== undefined) suggestion.stage = stage;
    if (userIntent !== undefined) suggestion.userIntent = userIntent;
    if (constraints !== undefined) suggestion.constraints = constraints;
    if (signals !== undefined) suggestion.signals = signals;
    if (preferredCountries !== undefined)
      suggestion.preferredCountries = preferredCountries;
    if (strategy !== undefined) suggestion.strategy = strategy;
    if (antiPatterns !== undefined) suggestion.antiPatterns = antiPatterns;
    if (suggestedReply !== undefined)
      suggestion.suggestedReply = suggestedReply;

    await suggestion.save();
    res.json({ suggestion });
  },
);

// DELETE /api/training/suggestions/:suggestionId
export const deleteSuggestion = asyncHandler(
  async (req: Request, res: Response) => {
    const { suggestionId } = req.params;
    const suggestion = await TrainingSuggestion.findByIdAndDelete(suggestionId);

    if (!suggestion)
      return res.status(404).json({ message: "Suggestion not found" });

    if (suggestion.isEmbedded && suggestion.pineconeId) {
      try {
        const index = getPinecone().index(PINECONE_INDEX);
        await index.deleteOne({ id: suggestion.pineconeId });
      } catch (_err) {
        // non-fatal
      }
    }

    res.json({ message: "Suggestion deleted" });
  },
);

// POST /api/training/embed  (embed all unembedded)
// POST /api/training/embed/:leadId  (embed for specific lead)
export const embedSuggestions = asyncHandler(
  async (req: Request, res: Response) => {
    const { leadId } = req.params;

    const query: any = { isEmbedded: false };
    if (leadId) query.leadId = leadId;

    const suggestions = await TrainingSuggestion.find(query);

    let embedded = 0;
    const errors: string[] = [];

    const chatHistoryMap: Record<string, string> = {};

    for (const suggestion of suggestions) {
      try {
        const lid = suggestion.leadId.toString();
        if (!chatHistoryMap[lid]) {
          const ch = await ChatHistory.findOne({ leadId: lid });
          chatHistoryMap[lid] = ch?._id?.toString() ?? "";
        }
        await embedSingleSuggestion(suggestion, chatHistoryMap[lid]);
        embedded++;
      } catch (err: any) {
        errors.push(
          `${(suggestion._id as mongoose.Types.ObjectId).toString()}: ${err.message}`,
        );
      }
    }

    res.json({ total: suggestions.length, embedded, errors });
  },
);

// GET /api/training/search?q=...&companyId=...
export const searchSimilar = asyncHandler(
  async (req: Request, res: Response) => {
    const q = req.query.q as string;
    const companyId = req.query.companyId as string;

    if (!q) return res.status(400).json({ message: "Query (q) is required" });

    const embedding = await createEmbedding(q);
    const index = getPinecone().index(PINECONE_INDEX);

    const results = await index.query({
      vector: embedding,
      topK: 5,
      includeMetadata: true,
      ...(companyId ? { namespace: companyId } : {}),
    });

    res.json(results.matches || []);
  },
);

// GET /api/training/stats
export const getStats = asyncHandler(async (_req: Request, res: Response) => {
  const total = await TrainingSuggestion.countDocuments();
  const embedded = await TrainingSuggestion.countDocuments({
    isEmbedded: true,
  });
  res.json({ total, embedded, unembedded: total - embedded });
});

// POST /api/training/leads/:leadId/generate-reply
export const generateSuggestedReply = asyncHandler(
  async (req: Request, res: Response) => {
    const { leadId } = req.params;
    const { conversationContext, userInstruction, previousSuggestions } =
      req.body;

    const lead = await Lead.findById(leadId);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    const generatedReply = await generateReply({
      conversationContext: conversationContext ?? [],
      instruction: userInstruction,
      previousSuggestions: Array.isArray(previousSuggestions)
        ? previousSuggestions
        : [],
    });

    res.json({ generatedReply });
  },
);
