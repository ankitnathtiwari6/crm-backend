// routes/leadRoutes.ts
import express from "express";
import {
  getLeads,
  getLeadById,
  updateLead,
  deleteLead,
  createLead,
  addRemark,
  getFunnelStats,
  getDashboardStats,
} from "../controllers/leadController";
import { protect } from "../middleware/authMiddleware";

const router = express.Router();

router.get("/", protect, getLeads);

// Must be before /:id to avoid string routes being matched as an id
router.get("/funnel-stats", protect, getFunnelStats);
router.get("/dashboard-stats", protect, getDashboardStats);

router.get("/:id", protect, getLeadById);

router.put("/:id", protect, updateLead);
router.delete("/:id", protect, deleteLead);

router.post("/:id/remarks", protect, addRemark);

router.post("/", createLead);

export default router;
