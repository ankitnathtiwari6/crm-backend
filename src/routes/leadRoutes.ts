// routes/leadRoutes.ts
import express from "express";
import {
  getLeads,
  getLeadById,
  updateLead,
  createLead,
  addRemark,
} from "../controllers/leadController";
import { protect } from "../middleware/authMiddleware";

const router = express.Router();

router.get("/", protect, getLeads);

router.get("/:id", protect, getLeadById);

router.put("/:id", protect, updateLead);

router.post("/:id/remarks", protect, addRemark);

router.post("/", createLead);

export default router;
