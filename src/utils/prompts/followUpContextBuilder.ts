import { LeadContext } from "../openai";

export const buildFollowUpContext = (leadData: LeadContext, step: number): string => {
  const knownInfo = collectKnownInfo(leadData);

  const alreadyCollected = knownInfo.length > 0
    ? `Already collected about this lead:\n${knownInfo.join("\n")}`
    : "No information collected yet.";

  return `

${alreadyCollected}

CONTEXT: The person has not replied yet. This is follow-up message ${step} of 3.

Look at the conversation above and send a casual, natural continuation of it — like a friend picking up a thread they left off. Reference something specific from the last exchange if possible. Do not introduce new topics, facts, or advice.

Rules:
- 1 to 2 lines only.
- No questions, no data collection, no asking for name/score/city/anything.
- Do NOT repeat or paraphrase anything from your previous messages in this chat.
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
