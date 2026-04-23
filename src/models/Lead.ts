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

// Define the AssignedTo interface
interface IAssignedTo {
  id: string;
  name: string;
}

// Define the AssignedTo schema
const AssignedToSchema: Schema = new Schema({
  id: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
});

// Define the Session interface
export interface ISession {
  sessionId: string;
  startedAt: Date;
  messageCount: number;
  status: "active" | "complete" | "expired" | "no_reply";
}

// Define the Session schema
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

// Define the Lead document interface
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
  assignedTo?: IAssignedTo;
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
  // Follow-up sequence tracking
  followUpStep?: number;
  followUpJobId?: string;
  followUpStartedAt?: Date;
  // Session tracking
  sessions: ISession[];
  // Lead quality score (0 = junk/no engagement, 100 = hot/ready to convert)
  leadQualityScore?: number;
  leadQualityScoreReason?: string;
  leadQualityScoreUpdatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Define the Lead schema
const LeadSchema: Schema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    leadPhoneNumber: {
      type: String,
      required: true,
      index: true,
    },
    businessPhoneNumber: {
      type: String,
      index: true,
    },
    businessPhoneId: {
      type: String,
    },
    contactType: {
      type: String,
      enum: ["student", "father", "mother", "brother", "sister", "guardian", "friend", "unknown"],
      default: "unknown",
    },
    name: {
      type: String,
    },
    studentName: {
      type: String,
    },
    email: {
      type: String,
    },
    preferredCountry: {
      type: String,
    },
    preferredCollege: {
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
      default: null,
    },
    neetYear: {
      type: Number,
    },
    qualification: {
      type: String,
      enum: ["12th_appearing", "12th_passed", "dropper", "other"],
    },
    targetYear: {
      type: Number,
    },
    budget: {
      type: String,
    },
    assignedTo: {
      id: {
        type: String,
      },
      name: {
        type: String,
      },
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
    followUpStep: { type: Number },
    followUpJobId: { type: String },
    followUpStartedAt: { type: Date },
    sessions: { type: [SessionSchema], default: [] },
    leadQualityScore: { type: Number, min: 0, max: 100 },
    leadQualityScoreReason: { type: String },
    leadQualityScoreUpdatedAt: { type: Date },
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
