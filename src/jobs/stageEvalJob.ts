import agenda from "./agenda";
import Lead from "../models/Lead";
import { evaluateLeadStage } from "../utils/aiStageEvaluator";

export const STAGE_EVAL_JOB_NAME = "evaluate-stage";

const DELAY_MS = parseInt(process.env.STAGE_AI_DELAY_MS ?? "60000");

export const defineStageEvalJob = (): void => {
  agenda.define(STAGE_EVAL_JOB_NAME, async (job: any) => {
    const { leadId, remarkCreatedAt } = job.attrs.data as {
      leadId: string;
      remarkCreatedAt: string;
    };

    try {
      const lead = await Lead.findById(leadId);
      if (!lead) return;

      const stageUpdatedAt = (lead as any).stageUpdatedAt as Date | undefined;
      const remarkTime = new Date(remarkCreatedAt);

      // Counselor manually updated stage after the remark was added — skip AI
      if (stageUpdatedAt && stageUpdatedAt > remarkTime) {
        console.log(
          `[StageEval] Lead ${leadId}: counselor updated stage manually — skipping AI`
        );
        return;
      }

      console.log(`[StageEval] Lead ${leadId}: no manual update — running AI evaluation`);
      await evaluateLeadStage(leadId);
    } catch (err) {
      console.error(`[StageEval] Job error for lead ${leadId}:`, err);
    }
  });
};

export const scheduleStageEval = async (
  leadId: string,
  remarkCreatedAt: Date
): Promise<void> => {
  // Cancel any pending stage eval for this lead (e.g. from a previous remark)
  await agenda.cancel({ name: STAGE_EVAL_JOB_NAME, "data.leadId": leadId });

  const runAt = new Date(Date.now() + DELAY_MS);
  await agenda.schedule(runAt, STAGE_EVAL_JOB_NAME, {
    leadId,
    remarkCreatedAt: remarkCreatedAt.toISOString(),
  });

  console.log(
    `[StageEval] Scheduled for lead ${leadId} at ${runAt.toISOString()} (delay: ${DELAY_MS}ms)`
  );
};
