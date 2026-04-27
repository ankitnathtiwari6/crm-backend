import { Request, Response } from "express";
import mongoose from "mongoose";
import asyncHandler from "../utils/asyncHandler";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import TrainingSuggestion from "../models/TrainingSuggestion";
import ChatHistory from "../models/ChatHistory";
import Lead from "../models/Lead";
import Company from "../models/Company";

const PINECONE_INDEX = "chat-history";

let _openai: OpenAI | null = null;
let _pinecone: Pinecone | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return _openai;
}

function getPinecone(): Pinecone {
  if (!_pinecone) _pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  return _pinecone;
}

async function createEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8000),
  });
  return response.data[0].embedding;
}

function formatConversation(
  messages: Array<{ role: string; content: string }>
): string {
  return messages
    .map((m) => `${m.role === "lead" ? "Customer" : "Agent"}: ${m.content}`)
    .join("\n");
}

// GET /api/training/companies
export const getCompanies = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const companies = await Company.find({ "users.userId": userId });
    res.json(companies);
  }
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
        "name leadPhoneNumber stage lastInteraction numberOfChatsMessages messageCount"
      )
      .sort({ lastInteraction: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({ leads, total, pages: Math.ceil(total / limit), page });
  }
);

// GET /api/training/leads/:leadId/chat
export const getChatWithSuggestions = asyncHandler(
  async (req: Request, res: Response) => {
    const { leadId } = req.params;

    const lead = await Lead.findById(leadId).select(
      "name leadPhoneNumber stage lastInteraction companyId"
    );
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    const chatHistory = await ChatHistory.findOne({ leadId });
    const suggestions = await TrainingSuggestion.find({ leadId });

    const suggestionMap = suggestions.reduce(
      (acc, s) => {
        acc[s.messageId] = s;
        return acc;
      },
      {} as Record<string, any>
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
  }
);

// POST /api/training/leads/:leadId/suggestions
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
      },
      { upsert: true, new: true }
    );

    res.json({ suggestion });
  }
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
  }
);

// POST /api/training/embed  (embed all unembedded)
// POST /api/training/embed/:leadId  (embed for specific lead)
export const embedSuggestions = asyncHandler(
  async (req: Request, res: Response) => {
    const { leadId } = req.params;

    const query: any = { isEmbedded: false };
    if (leadId) query.leadId = leadId;

    const suggestions = await TrainingSuggestion.find(query);

    const index = getPinecone().index(PINECONE_INDEX);
    let embedded = 0;
    const errors: string[] = [];

    for (const suggestion of suggestions) {
      try {
        const conversationText = formatConversation(
          suggestion.conversationContext
        );
        const embedding = await createEmbedding(conversationText);
        const id = (suggestion._id as mongoose.Types.ObjectId).toString();
        const ns = suggestion.companyId.toString();

        await index.upsert({
          records: [
            {
              id,
              values: embedding,
              metadata: {
                leadId: suggestion.leadId.toString(),
                companyId: ns,
                suggestedReply: suggestion.suggestedReply.slice(0, 500),
                originalAiReply: suggestion.originalAiReply.slice(0, 500),
                conversationText: conversationText.slice(0, 1000),
              },
            },
          ],
          namespace: ns,
        });

        await TrainingSuggestion.findByIdAndUpdate(suggestion._id, {
          isEmbedded: true,
          pineconeId: id,
        });

        embedded++;
      } catch (err: any) {
        errors.push(`${(suggestion._id as mongoose.Types.ObjectId).toString()}: ${err.message}`);
      }
    }

    res.json({ total: suggestions.length, embedded, errors });
  }
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
  }
);

// GET /api/training/stats
export const getStats = asyncHandler(async (_req: Request, res: Response) => {
  const total = await TrainingSuggestion.countDocuments();
  const embedded = await TrainingSuggestion.countDocuments({ isEmbedded: true });
  res.json({ total, embedded, unembedded: total - embedded });
});
