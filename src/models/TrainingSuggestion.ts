import mongoose, { Document, Schema } from "mongoose";

export interface IContextMessage {
  messageId: string;
  content: string;
  role: "lead" | "assistant";
  timestamp: Date;
}

export interface ITrainingSuggestion extends Document {
  leadId: mongoose.Types.ObjectId;
  companyId: mongoose.Types.ObjectId;
  leadPhoneNumber: string;
  messageId: string;
  conversationContext: IContextMessage[];
  originalAiReply: string;
  suggestedReply: string;
  isEmbedded: boolean;
  pineconeId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ContextMessageSchema = new Schema<IContextMessage>(
  {
    messageId: { type: String, required: true },
    content: { type: String, required: true },
    role: { type: String, enum: ["lead", "assistant"], required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const TrainingSuggestionSchema = new Schema<ITrainingSuggestion>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    leadPhoneNumber: { type: String, required: true },
    messageId: { type: String, required: true },
    conversationContext: [ContextMessageSchema],
    originalAiReply: { type: String, required: true },
    suggestedReply: { type: String, required: true },
    isEmbedded: { type: Boolean, default: false },
    pineconeId: { type: String },
  },
  { timestamps: true }
);

TrainingSuggestionSchema.index({ leadId: 1, messageId: 1 }, { unique: true });

export default mongoose.model<ITrainingSuggestion>(
  "TrainingSuggestion",
  TrainingSuggestionSchema
);
