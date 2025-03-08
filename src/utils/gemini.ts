import dotenv from "dotenv";

import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} from "@google/generative-ai";

dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY ?? "";

const modelConfig = {
  model: "gemini-2.0-flash",
  generationConfig: {
    maxOutputTokens: 1000,
  },
  safetySettings: [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
  ],
};

export const extractPersonData = async (inputText: string): Promise<any> => {
  try {
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel(modelConfig);

    const prompt = `Extract name, preferred country, city, state, and NEET score from the following text and return the result in JSON format: \n\n${inputText}\n\n The JSON object should have the following format: { "name": "...", "preferredCountry": "...", "city": "...", "state": "...", "neetScore": "..." }. DO NOT wrap the response in a code block or use markdown formatting. Only return raw JSON.`;
    const result = await model.generateContent(prompt);

    if (
      result &&
      result.response &&
      result.response.candidates &&
      result.response.candidates.length > 0 &&
      result.response.candidates[0].content &&
      result.response.candidates[0].content.parts &&
      result.response.candidates[0].content.parts.length > 0 &&
      result.response.candidates[0].content.parts[0].text
    ) {
      let text = result.response.candidates[0].content.parts[0].text;

      console.log("text,", text);
      // Remove code block if present
      const codeBlockStart = text.indexOf("```json");

      console.log("codeBlockStart", codeBlockStart);
      if (codeBlockStart !== -1) {
        text = text
          .substring(codeBlockStart + 7, text.lastIndexOf("```"))
          .trim();
      }

      console.log("codeBlockStart2", codeBlockStart);
      try {
        const jsonResponse = JSON.parse(text);
        console.log(jsonResponse);
        if (typeof jsonResponse === "object") {
          return jsonResponse;
        } else {
          return null;
        }
      } catch (jsonError) {
        console.error("JSON parsing error:", jsonError);
        return null;
      }
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error extracting person data:", error);
    return null;
  }
};
