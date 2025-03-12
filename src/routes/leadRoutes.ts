// routes/leadRoutes.ts
import express from "express";
import {
  getLeads,
  getLeadById,
  updateLead,
} from "../controllers/leadController";
import { protect } from "../middleware/authMiddleware";

const router = express.Router();

router.get("/", protect, getLeads);

router.get("/:id", protect, getLeadById);

router.put("/:id", protect, updateLead);

export default router;
