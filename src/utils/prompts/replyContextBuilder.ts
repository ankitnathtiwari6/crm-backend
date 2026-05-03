import { LeadContext } from "../openai";

export const buildReplyContext = (leadData: LeadContext, isFirstMessage: boolean): string => {
  const knownInfo = collectKnownInfo(leadData);
  const missingFields = collectMissingFields(leadData);
  const isReturningLead = (leadData.sessionCount ?? 1) > 1;

  const engagementSummary = (leadData.totalMessages != null || leadData.sessionCount != null)
    ? `\nEngagement across ALL sessions: ${leadData.totalMessages ?? "?"} total messages, ${leadData.sessionCount ?? 1} session(s).${isReturningLead ? " This lead has returned for a new session — re-engagement signals high conversion intent." : ""}`
    : "";

  if (isFirstMessage && knownInfo.length === 0) {
    return `

This is the very first message. Send one short warm welcome line, then in the same message casually ask for their name, city & state, NEET score & year, preferred country, and budget. Keep it under 3 lines total. No bullet points — write like a person texting.`;
  }

  const alreadyPart = knownInfo.length > 0
    ? `Already collected:\n${knownInfo.join("\n")}\n\n`
    : "";

  const missingPart = missingFields.length > 0
    ? `Still missing: ${missingFields.join(", ")}. Ask for all of them together in one casual message — no bullet points, no lists. Do NOT re-ask anything already collected.`
    : `All key fields collected. Do not ask for more information.${isReturningLead ? " This is a RETURNING LEAD who re-engaged — high conversion signal. Lead quality score must be at least 80." : " This lead has completed intake — score must be at least 75."}`;

  return `\n\n${alreadyPart}${missingPart}${engagementSummary}`;
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

const collectMissingFields = (leadData: LeadContext): string[] => {
  const missing: string[] = [];
  if (!leadData.name) missing.push("Name");
  if (!leadData.city || !leadData.state) missing.push("City & State");
  if (leadData.neetScore == null) missing.push("NEET score & year of exam");
  if (!leadData.qualification) missing.push("Qualification (12th appeared / passed / dropper)");
  if (!leadData.preferredCountry) missing.push("Preferred country for MBBS");
  if (!leadData.budget) missing.push("Approximate budget");
  return missing;
};
