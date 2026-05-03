import { DEFAULT_KNOWLEDGE_BASE } from "./knowledgeBase";

/**
 * Returns the knowledge base for a given company.
 * Extend this to load per-company knowledge from DB when needed.
 */
export const loadKnowledgeBase = async (companyId?: string): Promise<string> => {
  // Future: fetch company-specific KB from DB by companyId
  return DEFAULT_KNOWLEDGE_BASE;
};
