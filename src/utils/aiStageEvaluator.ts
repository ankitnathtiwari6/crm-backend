import OpenAI from "openai";
import Lead, { IRemark } from "../models/Lead";

const VALID_STAGES = [
  "not_responding",
  "call_started",
  "follow_up",
  "documents_requested",
  "documents_received",
  "application_submitted",
  "closed_won",
  "closed_lost",
];

const STAGE_EVAL_PROMPT = `You are a CRM stage classifier for an MBBS abroad education consultancy.

Pipeline stages (in order of progression):
  not_responding       – lead is not picking up calls or responding to messages
  call_started         – first human counselor call has been made, initial contact
  follow_up            – actively following up, lead is interested but needs nurturing
  documents_requested  – counselor has asked the student to send admission documents
  documents_received   – student has submitted / sent required documents
  application_submitted– college application has been filed on student's behalf
  closed_won           – student enrolled and confirmed admission
  closed_lost          – student dropped out, not interested, or went to a competitor

Classification rules:
- Return the current stage unchanged if the remark does not clearly indicate a transition
- If the remark clearly signals a stage transition, update accordingly
- If no current stage and the remark implies human contact has started, default to "call_started"
- If no current stage and the remark implies no response, default to "not_responding"
- Prefer the more advanced stage when the remark is ambiguous but positive

Return ONLY this JSON — no markdown, no extra text:
{"stage": "<one of the stage values above>", "reason": "<one short sentence>"}`;

const getClient = (): OpenAI => {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

export const evaluateLeadStage = async (
  leadId: string,
  newRemark?: string
): Promise<void> => {
  const lead = await Lead.findById(leadId);
  if (!lead) return;

  const previousStage = (lead as any).stage as string | undefined;

  const contextParts: string[] = [
    `Current stage: ${previousStage || "None"}`,
    `AI quality score: ${lead.leadQualityScore ?? "Unknown"}/100`,
    `Tags: ${(lead.tags ?? []).join(", ") || "None"}`,
  ];

  const recentRemarks: IRemark[] = ((lead as any).remarks ?? []).slice(-5);
  if (recentRemarks.length > 0) {
    contextParts.push(
      `Recent remarks:\n${recentRemarks
        .map((r) => `- "${r.text}" (by ${r.author.name})`)
        .join("\n")}`
    );
  }

  if (newRemark) {
    contextParts.push(`New remark: "${newRemark}"`);
  }

  let result: { stage: string; reason: string };
  try {
    const response = await getClient().chat.completions.create({
      model: "gpt-5.4-mini-2026-03-17",
      messages: [
        { role: "system", content: STAGE_EVAL_PROMPT },
        { role: "user", content: contextParts.join("\n") },
      ],
      max_completion_tokens: 150,
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    result = JSON.parse(raw);
  } catch (err) {
    console.error("[StageEval] AI call failed:", err);
    return;
  }

  const newStage = result.stage?.trim();
  if (!VALID_STAGES.includes(newStage)) {
    console.warn(`[StageEval] Invalid stage returned by AI: "${newStage}"`);
    return;
  }

  if (newStage === previousStage) {
    console.log(`[StageEval] Stage unchanged (${newStage}) for lead ${leadId}`);
    return;
  }

  const now = new Date();
  (lead as any).stage = newStage;
  (lead as any).stageUpdatedAt = now;
  (lead as any).stageUpdatedBy = "ai";
  (lead.activityLog as any[]).push({
    action: `Stage changed from "${previousStage || "None"}" to "${newStage}"`,
    field: "stage",
    oldValue: previousStage || undefined,
    newValue: newStage,
    author: { id: "ai", name: "AI Assistant" },
    createdAt: now,
  });

  await lead.save();
  console.log(
    `[StageEval] Lead ${leadId}: "${previousStage || "None"}" → "${newStage}" — ${result.reason}`
  );
};
