/**
 * Batch suggestion generator
 *
 * For every lead with leadQualityScore > MIN_SCORE, generates a pending_review
 * TrainingSuggestion for each AI message that has no suggestion yet.
 * Uses the already-embedded training examples as style reference.
 * Does NOT embed anything — trainer reviews and confirms manually.
 *
 * Usage:
 *   npx ts-node src/scripts/batchGenerateSuggestions.ts
 *   npx ts-node src/scripts/batchGenerateSuggestions.ts --dry-run
 *   npx ts-node src/scripts/batchGenerateSuggestions.ts --limit 5
 *   npx ts-node src/scripts/batchGenerateSuggestions.ts --leadId <mongoId>
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";
import OpenAI from "openai";
import Lead from "../models/Lead";
import ChatHistory from "../models/ChatHistory";
import TrainingSuggestion from "../models/TrainingSuggestion";
import {
  generateReply,
  formatConversationForReply as formatConversation,
} from "../utils/replyGenerator";

// ── Config ────────────────────────────────────────────────────────────────────

const MIN_SCORE = 40;
const CALL_DELAY_MS = 1500; // throttle between GPT calls (~40 req/min)

// ── OpenAI (used only by analyzeForTraining) ──────────────────────────────────

let _openai: OpenAI | null = null;
const getOpenAI = () => {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return _openai;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function deriveInstruction(
  context: Array<{ role: string; content: string }>,
): string {
  const lastLead = [...context].reverse().find((m) => m.role === "lead");
  if (!lastLead) {
    return "Generate the ideal follow-up message — share one genuinely helpful fact about MBBS abroad, no questions";
  }
  const c = lastLead.content.toLowerCase();
  if (/kitna|fees|cost|lagega|rupee|price|amount|budget/.test(c)) {
    return "Give a brief honest fee range for Russia and Uzbekistan then ask for any remaining missing details";
  }
  if (/neet|score|\d{3}/.test(c)) {
    return "Acknowledge the NEET score warmly, mention what universities it qualifies for, and ask for any remaining missing details";
  }
  if (
    /country|russia|uzbekistan|kyrgyzstan|kazakhstan|georgia|philippines/.test(
      c,
    )
  ) {
    return "Respond to the country preference enthusiastically, mention Samarkand as a top option if relevant, and ask for missing details";
  }
  return "Acknowledge what the user said naturally and ask for any remaining missing details (NEET score, city, preferred country, budget) in bullet points. Keep it short and conversational";
}

// ── GPT calls ─────────────────────────────────────────────────────────────────

async function analyzeForTraining(params: {
  context: Array<{ role: string; content: string }>;
  suggestedReply: string;
  originalAiReply: string;
}) {
  const conversationText = formatConversation(params.context);
  const secondLast =
    params.context.length >= 2
      ? params.context[params.context.length - 2]
      : null;
  const isFollowUp = secondLast?.role === "assistant";
  const followUpNote = isFollowUp
    ? `NOTE: The last message is from the AGENT with no lead reply — FOLLOW-UP. Prefix situation with "Follow-up: " and stage with "Follow-up / ".`
    : "";

  const prompt = `You are building a RAG training dataset for a WhatsApp MBBS abroad admissions AI agent.

Conversation:
${conversationText}

Original AI reply:
"${params.originalAiReply}"

Suggested better reply:
"${params.suggestedReply}"
${followUpNote ? `\n${followUpNote}\n` : ""}
Output this JSON only — no markdown:

{
  "situation": "One short sentence (max 20 words). No Follow-up prefix unless NOTE above says so.",
  "stage": "Stage label + what is known. Use Early/Mid/Late. No prefix unless NOTE says so.",
  "userIntent": "Short phrase — what the user is trying to achieve.",
  "constraints": "Short phrase (max 12 words). Key limits only.",
  "signals": "Emotional state, comma-separated.",
  "preferredCountries": ["countries explicitly mentioned or clearly implied — empty array if none"],
  "strategy": ["2-3 short actionable steps, max 8 words each"],
  "antiPatterns": ["2-3 short mistakes to avoid, max 8 words each"]
}`;

  const res = await getOpenAI().chat.completions.create({
    model: "gpt-5.4-mini-2026-03-17",
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 600,
    temperature: 0.3,
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(res.choices[0]?.message?.content?.trim() ?? "{}");
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const leadLimit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0;
  const leadIdIdx = args.indexOf("--leadId");
  const singleLeadId = leadIdIdx !== -1 ? args[leadIdIdx + 1] : null;

  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("[DB] Connected");

  // Load embedded training examples as style reference
  const embedded = await TrainingSuggestion.find({ isEmbedded: true })
    .select("suggestedReply situation")
    .limit(8);

  const styleExamples = embedded
    .filter((s) => s.suggestedReply && s.situation)
    .slice(0, 5)
    .map(
      (s, i) =>
        `[${i + 1}] Situation: ${s.situation}\nReply: "${s.suggestedReply}"`,
    )
    .join("\n\n");

  console.log(
    `[Style] ${embedded.length} embedded examples loaded as style reference`,
  );
  if (dryRun) console.log("[Mode] DRY RUN — nothing will be saved\n");

  // Find qualifying leads
  const leadQuery: any = {
    leadQualityScore: { $gt: MIN_SCORE },
    status: { $ne: "archived" },
  };
  if (singleLeadId) {
    leadQuery._id = new mongoose.Types.ObjectId(singleLeadId);
  }

  const leads = await Lead.find(leadQuery)
    .select("_id leadPhoneNumber name leadQualityScore companyId")
    .sort({ leadQualityScore: -1 })
    .limit(leadLimit);

  console.log(`[Batch] ${leads.length} leads with score > ${MIN_SCORE}\n`);

  let totalGenerated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const lead of leads) {
    const leadId = (lead._id as mongoose.Types.ObjectId).toString();
    const label = (lead as any).name ?? (lead as any).leadPhoneNumber;

    const chatHistory = await ChatHistory.findOne({ leadId });
    if (!chatHistory?.messages?.length) {
      console.log(`  [${label}] no chat history — skip`);
      continue;
    }

    // Collect messageIds that already have a suggestion (any status)
    const existing = await TrainingSuggestion.find({ leadId }).select(
      "messageId",
    );
    const covered = new Set(existing.map((s) => s.messageId));

    // AI messages without any suggestion yet
    const toProcess = chatHistory.messages
      .map((msg, index) => ({ msg, index }))
      .filter(
        ({ msg }) => msg.role === "assistant" && !covered.has(msg.messageId),
      );

    if (toProcess.length === 0) {
      console.log(`  [${label}] all AI messages already covered — skip`);
      totalSkipped++;
      continue;
    }

    console.log(
      `  [${label}] score=${(lead as any).leadQualityScore} · ${toProcess.length} AI messages to process`,
    );

    for (const { msg, index } of toProcess) {
      // Context = all messages up to and including this one
      const context = chatHistory.messages.slice(0, index + 1).map((m) => ({
        role: m.role as "lead" | "assistant",
        content: m.content,
      }));

      const preview = msg.content.slice(0, 60).replace(/\n/g, " ");

      if (dryRun) {
        console.log(`    [dry] msg[${index}]: "${preview}…"`);
        totalGenerated++;
        continue;
      }

      try {
        // Step 1 — generate best reply
        const suggestedReply = await generateReply({
          conversationContext: context,
          instruction: deriveInstruction(context),
          styleExamples,
        });
        if (!suggestedReply) {
          console.log(`    [skip] empty reply for msg[${index}]`);
          continue;
        }
        await sleep(CALL_DELAY_MS);

        // Step 2 — generate metadata fields
        const meta = await analyzeForTraining({
          context,
          suggestedReply,
          originalAiReply: msg.content,
        });
        await sleep(CALL_DELAY_MS);

        // Step 3 — save as pending_review (no embedding)
        await TrainingSuggestion.findOneAndUpdate(
          { leadId, messageId: msg.messageId },
          {
            leadId,
            companyId: (lead as any).companyId,
            leadPhoneNumber: (lead as any).leadPhoneNumber,
            messageId: msg.messageId,
            conversationContext: context,
            originalAiReply: msg.content,
            suggestedReply,
            isEmbedded: false,
            embeddingStatus: "pending_review",
            ...meta,
          },
          { upsert: true, new: true },
        );

        console.log(
          `    [ok] msg[${index}]: "${suggestedReply.slice(0, 60).replace(/\n/g, " ")}…"`,
        );
        totalGenerated++;
      } catch (err: any) {
        console.error(`    [err] msg[${index}]: ${err?.message}`);
        totalErrors++;
        await sleep(CALL_DELAY_MS);
      }
    }
  }

  console.log(
    `\n[Done] Generated: ${totalGenerated} | Errors: ${totalErrors} | Leads skipped: ${totalSkipped}`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
