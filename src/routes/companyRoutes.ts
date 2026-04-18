import express from "express";
import {
  createCompany,
  getCompany,
  updateCompany,
  addUserToCompany,
  removeUserFromCompany,
  addWhatsappNumber,
  removeWhatsappNumber,
  toggleWhatsappNumber,
} from "../controllers/companyController";
import { protect } from "../middleware/authMiddleware";

const router = express.Router();

router.post("/", protect, createCompany);
router.get("/:id", protect, getCompany);
router.put("/:id", protect, updateCompany);

router.post("/:id/users", protect, addUserToCompany);
router.delete("/:id/users/:userId", protect, removeUserFromCompany);

router.post("/:id/whatsapp", protect, addWhatsappNumber);
router.delete("/:id/whatsapp/:phoneNumberId", protect, removeWhatsappNumber);
router.patch("/:id/whatsapp/:phoneNumberId/toggle", protect, toggleWhatsappNumber);

export default router;
