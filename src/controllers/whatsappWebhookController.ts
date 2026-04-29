import { Request, Response } from "express";
import asyncHandler from "../utils/asyncHandler";
import Lead, { ISession } from "../models/Lead";
import Company from "../models/Company";
import ChatHistory from "../models/ChatHistory";
import { runCounselorAgent, LeadContext } from "../utils/openai";
import { scheduleFollowUp, cancelFollowUp } from "../jobs/followUpJob";
import { evaluateLeadStage } from "../utils/aiStageEvaluator";
import axios from "axios";

// ─── WhatsApp API helpers ─────────────────────────────────────────────────────

const waPost = (businessPhoneId: string, accessToken: string, data: any) =>
  axios.post(
    `https://graph.facebook.com/v22.0/${businessPhoneId}/messages`,
    data,
    { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
  );

const sendWhatsappMessage = async (
  to: string,
  text: string,
  businessPhoneId: string,
  accessToken: string
) => {
  const response = await waPost(businessPhoneId, accessToken, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
  return response.data;
};

// Mark incoming message as read (shows blue ticks to user)
const markAsRead = async (
  messageId: string,
  businessPhoneId: string,
  accessToken: string
) => {
  await waPost(businessPhoneId, accessToken, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  }).catch((e) => console.warn("markAsRead failed:", e?.response?.data ?? e.message));
};

// Note: WhatsApp Cloud API does not support typing indicators — removed.

// ─── Webhook verification ─────────────────────────────────────────────────────

export const verifyWebhook = asyncHandler(async (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"] as string;
  const challenge = req.query["hub.challenge"];

  if (!mode || !token) return res.sendStatus(400);
  if (mode !== "subscribe") return res.sendStatus(403);

  // Accept the global env token as a valid fallback
  const globalToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (globalToken && token === globalToken) {
    console.log("WEBHOOK_VERIFIED via global WHATSAPP_VERIFY_TOKEN");
    return res.status(200).send(challenge);
  }

  // Otherwise look up the token against a company's stored verifyToken
  const company = await Company.findOne({
    whatsappNumbers: {
      $elemMatch: { verifyToken: token, isActive: true },
    },
  });

  if (!company) {
    console.warn(`WEBHOOK_VERIFY_FAILED: no company found for token ${token}`);
    return res.sendStatus(403);
  }

  console.log(`WEBHOOK_VERIFIED for company: ${company.name}`);
  res.status(200).send(challenge);
});

// ─── Webhook processor ───────────────────────────────────────────────────────

export const processWebhook = asyncHandler(
  async (req: Request, res: Response) => {
    const body = req.body;

    if (body.object !== "whatsapp_business_account") {
      return res.sendStatus(404);
    }

    // Acknowledge immediately — WhatsApp requires < 20s response
    res.status(200).send("EVENT_RECEIVED");

    // Process async (do not await before sending 200)
    handleIncomingMessages(body).catch((err) =>
      console.error("Error in handleIncomingMessages:", err)
    );
  }
);

// ─── Quality tag helpers ──────────────────────────────────────────────────────

// "Junk" is intentionally excluded — it is assigned manually or by a time-based job (90+ days inactive), never by AI scoring
const QUALITY_TAGS = new Set(["Most Interested", "Interested", "Least Interested", "Not Interested", "Not Responding"]);

const getQualityTag = (score: number): string => {
  if (score >= 80) return "Most Interested";
  if (score >= 60) return "Interested";
  if (score >= 40) return "Least Interested";
  if (score >= 20) return "Not Interested";
  return "Not Responding";
};

// ─── Core message handler ─────────────────────────────────────────────────────

const handleIncomingMessages = async (body: any) => {
  for (const entry of body.entry) {
    for (const change of entry.changes) {
      // Handle delivery/read status updates — no agent needed
      if (change.field === "messages" && change.value.statuses) {
        for (const status of change.value.statuses) {
          await updateMessageStatus(status.id, status.status).catch(() => {});
        }
      }

      if (change.field !== "messages" || !change.value.messages) continue;

      const metadata = change.value.metadata;
      const businessPhoneNumber: string = metadata.display_phone_number;
      const businessPhoneId: string = metadata.phone_number_id;

      // Find the company that owns this exact phoneNumberId (active)
      // $elemMatch ensures both conditions hit the SAME array element
      const company = await Company.findOne({
        whatsappNumbers: {
          $elemMatch: { phoneNumberId: businessPhoneId, isActive: true },
        },
      });

      const waNumber = company?.whatsappNumbers.find(
        (n) => n.phoneNumberId === businessPhoneId && n.isActive
      );

      if (!company || !waNumber) {
        // Log all stored phoneNumberIds so we can spot the mismatch
        const allCompanies = await Company.find({}, { name: 1, "whatsappNumbers.phoneNumberId": 1, "whatsappNumbers.isActive": 1 });
        console.warn(`[MISMATCH] Incoming phoneNumberId from webhook: "${businessPhoneId}"`);
        console.warn(`[MISMATCH] Stored numbers in DB:`, JSON.stringify(allCompanies.map(c => ({
          company: c.name,
          numbers: c.whatsappNumbers.map(n => ({ phoneNumberId: n.phoneNumberId, isActive: n.isActive }))
        })), null, 2));
        continue;
      }

      const accessToken: string = waNumber.accessToken;
      const companyId = company._id;

      console.log(`[${businessPhoneId}] Matched company: "${company.name}" (${companyId})`);

      for (const message of change.value.messages) {
        // Only handle inbound text / media — skip status-only events
        if (!message.from) continue;

        const leadPhoneNumber: string = message.from;
        const messageBody: string =
          message.text?.body ?? extractMediaContent(message);
        const messageId: string = message.id;
        const timestamp = new Date(parseInt(message.timestamp) * 1000);

        console.log(`[${leadPhoneNumber}] Incoming: ${messageBody}`);

        try {
          // 1. Show read receipt (blue ticks)
          await markAsRead(messageId, businessPhoneId, accessToken);

          // 2. Upsert lead
          const lead = await upsertLead(
            leadPhoneNumber,
            businessPhoneNumber,
            businessPhoneId,
            companyId
          );

          // 3. Resolve active session (creates new one if needed)
          const sessionId = await resolveSession((lead._id as any).toString(), lead.sessions ?? []);

          // 4. Save incoming message tagged with sessionId
          const incomingMsg = { messageId, content: messageBody, role: "lead" as const, timestamp, sessionId };
          await pushToChatHistory(lead._id, lead.leadPhoneNumber, lead.businessPhoneNumber!, companyId, incomingMsg);

          // Cancel any pending follow-up — user has replied
          await cancelFollowUp((lead._id as any).toString());

          // 5. Fetch last 20 messages across ALL sessions for agent context
          const chatDoc = await ChatHistory.findOne({ leadId: lead._id });
          const recentMessages = (chatDoc?.messages ?? [])
            .slice(-20)
            .map((m) => ({ role: m.role, content: m.content }));

          // 6. Build lead context
          const leadContext: LeadContext = {
            contactType: lead.contactType,
            name: lead.name,
            studentName: lead.studentName,
            city: lead.city,
            state: lead.state,
            preferredCountry: lead.preferredCountry,
            preferredCollege: lead.preferredCollege,
            neetScore: lead.neetScore,
            neetYear: lead.neetYear,
            qualification: lead.qualification,
            targetYear: lead.targetYear,
            budget: (lead as any).budget,
            email: lead.email,
            totalMessages: lead.messageCount,
            sessionCount: lead.sessions?.length,
          };

          // 7. Run the counselor agent
          const { agentMessage, extractedData, conversationComplete, leadQualityScore, leadQualityScoreReason } =
            await runCounselorAgent(recentMessages, leadContext);

          console.log(`[${leadPhoneNumber}] Agent reply: ${agentMessage}`);
          console.log(`[${leadPhoneNumber}] Quality score: ${leadQualityScore} — ${leadQualityScoreReason}`);
          if (conversationComplete) console.log(`[${leadPhoneNumber}] Conversation complete`);

          // 8. Send agent reply via WhatsApp
          let sentMsgId = `agent_${Date.now()}`;
          try {
            const sent = await sendWhatsappMessage(leadPhoneNumber, agentMessage, businessPhoneId, accessToken);
            sentMsgId = sent.messages?.[0]?.id ?? sentMsgId;
          } catch (sendErr: any) {
            console.error(`[${leadPhoneNumber}] Failed to send WhatsApp message:`, sendErr?.response?.data ?? sendErr.message);
          }

          // 9. Save agent reply tagged with sessionId
          const agentMsg = {
            messageId: sentMsgId,
            content: agentMessage,
            role: "assistant" as const,
            timestamp: new Date(),
            status: "sent" as const,
            sessionId,
          };
          await pushToChatHistory(lead._id, lead.leadPhoneNumber, lead.businessPhoneNumber!, companyId, agentMsg);

          // 10. Schedule or cancel follow-up + set initial stage via AI when conversation ends
          if (conversationComplete) {
            await cancelFollowUp((lead._id as any).toString());
            // Trigger AI stage eval if the lead has no stage yet
            const freshLead = await Lead.findById(lead._id);
            if (freshLead && !(freshLead as any).stage) {
              evaluateLeadStage((lead._id as any).toString()).catch((err) =>
                console.error("[StageEval] Post-conversation eval error:", err)
              );
            }
          } else {
            await scheduleFollowUp((lead._id as any).toString(), 1);
          }

          // 11. Update lead: counters + extracted fields + quality score + session messageCount
          const updateFields: any = {};
          for (const [key, val] of Object.entries(extractedData)) {
            const existing = (lead as any)[key];
            if (val !== null && val !== undefined && val !== "" &&
                (existing === undefined || existing === null || existing === "")) {
              updateFields[key] = val;
            }
          }
          if (leadQualityScore !== undefined) {
            updateFields.leadQualityScore = leadQualityScore;
            updateFields.leadQualityScoreReason = leadQualityScoreReason ?? "";
            updateFields.leadQualityScoreUpdatedAt = new Date();
            // Sync the AI quality tag into aiTags only — never touch manual tags
            updateFields.aiTags = [getQualityTag(leadQualityScore)];
          }

          const sessionUpdate: any = {
            $inc: { messageCount: 2, numberOfChatsMessages: 2, "sessions.$[s].messageCount": 2 },
            $set: { lastInteraction: new Date(), ...updateFields },
          };
          if (conversationComplete) {
            sessionUpdate.$set["sessions.$[s].status"] = "complete";
          }

          await Lead.findByIdAndUpdate(
            lead._id,
            sessionUpdate,
            { arrayFilters: [{ "s.sessionId": sessionId }] }
          );
        } catch (err) {
          console.error(`[${leadPhoneNumber}] Error processing message:`, err);
        }
      }
    }
  }
};

// ─── Session management ───────────────────────────────────────────────────────

const SESSION_MAX_MESSAGES = 55;
const SESSION_MAX_DAYS = 7;

const resolveSession = async (leadId: string, sessions: ISession[]): Promise<string> => {
  const last = sessions[sessions.length - 1];
  const now = Date.now();

  if (last && last.status === "active") {
    const ageDays = (now - new Date(last.startedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (last.messageCount < SESSION_MAX_MESSAGES && ageDays < SESSION_MAX_DAYS) {
      return last.sessionId; // reuse existing session
    }
    // Expire it
    await Lead.findByIdAndUpdate(
      leadId,
      { $set: { "sessions.$[s].status": "expired" } },
      { arrayFilters: [{ "s.sessionId": last.sessionId }] }
    );
  }

  // Create a new session
  const newSessionId = `sess_${now}_${Math.random().toString(36).slice(2, 7)}`;
  await Lead.findByIdAndUpdate(leadId, {
    $push: { sessions: { sessionId: newSessionId, startedAt: new Date(), messageCount: 0, status: "active" } },
  });
  console.log(`[Session] New session ${newSessionId} for lead ${leadId}`);
  return newSessionId;
};

// ─── Lead upsert (no embedded chat) ──────────────────────────────────────────

const upsertLead = async (
  leadPhoneNumber: string,
  businessPhoneNumber: string,
  businessPhoneId: string,
  companyId: any
) => {
  let lead = await Lead.findOne({ leadPhoneNumber, businessPhoneNumber });

  if (!lead) {
    lead = await Lead.create({
      leadPhoneNumber,
      businessPhoneNumber,
      businessPhoneId,
      companyId,
      firstInteraction: new Date(),
      lastInteraction: new Date(),
      messageCount: 0,
      numberOfChatsMessages: 0,
      numberOfEnquiry: 1,
      status: "active",
      tags: [],
    });
    console.log(`[${leadPhoneNumber}] New lead created`);
  }

  return lead;
};

// ─── ChatHistory upsert ───────────────────────────────────────────────────────

const pushToChatHistory = async (
  leadId: any,
  leadPhoneNumber: string,
  businessPhoneNumber: string,
  companyId: any,
  message: { messageId: string; content: string; role: "lead" | "assistant"; timestamp: Date; status?: string; sessionId?: string }
) => {
  await ChatHistory.findOneAndUpdate(
    { leadId },
    {
      $setOnInsert: { leadId, leadPhoneNumber, businessPhoneNumber, companyId },
      $push: { messages: message },
    },
    { upsert: true, new: true }
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const extractMediaContent = (message: any): string => {
  if (message.image) return "[Image]";
  if (message.audio) return "[Audio]";
  if (message.video) return "[Video]";
  if (message.document) return "[Document]";
  if (message.location) return `[Location: ${message.location.latitude}, ${message.location.longitude}]`;
  if (message.contacts) return "[Contact]";
  if (message.sticker) return "[Sticker]";
  if (message.reaction) return `[Reaction: ${message.reaction.emoji}]`;
  return "[Unknown message type]";
};

const updateMessageStatus = async (messageId: string, status: string) => {
  const result = await ChatHistory.findOneAndUpdate(
    { "messages.messageId": messageId },
    { $set: { "messages.$.status": status } }
  );
  if (result) {
    console.log(`Message ${messageId} → ${status}`);
  }
};
