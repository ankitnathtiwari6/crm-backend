import mongoose, { Document, Schema } from "mongoose";

interface IMessage {
  messageId: string;
  content: string;
  role: "lead" | "assistant";
  timestamp: Date;
  status?: "sent" | "delivered" | "read" | "failed";
}

const MessageSchema: Schema = new Schema({
  messageId: { type: String, required: true },
  content: { type: String, required: true },
  role: { type: String, enum: ["lead", "assistant"], required: true },
  timestamp: { type: Date, default: Date.now },
  status: { type: String, enum: ["sent", "delivered", "read", "failed"] },
});

interface IAssignedTo {
  id: string;
  name: string;
}


export interface ISession {
  sessionId: string;
  startedAt: Date;
  messageCount: number;
  status: "active" | "complete" | "expired" | "no_reply";
}

const SessionSchema: Schema = new Schema({
  sessionId: { type: String, required: true },
  startedAt: { type: Date, default: Date.now },
  messageCount: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ["active", "complete", "expired", "no_reply"],
    default: "active",
  },
});

// Remark: manual note added by a user
export interface IRemark {
  text: string;
  author: { id: string; name: string };
  createdAt: Date;
}

const RemarkSchema: Schema = new Schema({
  text: { type: String, required: true },
  author: {
    id: { type: String, required: true },
    name: { type: String, required: true },
  },
  createdAt: { type: Date, default: Date.now },
});

// Activity log: auto-generated entry when lead fields change
export interface IActivityLog {
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  author?: { id: string; name: string };
  createdAt: Date;
}

const ActivityLogSchema: Schema = new Schema({
  action: { type: String, required: true },
  field: { type: String },
  oldValue: { type: String },
  newValue: { type: String },
  author: {
    id: { type: String },
    name: { type: String },
  },
  createdAt: { type: Date, default: Date.now },
});

export interface ILead extends Document {
  companyId?: mongoose.Types.ObjectId;
  leadPhoneNumber: string;
  businessPhoneNumber?: string;
  businessPhoneId?: string;
  contactType?: "student" | "father" | "mother" | "brother" | "sister" | "guardian" | "friend" | "unknown";
  name?: string;
  studentName?: string;
  email?: string;
  preferredCountry?: string;
  preferredCollege?: string;
  city?: string;
  state?: string;
  neetScore?: number | null;
  neetYear?: number;
  qualification?: "12th_appearing" | "12th_passed" | "dropper" | "other";
  targetYear?: number;
  budget?: string;
  stage?: string;
  stageUpdatedAt?: Date;
  stageUpdatedBy?: "ai" | "user";
  assignedTo?: IAssignedTo;
  numberOfEnquiry: number;
  numberOfChatsMessages: number;
  firstInteraction: Date;
  lastInteraction: Date;
  messageCount: number;
  status: "active" | "inactive" | "archived";
  tags?: string[];
  aiTags?: string[];
  source?: string;
  notes?: string;
  chatHistory: IMessage[];
  followUpStep?: number;
  followUpJobId?: string;
  followUpStartedAt?: Date;
  sessions: ISession[];
  leadQualityScore?: number;
  leadQualityScoreReason?: string;
  leadQualityScoreUpdatedAt?: Date;
  aiBlocked?: boolean;
  aiBlockedAt?: Date;
  aiBlockReason?: string;
  remarks: IRemark[];
  activityLog: IActivityLog[];
  createdAt: Date;
  updatedAt: Date;
}

const LeadSchema: Schema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", index: true },
    leadPhoneNumber: { type: String, required: true, index: true },
    businessPhoneNumber: { type: String, index: true },
    businessPhoneId: { type: String },
    contactType: {
      type: String,
      enum: ["student", "father", "mother", "brother", "sister", "guardian", "friend", "unknown"],
      default: "unknown",
    },
    name: { type: String },
    studentName: { type: String },
    email: { type: String },
    preferredCountry: { type: String },
    preferredCollege: { type: String },
    city: { type: String },
    state: { type: String },
    neetScore: { type: Number, default: null },
    neetYear: { type: Number },
    qualification: {
      type: String,
      enum: ["12th_appearing", "12th_passed", "dropper", "other"],
    },
    targetYear: { type: Number },
    budget: { type: String },
    stage: {
      type: String,
      enum: ["not_responding", "call_started", "follow_up", "documents_requested", "documents_received", "application_submitted", "closed_won", "closed_lost"],
    },
    stageUpdatedAt: { type: Date },
    stageUpdatedBy: { type: String, enum: ["ai", "user"] },
    assignedTo: {
      id: { type: String },
      name: { type: String },
    },
    numberOfEnquiry: { type: Number, default: 0 },
    numberOfChatsMessages: { type: Number, default: 0 },
    firstInteraction: { type: Date, default: Date.now },
    lastInteraction: { type: Date, default: Date.now },
    messageCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["active", "inactive", "archived"],
      default: "active",
    },
    tags: [String],
    aiTags: [String],
    source: { type: String },
    notes: { type: String },
    chatHistory: [MessageSchema],
    followUpStep: { type: Number },
    followUpJobId: { type: String },
    followUpStartedAt: { type: Date },
    sessions: { type: [SessionSchema], default: [] },
    leadQualityScore: { type: Number, min: 0, max: 100 },
    leadQualityScoreReason: { type: String },
    leadQualityScoreUpdatedAt: { type: Date },
    aiBlocked: { type: Boolean, default: false },
    aiBlockedAt: { type: Date },
    aiBlockReason: { type: String },
    remarks: { type: [RemarkSchema], default: [] },
    activityLog: { type: [ActivityLogSchema], default: [] },
  },
  { timestamps: true }
);

LeadSchema.index({ leadPhoneNumber: 1, businessPhoneNumber: 1 }, { unique: true });

export default mongoose.model<ILead>("Lead", LeadSchema);
