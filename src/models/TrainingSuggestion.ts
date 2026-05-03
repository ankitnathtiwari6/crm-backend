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
  // RAG training fields — each maps to one line/section in the embed text
  situation: string;          // "Situation: ..."
  stage: string;              // "Mid-stage: NEET score and city known, no country selected."
  userIntent: string;             // "Intent: ..."
  constraints: string;        // "Constraints: ..."
  signals: string;            // "Signals: ..."
  preferredCountries: string[]; // Countries explicitly mentioned in conversation
  strategy: string[];           // Metadata only — injected at agent match time
  antiPatterns: string[];     // Metadata only — injected at agent match time
  embeddingStatus: "pending_review" | "embedded";
  confirmedBy?: string;
  confirmedAt?: Date;
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
    // RAG training fields
    situation: { type: String, default: "" },
    stage: { type: String, default: "" },
    userIntent: { type: String, default: "" },
    constraints: { type: String, default: "" },
    signals: { type: String, default: "" },
    preferredCountries: { type: [String], default: [] },
    strategy: { type: [String], default: [] },
    antiPatterns: { type: [String], default: [] },
    embeddingStatus: {
      type: String,
      enum: ["pending_review", "embedded"],
      default: "pending_review",
    },
    confirmedBy: { type: String },
    confirmedAt: { type: Date },
  },
  { timestamps: true }
);

TrainingSuggestionSchema.index({ leadId: 1, messageId: 1 }, { unique: true });

export default mongoose.model<ITrainingSuggestion>(
  "TrainingSuggestion",
  TrainingSuggestionSchema
);
