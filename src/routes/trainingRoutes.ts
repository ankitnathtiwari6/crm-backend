import { Router } from "express";
import { protect } from "../middleware/authMiddleware";
import {
  getCompanies,
  getLeadsForCompany,
  getChatWithSuggestions,
  saveSuggestion,
  deleteSuggestion,
  embedSuggestions,
  searchSimilar,
  getStats,
  generateSuggestedReply,
} from "../controllers/trainingController";

const router = Router();

router.use(protect);

router.get("/companies", getCompanies);
router.get("/companies/:companyId/leads", getLeadsForCompany);
router.get("/leads/:leadId/chat", getChatWithSuggestions);
router.post("/leads/:leadId/suggestions", saveSuggestion);
router.post("/leads/:leadId/generate-reply", generateSuggestedReply);
router.delete("/suggestions/:suggestionId", deleteSuggestion);
router.post("/embed", embedSuggestions);
router.post("/embed/:leadId", embedSuggestions);
router.get("/search", searchSimilar);
router.get("/stats", getStats);

export default router;
