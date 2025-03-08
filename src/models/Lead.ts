// models/Lead.ts
import mongoose, { Document, Schema } from "mongoose";

// Define the Message interface
interface IMessage {
  messageId: string;
  content: string;
  role: "lead" | "assistant";
  timestamp: Date;
  status?: "sent" | "delivered" | "read" | "failed";
}

// Define the Message schema
const MessageSchema: Schema = new Schema({
  messageId: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ["lead", "assistant"],
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ["sent", "delivered", "read", "failed"],
  },
});

// Define the Lead document interface
export interface ILead extends Document {
  leadPhoneNumber: string;
  businessPhoneNumber: string;
  businessPhoneId: string;
  name?: string;
  email?: string;
  preferredCountry?: string;
  city?: string;
  state?: string;
  neetScore?: number;
  numberOfEnquiry: number;
  numberOfChatsMessages: number;
  firstInteraction: Date;
  lastInteraction: Date;
  messageCount: number;
  status: "active" | "inactive" | "archived";
  tags?: string[];
  source?: string;
  notes?: string;
  chatHistory: IMessage[];
  createdAt: Date;
  updatedAt: Date;
}

// Define the Lead schema
const LeadSchema: Schema = new Schema(
  {
    leadPhoneNumber: {
      type: String,
      required: true,
      index: true,
    },
    businessPhoneNumber: {
      type: String,
      required: true,
      index: true,
    },
    businessPhoneId: {
      type: String,
      required: true,
    },
    name: {
      type: String,
    },
    email: {
      type: String,
    },
    preferredCountry: {
      type: String,
    },
    city: {
      type: String,
    },
    state: {
      type: String,
    },
    neetScore: {
      type: Number,
    },
    numberOfEnquiry: {
      type: Number,
      default: 0,
    },
    numberOfChatsMessages: {
      type: Number,
      default: 0,
    },
    firstInteraction: {
      type: Date,
      default: Date.now,
    },
    lastInteraction: {
      type: Date,
      default: Date.now,
    },
    messageCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "archived"],
      default: "active",
    },
    tags: [String],
    source: {
      type: String,
    },
    notes: {
      type: String,
    },
    chatHistory: [MessageSchema],
  },
  {
    timestamps: true,
  }
);

// Create a compound index for leadPhoneNumber and businessPhoneNumber
LeadSchema.index(
  { leadPhoneNumber: 1, businessPhoneNumber: 1 },
  { unique: true }
);

// Export the Lead model
export default mongoose.model<ILead>("Lead", LeadSchema);
