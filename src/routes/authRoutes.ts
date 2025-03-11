// routes/authRoutes.ts
import express from "express";
import {
  registerUser,
  loginUser,
  getCurrentUser,
} from "../controllers/authController";
import { protect } from "../middleware/authMiddleware";

const router = express.Router();

// POST /api/auth/register - Register a new user
router.post("/register", registerUser);

// POST /api/auth/login - Login user
router.post("/login", loginUser);
router.get("/user", protect, getCurrentUser);

export default router;
