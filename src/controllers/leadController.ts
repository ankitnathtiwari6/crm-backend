import { Request, Response } from "express";
import Lead from "../models/Lead";
import ChatHistory from "../models/ChatHistory";
import asyncHandler from "../utils/asyncHandler";
import User from "../models/User";
import { cancelFollowUp } from "../jobs/followUpJob";
import { scheduleStageEval } from "../jobs/stageEvalJob";
import { evaluateLeadStage } from "../utils/aiStageEvaluator";

export const getLeads = asyncHandler(async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const filter: any = {};

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search as string, "i");
      filter.$or = [
        { leadPhoneNumber: searchRegex },
        { name: searchRegex },
        { email: searchRegex },
      ];
    }

    if (req.query.neetStatus) {
      if (req.query.neetStatus === "withScore") {
        filter.neetScore = { $exists: true, $ne: null };
      } else if (req.query.neetStatus === "withoutScore") {
        filter.neetScore = { $exists: false };
      }
    }

    if (req.query.minScore || req.query.maxScore) {
      filter.neetScore = { $exists: true, $ne: null };
      if (req.query.minScore) filter.neetScore.$gte = parseInt(req.query.minScore as string);
      if (req.query.maxScore) filter.neetScore.$lte = parseInt(req.query.maxScore as string);
    }

    // Country filtering
    if (req.query.country) {
      filter.preferredCountry = new RegExp(req.query.country as string, "i");
    }

    // Location filtering (city or state)
    if (req.query.location) {
      const locationRegex = new RegExp(req.query.location as string, "i");
      filter.$or = [
        ...(filter.$or || []),
        { city: locationRegex },
        { state: locationRegex },
      ];
    }

    // Assigned to filtering
    if (req.query.assignedTo) {
      filter["assignedTo.id"] = req.query.assignedTo as string;
    }

    // Unassigned leads filtering
    if (req.query.unassigned === "true") {
      filter["assignedTo"] = { $exists: false };
    }

    // Tags filtering — always use $all so multiple selections are AND (lead must have every selected tag)
    const tags = req.query.tags;
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      if (tagArray.length > 0) {
        filter.tags = { $all: tagArray };
      }
    }

    // Qualified leads (can be customized based on your definition of qualified)
    if (req.query.isQualified === "true") {
      filter.$and = [
        { neetScore: { $exists: true, $ne: null } },
        { neetScore: { $gte: 500 } }, // Example threshold
      ];
    }

    // Created-at date range filtering
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};

      if (req.query.startDate) {
        filter.createdAt.$gte = new Date(req.query.startDate as string);
      }

      if (req.query.endDate) {
        const endDate = new Date(req.query.endDate as string);
        endDate.setDate(endDate.getDate() + 1);
        filter.createdAt.$lte = endDate;
      }
    }

    // Active date (lastInteraction) range filtering
    if (req.query.activeStartDate || req.query.activeEndDate) {
      filter.lastInteraction = {};

      if (req.query.activeStartDate) {
        filter.lastInteraction.$gte = new Date(req.query.activeStartDate as string);
      }

      if (req.query.activeEndDate) {
        const endDate = new Date(req.query.activeEndDate as string);
        endDate.setDate(endDate.getDate() + 1);
        filter.lastInteraction.$lte = endDate;
      }
    }

    // Status filtering
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // Stage filtering (from funnel bar click)
    if (req.query.stage) {
      filter.stage = req.query.stage;
    }

    // AI-engaged filter (had at least one message from the lead)
    if (req.query.aiEngaged === "true") {
      filter.messageCount = { $gt: 0 };
    }

    // Quality score floor — used by Hot (≥70) funnel pill
    if (req.query.minQualityScore) {
      filter.leadQualityScore = { $gte: parseInt(req.query.minQualityScore as string) };
    }

    // Count total documents for pagination
    const total = await Lead.countDocuments(filter);

    // Get today's leads count
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    console.log("Today date range:", today, "to", tomorrow);

    const todayLeadsCount = await Lead.countDocuments({
      createdAt: {
        $gte: today,
        $lt: tomorrow,
      },
    });

    console.log("Today's leads count calculated:", todayLeadsCount);

    // Fetch leads with pagination and sorting
    const sortField = (req.query.sortBy as string) || "lastInteraction";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const allowedSortFields = ["lastInteraction", "createdAt", "leadQualityScore"];
    const resolvedSort = allowedSortFields.includes(sortField) ? sortField : "lastInteraction";

    const leads = await Lead.find(filter)
      .sort({ [resolvedSort]: sortOrder })
      .skip(skip)
      .limit(limit);

    // Return full lead data
    const transformedLeads = leads.map((lead) => ({
      id: lead._id,
      leadPhoneNumber: lead.leadPhoneNumber,
      businessPhoneNumber: lead.businessPhoneNumber,
      businessPhoneId: lead.businessPhoneId,
      name: lead.name || "Unknown",
      email: lead.email || null,
      preferredCountry: lead.preferredCountry || null,
      city: lead.city || null,
      state: lead.state || null,
      neetScore: lead.neetScore,
      assignedTo: lead.assignedTo || null,
      numberOfEnquiry: lead.numberOfEnquiry,
      numberOfChatsMessages: lead.numberOfChatsMessages,
      firstInteraction: lead.firstInteraction,
      lastInteraction: lead.lastInteraction,
      messageCount: lead.messageCount,
      status: lead.status,
      stage: (lead as any).stage || null,
      stageUpdatedBy: (lead as any).stageUpdatedBy || null,
      tags: lead.tags || [],
      aiTags: (lead as any).aiTags || [],
      source: lead.source || "WhatsApp",
      notes: lead.notes || null,
      chatHistory: lead.chatHistory || [],
      sessions: lead.sessions || [],
      leadQualityScore: lead.leadQualityScore ?? null,
      leadQualityScoreReason: lead.leadQualityScoreReason ?? null,
      leadQualityScoreUpdatedAt: lead.leadQualityScoreUpdatedAt ?? null,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    }));

    // Create response object
    const responseObj = {
      success: true,
      leads: transformedLeads,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      totalLeads: total,
      todayLeadsCount,
    };

    console.log(
      "Response includes todayLeadsCount:",
      responseObj.hasOwnProperty("todayLeadsCount"),
      "with value:",
      responseObj.todayLeadsCount
    );

    res.status(200).json(responseObj);
  } catch (error) {
    console.error("Error fetching leads:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching leads",
      error: (error as Error).message,
    });
  }
});

/**
 * Get a single lead by ID with chat history
 * @route GET /api/leads/:id
 * @access Private
 */
export const getLeadById = asyncHandler(async (req: Request, res: Response) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    // Prefer ChatHistory collection by leadId, then by phone number, then fall back to embedded
    let chatDoc = await ChatHistory.findOne({ leadId: lead._id });
    if (!chatDoc && lead.leadPhoneNumber) {
      chatDoc = await ChatHistory.findOne({ leadPhoneNumber: lead.leadPhoneNumber });
    }
    const chatHistory = chatDoc ? chatDoc.messages : lead.chatHistory;

    res.status(200).json({
      success: true,
      lead: {
        ...lead.toObject(),
        id: lead._id,
        chatHistory,
      },
    });
  } catch (error) {
    console.error("Error fetching lead details:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching lead details",
      error: (error as Error).message,
    });
  }
});

// Helper: generate activity log entries by comparing old and new lead data
const generateActivityLogs = (
  oldLead: any,
  newData: any,
  author: { id: string; name: string }
) => {
  const logs: any[] = [];
  const now = new Date();

  const track = (field: string, label: string) => {
    const oldVal = oldLead[field] != null ? String(oldLead[field]) : "";
    const newVal = newData[field] != null ? String(newData[field]) : "";
    if (field in newData && oldVal !== newVal) {
      logs.push({
        action: newVal
          ? `${label} changed${oldVal ? ` from "${oldVal}"` : ""} to "${newVal}"`
          : `${label} cleared`,
        field,
        oldValue: oldVal || undefined,
        newValue: newVal || undefined,
        author,
        createdAt: now,
      });
    }
  };

  track("name", "Name");
  track("email", "Email");
  track("neetScore", "NEET Score");
  track("preferredCountry", "Preferred Country");
  track("city", "City");
  track("state", "State");
  track("status", "Status");
  track("stage", "Stage");
  track("qualification", "Qualification");
  track("neetYear", "NEET Year");
  track("targetYear", "Target Year");
  track("budget", "Budget");
  track("notes", "Notes");

  // Tags: compute added/removed
  if ("tags" in newData) {
    const oldTags: string[] = oldLead.tags || [];
    const newTags: string[] = newData.tags || [];
    const added = newTags.filter((t: string) => !oldTags.includes(t));
    const removed = oldTags.filter((t: string) => !newTags.includes(t));
    if (added.length || removed.length) {
      const parts: string[] = [];
      if (added.length) parts.push(`added: ${added.join(", ")}`);
      if (removed.length) parts.push(`removed: ${removed.join(", ")}`);
      logs.push({ action: `Tags updated (${parts.join(" · ")})`, field: "tags", author, createdAt: now });
    }
  }

  // AssignedTo
  if ("assignedTo" in newData) {
    const oldId = oldLead.assignedTo?.id;
    const newAssignee = newData.assignedTo;
    const newId = newAssignee?.id;
    if (oldId !== newId) {
      if (newId) {
        logs.push({
          action: `Assigned to ${newAssignee.name}`,
          field: "assignedTo",
          oldValue: oldLead.assignedTo?.name,
          newValue: newAssignee.name,
          author,
          createdAt: now,
        });
      } else {
        logs.push({
          action: `Unassigned${oldLead.assignedTo?.name ? ` (was ${oldLead.assignedTo.name})` : ""}`,
          field: "assignedTo",
          oldValue: oldLead.assignedTo?.name,
          author,
          createdAt: now,
        });
      }
    }
  }

  return logs;
};

/**
 * Update lead details
 * @route PUT /api/leads/:id
 * @access Private
 */
export const updateLead = asyncHandler(async (req: Request, res: Response) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const updateData = { ...req.body };

    // Strip fields that should never be overwritten via this endpoint
    delete updateData.remarks;
    delete updateData.activityLog;
    delete updateData.chatHistory;

    if (updateData.neetScore === "N/A") updateData.neetScore = null;

    // Resolve assignedTo to { id, name }
    if (updateData.assignedTo) {
      if (typeof updateData.assignedTo === "string") {
        const u = await User.findById(updateData.assignedTo);
        updateData.assignedTo = u ? { id: u._id.toString(), name: u.name } : undefined;
      } else if (typeof updateData.assignedTo === "object" && "id" in updateData.assignedTo && !updateData.assignedTo.name) {
        const u = await User.findById(updateData.assignedTo.id);
        updateData.assignedTo = u ? { id: u._id.toString(), name: u.name } : undefined;
      }
    }

    // Get current user for activity log authorship
    const requestUser = await User.findById((req as any).user?.id);
    const author = requestUser
      ? { id: requestUser._id.toString(), name: requestUser.name }
      : { id: "system", name: "System" };

    // Generate activity log entries for changed fields
    const newLogs = generateActivityLogs(lead.toObject(), updateData, author);

    // Track stage attribution when counselor changes it manually
    if ("stage" in updateData && updateData.stage !== (lead as any).stage) {
      updateData.stageUpdatedAt = new Date();
      updateData.stageUpdatedBy = "user";
    }

    // Apply updates to the lead document
    Object.assign(lead, updateData);
    if (newLogs.length) {
      (lead.activityLog as any[]).push(...newLogs);
    }

    const savedLead = await lead.save();

    res.status(200).json({
      success: true,
      lead: {
        id: savedLead._id,
        leadPhoneNumber: savedLead.leadPhoneNumber,
        businessPhoneNumber: savedLead.businessPhoneNumber,
        businessPhoneId: savedLead.businessPhoneId,
        name: savedLead.name || "Unknown",
        email: savedLead.email || null,
        preferredCountry: savedLead.preferredCountry || null,
        city: savedLead.city || null,
        state: savedLead.state || null,
        neetScore: savedLead.neetScore,
        qualification: (savedLead as any).qualification || null,
        neetYear: (savedLead as any).neetYear || null,
        targetYear: (savedLead as any).targetYear || null,
        budget: (savedLead as any).budget || null,
        assignedTo: savedLead.assignedTo || null,
        numberOfEnquiry: savedLead.numberOfEnquiry,
        numberOfChatsMessages: savedLead.numberOfChatsMessages,
        firstInteraction: savedLead.firstInteraction,
        lastInteraction: savedLead.lastInteraction,
        messageCount: savedLead.messageCount,
        status: savedLead.status,
        stage: (savedLead as any).stage || null,
        stageUpdatedBy: (savedLead as any).stageUpdatedBy || null,
        tags: savedLead.tags || [],
        aiTags: (savedLead as any).aiTags || [],
        source: savedLead.source || "WhatsApp",
        notes: savedLead.notes || null,
        sessions: savedLead.sessions || [],
        leadQualityScore: savedLead.leadQualityScore ?? null,
        leadQualityScoreReason: savedLead.leadQualityScoreReason ?? null,
        leadQualityScoreUpdatedAt: savedLead.leadQualityScoreUpdatedAt ?? null,
        remarks: (savedLead as any).remarks || [],
        activityLog: (savedLead as any).activityLog || [],
        createdAt: savedLead.createdAt,
        updatedAt: savedLead.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(500).json({ success: false, message: "Error updating lead", error: (error as Error).message });
  }
});

/**
 * Add a remark to a lead
 * @route POST /api/leads/:id/remarks
 * @access Private
 */
export const addRemark = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ success: false, message: "Remark text is required" });
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const requestUser = await User.findById((req as any).user?.id);
    if (!requestUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const remarkCreatedAt = new Date();
    const remark = {
      text: text.trim(),
      author: { id: requestUser._id.toString(), name: requestUser.name },
      createdAt: remarkCreatedAt,
    };

    (lead.remarks as any[]).push(remark);
    await lead.save();

    // Schedule AI stage evaluation — fires after STAGE_AI_DELAY_MS (default 60s)
    // If counselor manually updates stage before then, the job will skip AI
    const leadId = (lead._id as any).toString();
    if (!(lead as any).stage) {
      // No stage yet — evaluate immediately instead of waiting
      evaluateLeadStage(leadId, text.trim()).catch((err) =>
        console.error("[StageEval] Immediate eval error:", err)
      );
    } else {
      scheduleStageEval(leadId, remarkCreatedAt).catch((err) =>
        console.error("[StageEval] Schedule error:", err)
      );
    }

    // Return the remark with its generated _id
    const saved = (lead.remarks as any[])[(lead.remarks as any[]).length - 1];
    res.status(201).json({ success: true, remark: saved });
  } catch (error) {
    console.error("Error adding remark:", error);
    res.status(500).json({ success: false, message: "Error adding remark", error: (error as Error).message });
  }
});

/**
 * Get all users for assignedTo filter
 * @route GET /api/users
 * @access Private
 */
export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  try {
    const users = await User.find().select("_id name email");

    res.status(200).json({
      success: true,
      users,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching users",
      error: (error as Error).message,
    });
  }
});

/**
 * Delete a lead and all associated data
 * @route DELETE /api/leads/:id
 * @access Private — admin only (enforced in route middleware)
 */
export const deleteLead = asyncHandler(async (req: Request, res: Response) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    // Cancel any scheduled follow-up jobs
    await cancelFollowUp((lead._id as any).toString());

    // Delete associated chat history
    await ChatHistory.deleteMany({ leadId: lead._id });

    // Delete the lead itself
    await Lead.findByIdAndDelete(lead._id);

    res.status(200).json({ success: true, message: "Lead deleted" });
  } catch (error) {
    console.error("Error deleting lead:", error);
    res.status(500).json({ success: false, message: "Error deleting lead", error: (error as Error).message });
  }
});

/**
 * Dashboard stats — rich aggregated metrics for the dashboard
 * @route GET /api/leads/dashboard-stats
 * @access Private
 */
export const getDashboardStats = asyncHandler(async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [result] = await Lead.aggregate([
      {
        $facet: {
          avgQualityScore: [
            { $match: { leadQualityScore: { $exists: true, $ne: null } } },
            { $group: { _id: null, avg: { $avg: "$leadQualityScore" }, count: { $sum: 1 } } },
          ],
          unassigned: [
            { $match: { $or: [{ "assignedTo": null }, { "assignedTo": { $exists: false } }, { "assignedTo.id": { $exists: false } }] } },
            { $count: "count" },
          ],
          activeLastWeek: [
            { $match: { lastInteraction: { $gte: weekAgo } } },
            { $count: "count" },
          ],
          activeLastMonth: [
            { $match: { lastInteraction: { $gte: monthAgo } } },
            { $count: "count" },
          ],
          avgMessagesPerEngaged: [
            { $match: { messageCount: { $gt: 0 } } },
            { $group: { _id: null, avg: { $avg: "$messageCount" } } },
          ],
          avgNeetScore: [
            { $match: { neetScore: { $exists: true, $ne: null, $gt: 0 } } },
            { $group: { _id: null, avg: { $avg: "$neetScore" }, count: { $sum: 1 } } },
          ],
          topCountries: [
            { $match: { preferredCountry: { $exists: true, $nin: [null, ""] } } },
            { $group: { _id: "$preferredCountry", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 6 },
          ],
          qualificationBreakdown: [
            { $match: { qualification: { $exists: true, $ne: null } } },
            { $group: { _id: "$qualification", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          contactTypeBreakdown: [
            { $match: { contactType: { $exists: true, $nin: [null, "unknown"] } } },
            { $group: { _id: "$contactType", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          leadsWithBudget: [
            { $match: { budget: { $exists: true, $nin: [null, ""] } } },
            { $count: "count" },
          ],
          newThisWeek: [
            { $match: { createdAt: { $gte: weekAgo } } },
            { $count: "count" },
          ],
          newThisMonth: [
            { $match: { createdAt: { $gte: monthAgo } } },
            { $count: "count" },
          ],
        },
      },
    ]);

    const pick = (arr: any[], key = "count") => arr?.[0]?.[key] ?? 0;

    res.status(200).json({
      success: true,
      stats: {
        avgQualityScore: Math.round(pick(result.avgQualityScore, "avg") * 10) / 10,
        scoredLeads: pick(result.avgQualityScore, "count"),
        unassigned: pick(result.unassigned),
        activeLastWeek: pick(result.activeLastWeek),
        activeLastMonth: pick(result.activeLastMonth),
        avgMessagesPerEngaged: Math.round(pick(result.avgMessagesPerEngaged, "avg") * 10) / 10,
        avgNeetScore: Math.round(pick(result.avgNeetScore, "avg")),
        neetScoredLeads: pick(result.avgNeetScore, "count"),
        leadsWithBudget: pick(result.leadsWithBudget),
        newThisWeek: pick(result.newThisWeek),
        newThisMonth: pick(result.newThisMonth),
        topCountries: (result.topCountries ?? []).map((c: any) => ({ name: c._id, count: c.count })),
        qualificationBreakdown: (result.qualificationBreakdown ?? []).map((q: any) => ({ name: q._id, count: q.count })),
        contactTypeBreakdown: (result.contactTypeBreakdown ?? []).map((c: any) => ({ name: c._id, count: c.count })),
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res.status(500).json({ success: false, message: "Error fetching dashboard stats" });
  }
});

/**
 * Funnel stats — counts per stage + AI engagement metrics
 * @route GET /api/leads/funnel-stats
 * @access Private
 */
export const getFunnelStats = asyncHandler(async (req: Request, res: Response) => {
  try {
    const match: any = {};

    if (req.query.startDate || req.query.endDate) {
      match.createdAt = {};
      if (req.query.startDate) match.createdAt.$gte = new Date(req.query.startDate as string);
      if (req.query.endDate) {
        const d = new Date(req.query.endDate as string);
        d.setDate(d.getDate() + 1);
        match.createdAt.$lte = d;
      }
    }

    if (req.query.activeStartDate || req.query.activeEndDate) {
      match.lastInteraction = {};
      if (req.query.activeStartDate) match.lastInteraction.$gte = new Date(req.query.activeStartDate as string);
      if (req.query.activeEndDate) {
        const d = new Date(req.query.activeEndDate as string);
        d.setDate(d.getDate() + 1);
        match.lastInteraction.$lte = d;
      }
    }

    if (req.query.assignedTo) match["assignedTo.id"] = req.query.assignedTo as string;
    if (req.query.unassigned === "true") match["assignedTo"] = { $exists: false };

    const tags = req.query.tags;
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      if (tagArray.length > 0) match.tags = { $all: tagArray };
    }

    if (req.query.country) match.preferredCountry = new RegExp(req.query.country as string, "i");
    if (req.query.location) {
      const r = new RegExp(req.query.location as string, "i");
      match.$or = [{ city: r }, { state: r }];
    }

    const pipeline: any[] = [];
    if (Object.keys(match).length > 0) pipeline.push({ $match: match });

    const [result] = await Lead.aggregate([
      ...pipeline,
      {
        $facet: {
          total:            [{ $count: "count" }],
          aiEngaged:        [{ $match: { messageCount: { $gt: 0 } } }, { $count: "count" }],
          hot:              [{ $match: { leadQualityScore: { $gte: 70 } } }, { $count: "count" }],
          warm:             [{ $match: { leadQualityScore: { $gte: 40, $lt: 70 } } }, { $count: "count" }],
          cold:             [{ $match: { leadQualityScore: { $lt: 40, $ne: null } } }, { $count: "count" }],
          notResponding:    [{ $match: { stage: "not_responding" } }, { $count: "count" }],
          callStarted:      [{ $match: { stage: "call_started" } }, { $count: "count" }],
          followUp:         [{ $match: { stage: "follow_up" } }, { $count: "count" }],
          docsRequested:    [{ $match: { stage: "documents_requested" } }, { $count: "count" }],
          docsReceived:     [{ $match: { stage: "documents_received" } }, { $count: "count" }],
          applied:          [{ $match: { stage: "application_submitted" } }, { $count: "count" }],
          won:              [{ $match: { stage: "closed_won" } }, { $count: "count" }],
          lost:             [{ $match: { stage: "closed_lost" } }, { $count: "count" }],
        },
      },
    ]);

    const pick = (arr: { count: number }[]) => arr?.[0]?.count ?? 0;

    res.status(200).json({
      success: true,
      stats: {
        total:         pick(result.total),
        aiEngaged:     pick(result.aiEngaged),
        hot:           pick(result.hot),
        warm:          pick(result.warm),
        cold:          pick(result.cold),
        notResponding: pick(result.notResponding),
        callStarted:   pick(result.callStarted),
        followUp:      pick(result.followUp),
        docsRequested: pick(result.docsRequested),
        docsReceived:  pick(result.docsReceived),
        applied:       pick(result.applied),
        won:           pick(result.won),
        lost:          pick(result.lost),
      },
    });
  } catch (error) {
    console.error("Error fetching funnel stats:", error);
    res.status(500).json({ success: false, message: "Error fetching funnel stats" });
  }
});

/**
 * Create a new lead
 * @route POST /api/leads
 * @access Private
 */
export const createLead = asyncHandler(async (req: Request, res: Response) => {
  try {
    const {
      name,
      city,
      phoneNumber,
      neetStatus,
      source = "website",
    } = req.body;

    // Validate required fields
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    // Check if lead already exists with this phone number
    const existingLead = await Lead.findOne({ leadPhoneNumber: phoneNumber });
    if (existingLead) {
      return res.status(400).json({
        success: false,
        message: "Lead with this phone number already exists",
      });
    }

    // Create new lead
    const newLead = new Lead({
      leadPhoneNumber: phoneNumber,
      businessPhoneNumber: process.env.DEFAULT_BUSINESS_PHONE || "", // Set a default or get from env
      businessPhoneId: process.env.DEFAULT_BUSINESS_PHONE_ID || "", // Set a default or get from env
      name: name || "Unknown",
      city: city || null,
      source: source,
      numberOfEnquiry: 1,
      firstInteraction: new Date(),
      lastInteraction: new Date(),
    });

    const savedLead = await newLead.save();

    res.status(201).json({
      success: true,
      lead: savedLead,
    });
  } catch (error) {
    console.error("Error creating lead:", error);
    res.status(500).json({
      success: false,
      message: "Error creating lead",
      error: (error as Error).message,
    });
  }
});
