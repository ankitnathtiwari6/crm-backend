import axios from "axios";
import agenda from "./agenda";
import Lead from "../models/Lead";
import Company from "../models/Company";
import ChatHistory from "../models/ChatHistory";
import { runCounselorAgent, LeadContext } from "../utils/openai";

export const JOB_NAME = "send-followup";

// ─── Sequence delays ──────────────────────────────────────────────────────────

const DELAYS_MS: Record<number, number> = {
  1: 2 * 60 * 1000,           // 2 min
  2: 4 * 60 * 1000,           // 4 min
  3: 10 * 60 * 1000,          // 10 min
  4: 6 * 60 * 60 * 1000,      // 6 hours
  5: 14 * 60 * 60 * 1000,     // 14 hours
};

const MAX_STEPS = 5;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Quiet hours (11pm–7am IST = 17:30–01:30 UTC) ────────────────────────────

const isQuietHours = (date: Date): boolean => {
  const totalMin = date.getUTCHours() * 60 + date.getUTCMinutes();
  return totalMin >= 17 * 60 + 30 || totalMin < 1 * 60 + 30;
};

// Returns the next 7am IST (= 01:30 UTC)
const nextAvailableTime = (date: Date): Date => {
  const totalMin = date.getUTCHours() * 60 + date.getUTCMinutes();
  const next = new Date(date);
  if (totalMin < 1 * 60 + 30) {
    // e.g. 00:00 UTC (5:30 IST) — 7am IST is still today at 01:30 UTC
    next.setUTCHours(1, 30, 0, 0);
  } else {
    // e.g. 18:00 UTC (23:30 IST) — 7am IST is next day at 01:30 UTC
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(1, 30, 0, 0);
  }
  return next;
};

// ─── Job definition ───────────────────────────────────────────────────────────

export const defineFollowUpJob = () => {
  agenda.define(JOB_NAME, async (job: any) => {
    const { leadId, step } = job.attrs.data as { leadId: string; step: number };

    try {
      const lead = await Lead.findById(leadId);
      if (!lead || lead.status === "archived") return;

      // Stop if user has replied (last chat message is from lead)
      const chatDoc = await ChatHistory.findOne({ leadId: lead._id });
      const messages = chatDoc?.messages ?? [];
      if (messages.length > 0 && messages[messages.length - 1].role === "lead") {
        console.log(`[FollowUp] ${leadId} already replied — stopping sequence`);
        await clearFollowUp(leadId);
        return;
      }

      // Stop if 24h window exceeded
      if (lead.followUpStartedAt) {
        const elapsed = Date.now() - new Date(lead.followUpStartedAt).getTime();
        if (elapsed > MAX_WINDOW_MS) {
          console.log(`[FollowUp] ${leadId} 24h window exceeded — stopping`);
          await clearFollowUp(leadId);
          return;
        }
      }

      // Defer if quiet hours
      const now = new Date();
      if (isQuietHours(now)) {
        const resumeAt = nextAvailableTime(now);
        console.log(`[FollowUp] Quiet hours — deferring ${leadId} step ${step} to ${resumeAt.toISOString()}`);
        await job.schedule(resumeAt).save();
        return;
      }

      // Get WhatsApp credentials from Company via lead's businessPhoneId
      const company = await Company.findOne({
        whatsappNumbers: {
          $elemMatch: { phoneNumberId: lead.businessPhoneId, isActive: true },
        },
      });
      const waNumber = company?.whatsappNumbers.find(
        (n) => n.phoneNumberId === lead.businessPhoneId && n.isActive
      );
      if (!waNumber) {
        console.warn(`[FollowUp] No WhatsApp creds for lead ${leadId}`);
        return;
      }

      // Build lead context + recent chat history for agent
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
      };

      const recentMessages = messages
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));

      // Generate follow-up message via agent
      const { agentMessage } = await runCounselorAgent(
        recentMessages,
        leadContext,
        { isFollowUp: true, followUpStep: step }
      );

      // Send via WhatsApp
      let sentMsgId = `followup_${Date.now()}`;
      try {
        const response = await axios.post(
          `https://graph.facebook.com/v22.0/${lead.businessPhoneId}/messages`,
          {
            messaging_product: "whatsapp",
            to: lead.leadPhoneNumber,
            type: "text",
            text: { body: agentMessage },
          },
          {
            headers: {
              Authorization: `Bearer ${waNumber.accessToken}`,
              "Content-Type": "application/json",
            },
          }
        );
        sentMsgId = response.data.messages?.[0]?.id ?? sentMsgId;
        console.log(`[FollowUp] Step ${step} sent to ${lead.leadPhoneNumber}`);
      } catch (err: any) {
        console.error(`[FollowUp] Send failed for ${lead.leadPhoneNumber}:`, err?.response?.data ?? err.message);
      }

      // Save to ChatHistory
      await ChatHistory.findOneAndUpdate(
        { leadId: lead._id },
        {
          $push: {
            messages: {
              messageId: sentMsgId,
              content: agentMessage,
              role: "assistant",
              timestamp: new Date(),
              status: "sent",
            },
          },
        }
      );

      // Schedule next step or finish sequence
      const nextStep = step + 1;
      if (nextStep <= MAX_STEPS) {
        await scheduleFollowUp(leadId, nextStep, false); // false = don't reset startedAt
      } else {
        console.log(`[FollowUp] Sequence complete for ${leadId}`);
        await clearFollowUp(leadId);
      }
    } catch (err) {
      console.error(`[FollowUp] Unexpected error for lead ${leadId}:`, err);
    }
  });
};

// ─── Public helpers ───────────────────────────────────────────────────────────

export const scheduleFollowUp = async (
  leadId: string,
  step: number = 1,
  resetStartedAt: boolean = true
): Promise<void> => {
  const delay = DELAYS_MS[step];
  if (!delay) return;

  // Cancel any existing job for this lead first
  await agenda.cancel({ name: JOB_NAME, data: { leadId } });

  const runAt = new Date(Date.now() + delay);
  const job = await agenda.schedule(runAt, JOB_NAME, { leadId, step });

  const update: any = {
    followUpStep: step,
    followUpJobId: job.attrs._id?.toString(),
  };
  if (resetStartedAt) update.followUpStartedAt = new Date();

  await Lead.findByIdAndUpdate(leadId, update);
  console.log(`[FollowUp] Step ${step} scheduled for ${leadId} at ${runAt.toISOString()}`);
};

export const cancelFollowUp = async (leadId: string): Promise<void> => {
  const cancelled = await agenda.cancel({ name: JOB_NAME, data: { leadId } });
  if (cancelled > 0) {
    console.log(`[FollowUp] Cancelled pending job for ${leadId}`);
  }
  await clearFollowUp(leadId);
};

const clearFollowUp = async (leadId: string): Promise<void> => {
  await Lead.findByIdAndUpdate(leadId, {
    $unset: { followUpStep: "", followUpJobId: "", followUpStartedAt: "" },
  });
};
