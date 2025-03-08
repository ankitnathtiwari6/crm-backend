// models/ChatHistory.ts
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

// Define the ChatHistory document interface
export interface IChatHistory extends Document {
  leadPhoneNumber: string;
  businessPhoneNumber: string;
  messages: IMessage[];
  createdAt: Date;
  updatedAt: Date;
}

// Define the ChatHistory schema
const ChatHistorySchema: Schema = new Schema(
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
    messages: [MessageSchema],
  },
  {
    timestamps: true,
  }
);

// Create a compound index for leadPhoneNumber and businessPhoneNumber
ChatHistorySchema.index(
  { leadPhoneNumber: 1, businessPhoneNumber: 1 },
  { unique: true }
);

// Export the ChatHistory model
export default mongoose.model<IChatHistory>("ChatHistory", ChatHistorySchema);
