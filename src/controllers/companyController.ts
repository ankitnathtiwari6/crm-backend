import { Request, Response } from "express";
import asyncHandler from "../utils/asyncHandler";
import Company from "../models/Company";
import User from "../models/User";

/**
 * Create a new company
 * POST /api/companies
 */
export const createCompany = asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body;
  const userId = (req as any).user.id;

  if (!name) {
    return res.status(400).json({ success: false, message: "Company name is required" });
  }

  const company = await Company.create({
    name,
    users: [{ userId, role: "admin" }],
  });

  // Attach companyId + admin role to the creating user
  await User.findByIdAndUpdate(userId, { companyId: company._id, role: "admin" });

  res.status(201).json({ success: true, company });
});

/**
 * Get company by ID (or the user's own company)
 * GET /api/companies/:id
 */
export const getCompany = asyncHandler(async (req: Request, res: Response) => {
  const company = await Company.findById(req.params.id).populate(
    "users.userId",
    "name email role"
  );

  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found" });
  }

  res.status(200).json({ success: true, company });
});

/**
 * Update company settings (name, aiEnabled, language)
 * PUT /api/companies/:id
 */
export const updateCompany = asyncHandler(async (req: Request, res: Response) => {
  const { name, settings, tags } = req.body;

  const company = await Company.findById(req.params.id);
  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found" });
  }

  if (name) company.name = name;
  if (settings?.aiEnabled !== undefined) company.settings.aiEnabled = settings.aiEnabled;
  if (settings?.ragEnabled !== undefined) company.settings.ragEnabled = settings.ragEnabled;
  if (settings?.language) company.settings.language = settings.language;
  if (Array.isArray(tags)) company.tags = tags;

  await company.save();
  res.status(200).json({ success: true, company });
});

/**
 * Add a user to the company
 * POST /api/companies/:id/users
 */
export const addUserToCompany = asyncHandler(async (req: Request, res: Response) => {
  const { email, role = "member" } = req.body;

  const company = await Company.findById(req.params.id);
  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found" });
  }

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const alreadyMember = company.users.some(
    (u) => u.userId.toString() === user._id.toString()
  );
  if (alreadyMember) {
    return res.status(400).json({ success: false, message: "User already in company" });
  }

  company.users.push({ userId: user._id, role });
  await company.save();

  await User.findByIdAndUpdate(user._id, { companyId: company._id, role });

  res.status(200).json({ success: true, company });
});

/**
 * Remove a user from the company
 * DELETE /api/companies/:id/users/:userId
 */
export const removeUserFromCompany = asyncHandler(async (req: Request, res: Response) => {
  const company = await Company.findById(req.params.id);
  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found" });
  }

  company.users = company.users.filter(
    (u) => u.userId.toString() !== req.params.userId
  );
  await company.save();

  await User.findByIdAndUpdate(req.params.userId, {
    $unset: { companyId: "" },
    role: "member",
  });

  res.status(200).json({ success: true, company });
});

/**
 * Add a WhatsApp number to the company
 * POST /api/companies/:id/whatsapp
 */
export const addWhatsappNumber = asyncHandler(async (req: Request, res: Response) => {
  const { phoneNumberId, displayPhoneNumber, accessToken, verifyToken } = req.body;

  if (!phoneNumberId || !displayPhoneNumber || !accessToken || !verifyToken) {
    return res.status(400).json({ success: false, message: "All WhatsApp fields are required" });
  }

  const company = await Company.findById(req.params.id);
  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found" });
  }

  company.whatsappNumbers.push({
    phoneNumberId,
    displayPhoneNumber,
    accessToken,
    verifyToken,
    isActive: true,
  });
  await company.save();

  res.status(200).json({ success: true, company });
});

/**
 * Remove a WhatsApp number from the company
 * DELETE /api/companies/:id/whatsapp/:phoneNumberId
 */
export const removeWhatsappNumber = asyncHandler(async (req: Request, res: Response) => {
  const company = await Company.findById(req.params.id);
  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found" });
  }

  company.whatsappNumbers = company.whatsappNumbers.filter(
    (n) => n.phoneNumberId !== req.params.phoneNumberId
  );
  await company.save();

  res.status(200).json({ success: true, company });
});

/**
 * Toggle WhatsApp number active status
 * PATCH /api/companies/:id/whatsapp/:phoneNumberId/toggle
 */
export const toggleWhatsappNumber = asyncHandler(async (req: Request, res: Response) => {
  const company = await Company.findById(req.params.id);
  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found" });
  }

  const number = company.whatsappNumbers.find(
    (n) => n.phoneNumberId === req.params.phoneNumberId
  );
  if (!number) {
    return res.status(404).json({ success: false, message: "WhatsApp number not found" });
  }

  number.isActive = !number.isActive;
  await company.save();

  res.status(200).json({ success: true, company });
});
