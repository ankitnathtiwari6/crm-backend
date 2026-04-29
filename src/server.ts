import express, { Express } from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import connectDB from "./config/db";
import { notFound, errorHandler } from "./middleware/errorMiddleware";

import whatsappWebhookRoutes from "./routes/whatsappWebhookRoutes";
import leadRoutes from "./routes/leadRoutes";
import authRoutes from "./routes/authRoutes";
import companyRoutes from "./routes/companyRoutes";
import trainingRoutes from "./routes/trainingRoutes";
import agenda from "./jobs/agenda";
import {
  defineFollowUpJob,
  purgeOrphanedFollowUpJobs,
} from "./jobs/followUpJob";
import { defineStageEvalJob } from "./jobs/stageEvalJob";
// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

// Initialize Express
const app: Express = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: [
      "https://ankitnathtiwari6.github.io",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3000",
    ],
    credentials: true,
  }),
);
app.use(helmet());

// Logging in development environment
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Routes
app.use("/api/webhook", whatsappWebhookRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/training", trainingRoutes);

// Start Agenda job scheduler
defineFollowUpJob();
defineStageEvalJob();
agenda.start().then(async () => {
  console.log("Agenda scheduler started");
  await purgeOrphanedFollowUpJobs();
});

// Basic route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// Health check endpoint
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Handle unhandled promise rejections — log but do NOT exit (crashing kills all active connections)
process.on("unhandledRejection", (err: Error) => {
  console.error(`Unhandled rejection: ${err?.message ?? err}`);
});
