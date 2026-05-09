import { LeadContext } from "../openai";

export const buildFollowUpContext = (leadData: LeadContext, step: number): string => {
  const knownInfo = collectKnownInfo(leadData);

  const alreadyCollected = knownInfo.length > 0
    ? `Already collected about this lead:\n${knownInfo.join("\n")}`
    : "No information collected yet.";

  return `

${alreadyCollected}

CONTEXT: The person has not replied to your last message. This is follow-up message ${step} of 3.

Look at your LAST message in the conversation above. Your follow-up should gently nudge the person to reply to exactly what you asked in that last message — do not introduce anything new.

Rules:
- 1 to 2 lines only.
- Reference what you last asked or said — make it feel like a natural nudge, not a generic check-in.
- You MAY ask one simple question if it directly picks up from the last message (e.g. if you asked for their budget last, you can ask again softly).
- Do NOT ask for new information beyond what was already asked in the last message.
- Do NOT repeat or paraphrase anything word-for-word from your previous messages.
- Do NOT start with "Hi", "Hello", "Hey", "Hope", "Just", "Wanted", "Following", "Checking".
- No bullet points, no lists, plain text only.
- Warm and zero pressure. If they don't reply, that is fine.`;
};

const collectKnownInfo = (leadData: LeadContext): string[] => {
  const info: string[] = [];
  if (leadData.contactType && leadData.contactType !== "unknown") info.push(`Contact type: ${leadData.contactType}`);
  if (leadData.name) info.push(`Contact name: ${leadData.name}`);
  if (leadData.studentName) info.push(`Student name: ${leadData.studentName}`);
  if (leadData.city) info.push(`City: ${leadData.city}`);
  if (leadData.state) info.push(`State: ${leadData.state}`);
  if (leadData.neetScore != null) info.push(`NEET score: ${leadData.neetScore}`);
  if (leadData.neetYear) info.push(`NEET year: ${leadData.neetYear}`);
  if (leadData.qualification) info.push(`Qualification: ${leadData.qualification}`);
  if (leadData.preferredCountry) info.push(`Preferred country: ${leadData.preferredCountry}`);
  if (leadData.preferredCollege) info.push(`Preferred college: ${leadData.preferredCollege}`);
  if (leadData.targetYear) info.push(`Target year: ${leadData.targetYear}`);
  if (leadData.budget) info.push(`Budget: ${leadData.budget}`);
  return info;
};
