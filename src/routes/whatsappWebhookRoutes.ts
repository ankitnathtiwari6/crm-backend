import express from "express";
import {
  verifyWebhook,
  processWebhook,
} from "../controllers/whatsappWebhookController";

const router = express.Router();

router.get("/", verifyWebhook);

router.post("/", processWebhook);

export default router;
