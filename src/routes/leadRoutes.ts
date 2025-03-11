// routes/leadRoutes.ts
import express from "express";
import {
  getLeads,
  getLeadById,
  updateLead,
} from "../controllers/leadController";
import { protect } from "../middleware/authMiddleware";

const router = express.Router();

// Apply authentication middleware to all routes if needed
// router.use(protect);

// GET /api/leads - Get all leads with pagination and filtering
router.get("/", protect, getLeads);

// GET /api/leads/:id - Get a single lead by ID
router.get("/:id", protect, getLeadById);

// PUT /api/leads/:id - Update lead details
router.put("/:id", protect, updateLead);

export default router;
