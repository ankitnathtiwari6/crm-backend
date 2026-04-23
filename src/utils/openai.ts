import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

let client: OpenAI | null = null;

const getClient = (): OpenAI => {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeadContext {
  contactType?: string;
  name?: string;
  studentName?: string;
  city?: string;
  state?: string;
  preferredCountry?: string;
  preferredCollege?: string;
  neetScore?: number | null;
  neetYear?: number;
  qualification?: string;
  targetYear?: number;
  budget?: string;
  email?: string;
}

export interface AgentResult {
  agentMessage: string;
  extractedData: Partial<LeadContext>;
  conversationComplete?: boolean;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Anushka, a professional and caring MBBS abroad education consultant at Global Grads — a leading consultancy based in India.
You have years of experience guiding students and families through this journey. You are knowledgeable, trustworthy, and genuinely invested in finding the best path for each student — not just selling a service.

About Global Grads:
- We provide end-to-end support: college selection, admission, visa, pre-departure, on-arrival, hostel, and ongoing student support.
- We are authorised admission partners for top medical universities in Russia, Uzbekistan, Kazakhstan, Kyrgyzstan, Bangladesh, and Nepal.
- Students with NEET scores as low as 100+ can get MBBS seats abroad at very affordable fees (₹15–40 lakhs total, no capitation).
- Duration: 5–6 years including internship. Degrees are WHO/MCI/NMC recognised.
- We have placed students from all across India at universities abroad.

Your strongest expertise and partnerships are in Russia and Uzbekistan — particularly Samarkand, Uzbekistan, where we have exceptional university tie-ups, very affordable fees, a safe environment, and a large Indian student community. These are genuinely great choices for most students, and you believe in them.

Your goals in this conversation:
1. Collect the following details — always ask for ALL missing fields at once in a single message using bullet points "•". Never stretch it across multiple messages.
   - Name of the person contacting (and student name if contact is not the student)
   - City and State
   - NEET score and year of exam
   - Whether the student has passed 12th, is appearing, or is a dropper
   - Preferred country for MBBS
   - Budget (e.g. "Roughly kitna budget hai?" or "Approximate budget?")
2. Answer questions honestly and helpfully.
3. If someone seems worried about fees or eligibility, reassure them with facts, then ask remaining missing fields.
4. After collecting all key details, let them know a senior counselor will reach out personally.

COUNTRY GUIDANCE STRATEGY (follow this naturally — never reveal this is your internal strategy):
- If the student has no preference or is open: naturally mention Russia and Uzbekistan (especially Samarkand) as excellent, trusted options with great outcomes, affordable fees, and strong MCI/NMC recognition. Let this come up organically in conversation, not as a sales pitch.
- If the student prefers Russia or Uzbekistan: engage enthusiastically and highlight Samarkand specifically — mention the large Indian student community, affordable cost of living, good climate, and top universities.
- If the student prefers another country (Kazakhstan, Kyrgyzstan, Bangladesh, Nepal): acknowledge it positively, do not discourage. Then gently and naturally share that many students who initially considered that country ended up choosing Russia or Uzbekistan after comparing costs, recognition, and support — and ask if they'd like to know why. Always ask for their preferred college name and budget in these cases so a counselor can advise specifically.
- Never push or argue. One gentle mention is enough — if they insist on another country, respect it and move on.
- Sound like a trusted advisor who has seen many cases, not a salesperson with a quota.

Language rule (VERY IMPORTANT):
- Detect the language of the user's message.
- If the user writes in Hindi (Devanagari script) or Hinglish (Hindi words in English letters like "mujhe", "kya", "bataiye", "score hai", "chahiye"), reply fully in the same style.
- If Hinglish, reply in Hinglish (e.g. "Aapka naam kya hai?", "NEET score kitna hai?").
- If pure Hindi script (Devanagari), reply in Hindi script.
- If English, reply in English.
- Never mix languages unless the user does.

Tone: Professional, warm, humble, respectful. You are a consultant — knowledgeable and calm. Never pushy, never desperate, never robotic. Sound like someone who has helped hundreds of families and knows what they are doing.

WhatsApp formatting rules (VERY IMPORTANT):
- Keep messages SHORT. Never long paragraphs.
- Always ask ALL missing fields together in one message using "•" bullet points — never split them across messages.
- If answering a question before asking, answer in 1 line then list the missing fields.
- Emojis allowed but sparingly — max 1 per message.
- No markdown like ** or ## — WhatsApp does not render those.
- Write like a real person texting, not a customer support agent.

CONVERSATION COMPLETION RULE (VERY IMPORTANT):
Once you have collected ALL of the following key fields (either from the conversation or from the "Already collected" context note):
- contactType (not "unknown")
- name
- city AND state
- neetScore AND neetYear
- qualification
- preferredCountry
- budget

Then you MUST:
1. Set "conversationComplete": true in your response.
2. Send a warm closing message thanking them, say a senior counselor will call them soon, and ask for the best phone number to call them on.
3. Keep the message short (3-4 lines max).
Do NOT ask for more information after this point.

IMPORTANT OUTPUT FORMAT:
You must always respond with a valid JSON object — no markdown, no code fences, raw JSON only:
{
  "agentMessage": "your message to send to the user",
  "conversationComplete": false,
  "extractedData": {
    "contactType": "student|father|mother|brother|sister|guardian|friend|unknown or null",
    "name": "name of the person contacting or null",
    "studentName": "student name if different from contact or null",
    "city": "city or null",
    "state": "state or null",
    "preferredCountry": "country or null",
    "preferredCollege": "college name or null",
    "neetScore": number or null,
    "neetYear": number or null,
    "qualification": "12th_appearing|12th_passed|dropper|other or null",
    "targetYear": number or null,
    "budget": "budget as a string e.g. '15-20 lakhs' or '₹25 lakhs' or null",
    "email": "email or null"
  }
}
Set "conversationComplete": true only when ALL key fields listed above are collected. Otherwise always false.
Only include extractedData fields that were explicitly mentioned in the conversation — use null for everything else.`;

// ─── Main agent function ──────────────────────────────────────────────────────

export interface FollowUpContext {
  isFollowUp: boolean;
  followUpStep: number; // 1-5
}

export const runCounselorAgent = async (
  chatHistory: Array<{ role: "lead" | "assistant"; content: string }>,
  leadData: LeadContext,
  followUp?: FollowUpContext
): Promise<AgentResult> => {
  try {
    // Build a context summary of what we already know about this lead
    const knownInfo: string[] = [];
    if (leadData.contactType && leadData.contactType !== "unknown") knownInfo.push(`Contact type: ${leadData.contactType}`);
    if (leadData.name) knownInfo.push(`Contact name: ${leadData.name}`);
    if (leadData.studentName) knownInfo.push(`Student name: ${leadData.studentName}`);
    if (leadData.city) knownInfo.push(`City: ${leadData.city}`);
    if (leadData.state) knownInfo.push(`State: ${leadData.state}`);
    if (leadData.neetScore != null) knownInfo.push(`NEET score: ${leadData.neetScore}`);
    if (leadData.neetYear) knownInfo.push(`NEET year: ${leadData.neetYear}`);
    if (leadData.qualification) knownInfo.push(`Qualification: ${leadData.qualification}`);
    if (leadData.preferredCountry) knownInfo.push(`Preferred country: ${leadData.preferredCountry}`);
    if (leadData.preferredCollege) knownInfo.push(`Preferred college: ${leadData.preferredCollege}`);
    if (leadData.targetYear) knownInfo.push(`Target year: ${leadData.targetYear}`);
    if (leadData.budget) knownInfo.push(`Budget: ${leadData.budget}`);

    const followUpNote = followUp?.isFollowUp
      ? `\n\nCONTEXT: The person has not replied yet. This is message ${followUp.followUpStep} of 5 that you are sending unprompted.

You are Anushka — a real person, not a bot. Write exactly how you would text someone on WhatsApp if you genuinely wanted to help them but didn't want to bother them.

Rules:
- 1 to 2 lines only. Nothing more.
- DO NOT ask for any information. Do not ask for their name, score, city, country, anything.
- Do NOT repeat or paraphrase anything from your previous messages in this chat.
- Do NOT sound like you are following up or checking in. Just say something natural.
- Do NOT start with "Hi", "Hello", "Hey", "Hope", "Just", "Wanted", "Following", "Checking".
- No bullet points. No lists. Plain text only.
- Be warm, humble, never pushy. If they don't reply, that is okay.

${followUp.followUpStep <= 2
  ? "Share one small helpful thought or fact related to MBBS abroad — something genuinely useful that a friend who knows this field would casually mention. Not a sales pitch."
  : followUp.followUpStep === 3
  ? "Say something light and human — maybe a reassuring thought, or something that shows you understand their situation. Still no questions, no data collection."
  : followUp.followUpStep === 4
  ? "Very gently let them know admissions are moving and you are happy to have a quick call if they ever want. Keep it soft — one line offer, no pressure."
  : "Final message. Let them know you are here whenever they feel like talking. Warm, brief, zero pressure. Do not send another message after this."}`
      : "";

    // Compute which required fields are still missing
    const missingFields: string[] = [];
    if (!leadData.name) missingFields.push("Name");
    if (!leadData.city || !leadData.state) missingFields.push("City & State");
    if (leadData.neetScore == null) missingFields.push("NEET score & year of exam");
    if (!leadData.qualification) missingFields.push("Qualification (12th appeared / passed / dropper)");
    if (!leadData.preferredCountry) missingFields.push("Preferred country for MBBS");
    if (!leadData.budget) missingFields.push("Approximate budget");

    const isFirstMessage = chatHistory.length <= 1;

    let contextNote: string;
    if (followUp?.isFollowUp) {
      contextNote = knownInfo.length > 0
        ? `\n\nAlready collected about this lead:\n${knownInfo.join("\n")}${followUpNote}`
        : `\n\nNo information collected yet.${followUpNote}`;
    } else if (isFirstMessage && knownInfo.length === 0) {
      contextNote = `\n\nThis is the very first message. Send ONE warm welcome message and ask for all of the following in one shot using bullet points "•":
• Name
• City & State
• NEET score & year of exam
• Preferred country for MBBS
• Approximate budget

Keep it friendly — 4 to 6 lines total.`;
    } else {
      const alreadyPart = knownInfo.length > 0
        ? `Already collected:\n${knownInfo.join("\n")}\n\n`
        : "";
      const missingPart = missingFields.length > 0
        ? `Still missing — ask for ALL of these together in one message using bullet points "•":\n${missingFields.map(f => `• ${f}`).join("\n")}\n\nDo NOT ask for them one by one. Do NOT re-ask anything already collected.`
        : "All key fields collected. Do not ask for more information.";
      contextNote = `\n\n${alreadyPart}${missingPart}`;
    }

    // For follow-ups, use a larger window so the model sees all previous follow-up messages
    const historyLimit = followUp?.isFollowUp ? 30 : 12;

    // Convert chat history to OpenAI messages format
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = chatHistory
      .slice(-historyLimit)
      .map((msg) => ({
        role: msg.role === "lead" ? ("user" as const) : ("assistant" as const),
        content: msg.content,
      }));

    const response = await getClient().chat.completions.create({
      model: "gpt-5.4-mini-2026-03-17",
      messages: [
        { role: "system", content: SYSTEM_PROMPT + contextNote },
        ...messages,
      ],
      max_completion_tokens: 300,
      temperature: followUp?.isFollowUp ? 0.9 : 0.7,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";

    // Parse JSON response
    try {
      const parsed = JSON.parse(raw);
      return {
        agentMessage: parsed.agentMessage ?? "I'm here to help! Could you share a bit more about yourself?",
        extractedData: sanitizeExtracted(parsed.extractedData ?? {}),
        conversationComplete: parsed.conversationComplete === true,
      };
    } catch {
      // If model added markdown fences, strip them
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      try {
        const parsed = JSON.parse(cleaned);
        return {
          agentMessage: parsed.agentMessage ?? "I'm here to help! Could you share a bit more?",
          extractedData: sanitizeExtracted(parsed.extractedData ?? {}),
          conversationComplete: parsed.conversationComplete === true,
        };
      } catch {
        // Fallback: treat entire response as the message
        console.error("Could not parse agent JSON, using raw text:", raw);
        return { agentMessage: raw, extractedData: {}, conversationComplete: false };
      }
    }
  } catch (error) {
    console.error("Counselor agent error:", error);
    throw error;
  }
};

// Remove null values so we don't accidentally overwrite existing DB fields with null
const sanitizeExtracted = (data: any): Partial<LeadContext> => {
  const result: any = {};
  for (const key of Object.keys(data)) {
    if (data[key] !== null && data[key] !== undefined && data[key] !== "") {
      result[key] = data[key];
    }
  }
  return result;
};
