// controllers/leadController.ts
import { Request, Response } from "express";
import Lead from "../models/Lead";
import asyncHandler from "../utils/asyncHandler";
import User from "../models/User";

/**
 * Get leads with pagination and filtering
 * @route GET /api/leads
 * @access Private
 */
export const getLeads = asyncHandler(async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Build filter object based on query parameters
    const filter: any = {};

    // Search functionality
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search as string, "i");
      filter.$or = [
        { leadPhoneNumber: searchRegex },
        { name: searchRegex },
        { email: searchRegex },
      ];
    }

    // NEET score filtering
    if (req.query.neetStatus) {
      if (req.query.neetStatus === "withScore") {
        filter.neetScore = { $exists: true, $ne: null };
      } else if (req.query.neetStatus === "withoutScore") {
        filter.neetScore = { $exists: false };
      }
    }

    // NEET score range filtering
    if (req.query.minScore && req.query.maxScore) {
      filter.neetScore = {
        $gte: parseInt(req.query.minScore as string),
        $lte: parseInt(req.query.maxScore as string),
      };
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

    // Tags filtering
    const tags = req.query.tags;
    if (tags) {
      // If tags is an array (multiple tags selected)
      if (Array.isArray(tags) && tags.length > 0) {
        filter.tags = { $all: tags }; // Match leads that have ALL the specified tags
      }
      // If tags is a single string
      else if (typeof tags === "string") {
        filter.tags = tags;
      }
    }

    // Qualified leads (can be customized based on your definition of qualified)
    if (req.query.isQualified === "true") {
      filter.$and = [
        { neetScore: { $exists: true, $ne: null } },
        { neetScore: { $gte: 500 } }, // Example threshold
      ];
    }

    // Date range filtering
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};

      if (req.query.startDate) {
        filter.createdAt.$gte = new Date(req.query.startDate as string);
      }

      if (req.query.endDate) {
        // Add one day to include the end date fully
        const endDate = new Date(req.query.endDate as string);
        endDate.setDate(endDate.getDate() + 1);
        filter.createdAt.$lte = endDate;
      }
    }

    // Status filtering
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // Count total documents for pagination
    const total = await Lead.countDocuments(filter);

    // Fetch leads with pagination and sorting
    const leads = await Lead.find(filter)
      .sort({ lastInteraction: -1 }) // Sort by most recent interaction
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
      tags: lead.tags || [],
      source: lead.source || "WhatsApp",
      notes: lead.notes || null,
      chatHistory: lead.chatHistory || [], // Include chat history in the response
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    }));

    res.status(200).json({
      success: true,
      leads: transformedLeads,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      totalLeads: total,
    });
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

    res.status(200).json({
      success: true,
      lead,
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

/**
 * Update lead details
 * @route PUT /api/leads/:id
 * @access Private
 */
export const updateLead = asyncHandler(async (req: Request, res: Response) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    const updateData = { ...req.body };

    // Handle 'N/A' for neetScore - convert to null or remove the field
    if (updateData.neetScore === "N/A") {
      updateData.neetScore = null;
    }

    // Handle assignedTo
    if (updateData.assignedTo) {
      // If assignedTo is a string (just an ID)
      if (typeof updateData.assignedTo === "string") {
        const user = await User.findById(updateData.assignedTo);
        if (user) {
          updateData.assignedTo = {
            id: user._id.toString(),
            name: user.name,
          };
        } else {
          // If user not found, remove the assignedTo field
          delete updateData.assignedTo;
        }
      }
      // If assignedTo is an object with just an id property
      else if (
        typeof updateData.assignedTo === "object" &&
        "id" in updateData.assignedTo &&
        !updateData.assignedTo.name
      ) {
        const user = await User.findById(updateData.assignedTo.id);
        if (user) {
          updateData.assignedTo = {
            id: user._id.toString(),
            name: user.name,
          };
        } else {
          // If user not found, remove the assignedTo field
          delete updateData.assignedTo;
        }
      }
      // If it's already a complete object with id and name, keep it as is
    }

    // Update only the fields that are provided
    const updatedLead = await Lead.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      lead: updatedLead,
    });
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(500).json({
      success: false,
      message: "Error updating lead",
      error: (error as Error).message,
    });
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
