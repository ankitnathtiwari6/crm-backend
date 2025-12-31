// controllers/authController.ts
import { Request, Response } from "express";
import User, { IUser } from "../models/User";
import asyncHandler from "../utils/asyncHandler";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

/**
 * Register a new user
 * @route POST /api/auth/register
 * @access Public
 */
export const registerUser = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const { name, email, password } = req.body;

      const userExists = await User.findOne({ email });
      if (userExists) {
        return res.status(400).json({
          success: false,
          message: "User with this email already exists",
        });
      }

      // Create new user
      const user = await User.create({
        name,
        email,
        password,
      });

      // Generate token
      const token = generateToken(user._id);

      res.status(201).json({
        success: true,
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
        },
        token,
      });
    } catch (error) {
      console.error("Error registering user:", error);
      res.status(500).json({
        success: false,
        message: "Error registering user",
        error: (error as Error).message,
      });
    }
  }
);

/**
 * Login user
 * @route POST /api/auth/login
 * @access Public
 */
export const loginUser = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const authEmails = [
      "ankitnathtiwari@gmail.com",
      "imarpitjaiswal@gmail.com",
      "priyamishra7.p@gmail.com",
      "meenarai310@gmail.com",
    ];

    // Check required fields
    if (!email || !password || !authEmails.includes(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password",
      });
    }

    // Find user and include password for verification
    const user = await User.findOne({ email }).select("+password");

    // Check if user exists
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Generate token
    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
      },
      token,
    });
  } catch (error) {
    console.error("Error logging in user:", error);
    res.status(500).json({
      success: false,
      message: "Error logging in user",
      error: (error as Error).message,
    });
  }
});

/**
 * Get current user profile
 * @route GET /api/auth/me
 * @access Private
 */
export const getCurrentUser = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      console.log("get current user");
      // The user object is attached to the request by the auth middleware
      const user = await User.findById((req as any).user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.status(200).json({
        success: true,
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
        },
      });
    } catch (error) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching user profile",
        error: (error as Error).message,
      });
    }
  }
);

// Helper function to generate JWT token
const generateToken = (userId: mongoose.Types.ObjectId): string => {
  const jwtSecret = process.env.JWT_SECRET || "defaultsecret";

  return jwt.sign({ id: userId.toString() }, jwtSecret, {
    expiresIn: "30d",
  });
};
