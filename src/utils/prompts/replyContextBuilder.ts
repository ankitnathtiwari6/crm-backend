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

This is the very first message. Send one short warm welcome line, then ask for all missing fields — each on its own new line, no bullets, no numbers. Fields to ask: name, city & state, whether they're in 12th / passed / dropper, NEET score & year, preferred country, budget.`;
  }

  const alreadyPart = knownInfo.length > 0
    ? `Already collected:\n${knownInfo.join("\n")}\n\n`
    : "";

  const missingPart = missingFields.length > 0
    ? `Still missing: ${missingFields.join(", ")}. Ask for all of them in one message. If 3 or more fields: use a short lead-in line then each field on its own new line (no bullets, no numbers). If 1–2 fields: one natural sentence is fine. Do NOT re-ask anything already collected.`
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
  // Students appearing for NEET for the first time haven't taken it yet — score is not applicable
  const neetNotApplicable = leadData.qualification === "12th_appearing";
  if (leadData.neetScore == null && !neetNotApplicable) missing.push("NEET score & year of exam");
  if (!leadData.qualification) missing.push("Is the student currently in 12th, passed 12th, or a dropper?");
  if (!leadData.preferredCountry) missing.push("Preferred country for MBBS");
  if (!leadData.budget) missing.push("Approximate budget");
  return missing;
};
