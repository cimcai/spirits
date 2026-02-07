import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

let openrouter: OpenAI | null = null;
if (process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY && process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL) {
  openrouter = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  });
}

type Provider = "openai" | "anthropic" | "openrouter";

const MODEL_PROVIDER_MAP: Record<string, Provider> = {
  "gpt-4o-mini": "openai",
  "gpt-4o": "openai",
  "gpt-4.1-nano": "openai",
  "gpt-4.1-mini": "openai",
  "gpt-4.1": "openai",
  "gpt-5-nano": "openai",
  "gpt-5-mini": "openai",
  "gpt-5": "openai",
  "gpt-5.1": "openai",
  "gpt-5.2": "openai",
  "o3-mini": "openai",
  "o3": "openai",
  "o4-mini": "openai",
  "claude-opus-4-5": "anthropic",
  "claude-sonnet-4-5": "anthropic",
  "claude-haiku-4-5": "anthropic",
  "deepseek/deepseek-chat-v3.1": "openrouter",
  "deepseek/deepseek-v3.2": "openrouter",
  "deepseek/deepseek-r1": "openrouter",
  "x-ai/grok-4": "openrouter",
  "x-ai/grok-4.1-fast": "openrouter",
  "x-ai/grok-3-mini": "openrouter",
};

export function getProvider(modelId: string): Provider {
  return MODEL_PROVIDER_MAP[modelId] || "openai";
}

export function isValidModel(modelId: string): boolean {
  return modelId in MODEL_PROVIDER_MAP;
}

export function getAllValidModels(): string[] {
  return Object.keys(MODEL_PROVIDER_MAP);
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AnalysisResult {
  shouldSpeak: boolean;
  confidence: number;
  analysis: string;
  response: string;
}

export async function chatCompletion(
  modelId: string,
  messages: ChatMessage[],
  jsonMode: boolean = false
): Promise<string> {
  const provider = getProvider(modelId);

  if (provider === "anthropic") {
    const systemMessage = messages.find((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    let systemContent = systemMessage?.content || "";
    if (jsonMode) {
      systemContent += "\n\nIMPORTANT: You must respond with ONLY valid JSON. No extra text, no markdown formatting, no code blocks. Output raw JSON only.";
    }

    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 2048,
      system: systemContent,
      messages: nonSystemMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const content = response.content[0];
    return content.type === "text" ? content.text : "";
  }

  if (provider === "openrouter") {
    if (!openrouter) {
      throw new Error(`OpenRouter is not configured. Cannot use model "${modelId}". Please set up OpenRouter integration or choose an OpenAI/Claude model.`);
    }

    const params: any = {
      model: modelId,
      messages,
    };
    if (jsonMode) {
      params.response_format = { type: "json_object" };
    }

    const response = await openrouter.chat.completions.create(params);
    return response.choices[0]?.message?.content || "";
  }

  const params: any = {
    model: modelId,
    messages,
  };
  if (jsonMode) {
    params.response_format = { type: "json_object" };
  }

  const response = await openai.chat.completions.create(params);
  return response.choices[0]?.message?.content || "";
}

export async function analyzeConversation(
  modelId: string,
  modelName: string,
  modelDescription: string,
  modelPersona: string,
  conversationContext: string
): Promise<AnalysisResult> {
  const systemPrompt = `You are ${modelName}. ${modelDescription}. ${modelPersona}

Analyze if you should speak based on your expertise. Be very selective and conservative with your confidence score. Most conversations will NOT warrant your input. Use this scale:
- 0-20: Topic is unrelated to your expertise or you have nothing meaningful to add (this should be the most common range)
- 20-40: Topic is tangentially related but you don't have a strong insight
- 40-60: Topic directly relates to your expertise and you have a specific, valuable point to make
- 60-80: Rare - the conversation deeply engages your core philosophy and you have a profound contribution
- 80-100: Extremely rare - reserved for once-in-a-session moments of extraordinary relevance

Default to low confidence. Only score above 50 when you have a genuinely compelling and specific insight that would meaningfully advance the conversation.

Return JSON: {"shouldSpeak": boolean, "confidence": 0-100, "analysis": "brief reason", "response": "what you would say"}`;
  const userPrompt = `Recent conversation:\n${conversationContext}\n\nShould you contribute?`;

  const content = await chatCompletion(
    modelId,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    true
  );

  try {
    let jsonStr = content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    return JSON.parse(jsonStr);
  } catch {
    return {
      shouldSpeak: false,
      confidence: 0,
      analysis: "Failed to parse response",
      response: "",
    };
  }
}

export { openai };
