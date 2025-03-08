// controllers/leadController.ts
import { Request, Response } from "express";
import Lead from "../models/Lead";
import asyncHandler from "../utils/asyncHandler";

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

    // Count total documents for pagination
    const total = await Lead.countDocuments(filter);

    // Fetch leads with pagination and sorting
    const leads = await Lead.find(filter)
      .sort({ lastInteraction: -1 }) // Sort by most recent interaction
      .skip(skip)
      .limit(limit)
      .select("-chatHistory"); // Exclude chat history to reduce payload size

    // Transform data to match the frontend expectations
    const transformedLeads = leads.map((lead) => ({
      id: lead._id,
      name: lead.name || "Unknown",
      leadPhoneNumber: lead.leadPhoneNumber,
      email: lead.email || "Not provided",
      preferredCountry: lead.preferredCountry || "Not specified",
      city: lead.city
        ? `${lead.city}${lead.state ? `, ${lead.state}` : ""}`
        : lead.state || "Not specified",
      neetScore: lead.neetScore || "N/A",
      numberOfEnquiry: lead.numberOfEnquiry,
      numberOfChatsMessages: lead.numberOfChatsMessages,
      lastInteraction: lead.lastInteraction,
      status: lead.status,
      source: lead.source || "WhatsApp",
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

    // Update only the fields that are provided
    const updatedLead = await Lead.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
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
