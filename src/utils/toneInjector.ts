import { getRagInjection } from "./ragInjector";
import { getGenericInjection } from "./genericInjector";

export type ToneMode = "rag" | "generic" | "off";

export async function getToneInjection(
  messages: Array<{ role: string; content: string }>,
  companyId: string,
  ragEnabled: boolean = true
): Promise<string> {
  const mode = (process.env.TONE_INJECTION_MODE ?? "rag") as ToneMode;

  if (mode === "off") return "";

  if (mode === "generic" || !ragEnabled) return getGenericInjection();

  // mode === "rag" and ragEnabled: try RAG, fall back to generic if no match
  const ragResult = await getRagInjection(messages, companyId);
  return ragResult ?? getGenericInjection();
}
