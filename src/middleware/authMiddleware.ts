// middleware/authMiddleware.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";
import asyncHandler from "../utils/asyncHandler";

interface JwtPayload {
  id: string;
}

// Middleware to protect routes
export const protect = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    let token;
    console.log(token);
    // Check if token exists in headers
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      // Extract token from header
      token = req.headers.authorization.split(" ")[1];
    }

    // Check if token exists
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, no token provided",
      });
    }

    try {
      // Verify token using environment variable with fallback
      if (!process.env.JWT_SECRET) {
        console.warn(
          "JWT_SECRET is not set. Using default secret (not secure for production)"
        );
      }

      // Use Buffer for the secret to meet type requirements
      const jwtSecret = Buffer.from(process.env.JWT_SECRET || "defaultsecret");
      const decoded = jwt.verify(token, jwtSecret) as JwtPayload;

      // Attach user to request object
      const user = await User.findById(decoded.id);

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Not authorized, user not found",
        });
      }

      // Add user to request object
      (req as any).user = {
        id: user._id.toString(),
      };

      next();
    } catch (error) {
      console.error("Authentication error:", error);
      return res.status(401).json({
        success: false,
        message: "Not authorized, token invalid",
      });
    }
  }
);

// Optional: Add role-based authorization middleware
export const authorize = (...roles: string[]) => {
  return asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
      // Get user from the protected route middleware
      const user = await User.findById((req as any).user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if user has required role
      // Note: You'll need to add a 'role' field to your User model
      if (roles.length && !roles.includes((user as any).role)) {
        return res.status(403).json({
          success: false,
          message: `User role ${(user as any).role} is not authorized to access this route`,
        });
      }

      next();
    }
  );
};
