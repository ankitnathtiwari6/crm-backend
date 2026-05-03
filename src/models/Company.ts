import mongoose, { Document, Schema } from "mongoose";

interface IWhatsappNumber {
  phoneNumberId: string;
  displayPhoneNumber: string;
  accessToken: string;
  verifyToken: string;
  isActive: boolean;
}

interface ICompanyUser {
  userId: mongoose.Types.ObjectId;
  role: "admin" | "member";
}

export interface ICompany extends Document {
  name: string;
  users: ICompanyUser[];
  whatsappNumbers: IWhatsappNumber[];
  tags: string[];
  settings: {
    aiEnabled: boolean;
    ragEnabled: boolean;
    language: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const WhatsappNumberSchema = new Schema<IWhatsappNumber>({
  phoneNumberId: { type: String, required: true },
  displayPhoneNumber: { type: String, required: true },
  accessToken: { type: String, required: true },
  verifyToken: { type: String, required: true },
  isActive: { type: Boolean, default: true },
});

const CompanyUserSchema = new Schema<ICompanyUser>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  role: { type: String, enum: ["admin", "member"], default: "member" },
});

const CompanySchema = new Schema<ICompany>(
  {
    name: { type: String, required: true, trim: true },
    users: [CompanyUserSchema],
    whatsappNumbers: [WhatsappNumberSchema],
    tags: { type: [String], default: [] },
    settings: {
      aiEnabled: { type: Boolean, default: true },
      ragEnabled: { type: Boolean, default: true },
      language: { type: String, default: "en" },
    },
  },
  { timestamps: true }
);

export default mongoose.model<ICompany>("Company", CompanySchema);
