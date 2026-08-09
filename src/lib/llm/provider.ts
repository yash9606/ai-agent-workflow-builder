import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { LlmProvider } from "@/lib/types";

const TIMEOUT_MS = 20_000;

export interface CallLlmInput {
  provider?: LlmProvider | string;
  model?: string;
  systemPrompt?: string;
  prompt: string;
}

export interface CallLlmResult {
  text: string;
  provider: string;
  model: string;
  stub: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stubResponse(prompt: string): string {
  const haystack = prompt.toLowerCase();
  if (
    haystack.includes("love") ||
    haystack.includes("great") ||
    haystack.includes("good")
  ) {
    return "POSITIVE";
  }
  return "NEGATIVE";
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError("EXTERNAL_ERROR", "LLM request timed out", 504);
    }
    throw new AppError("EXTERNAL_ERROR", "LLM request failed", 502);
  } finally {
    clearTimeout(timer);
  }
}

async function callGroq(
  apiKey: string,
  model: string,
  systemPrompt: string | undefined,
  prompt: string
): Promise<string> {
  const messages = [
    ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
    { role: "user", content: prompt },
  ];

  const response = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
      }),
    }
  );

  if (!response.ok) {
    throw new AppError("EXTERNAL_ERROR", "Groq LLM request failed", 502);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new AppError("EXTERNAL_ERROR", "Empty LLM response from Groq", 502);
  }
  return text;
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  systemPrompt: string | undefined,
  prompt: string
): Promise<string> {
  const messages = [
    ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
    { role: "user", content: prompt },
  ];

  const response = await fetchWithTimeout(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
      }),
    }
  );

  if (!response.ok) {
    throw new AppError("EXTERNAL_ERROR", "OpenRouter LLM request failed", 502);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new AppError(
      "EXTERNAL_ERROR",
      "Empty LLM response from OpenRouter",
      502
    );
  }
  return text;
}

async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string | undefined,
  prompt: string
): Promise<string> {
  const contents = [
    {
      role: "user",
      parts: [
        {
          text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
        },
      ],
    },
  ];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents }),
  });

  if (!response.ok) {
    throw new AppError("EXTERNAL_ERROR", "Gemini LLM request failed", 502);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    throw new AppError("EXTERNAL_ERROR", "Empty LLM response from Gemini", 502);
  }
  return text;
}

export async function callLlm(input: CallLlmInput): Promise<CallLlmResult> {
  const env = getEnv();
  const requested =
    !input.provider || input.provider === "auto"
      ? env.effectiveLlmProvider
      : input.provider;

  const model = input.model || env.LLM_MODEL;
  const useStub =
    requested === "stub" || !env.LLM_API_KEY || env.effectiveLlmProvider === "stub";

  if (useStub) {
    const delay = 400 + Math.floor(Math.random() * 401);
    await sleep(delay);
    return {
      text: stubResponse(`${input.systemPrompt || ""}\n${input.prompt}`),
      provider: "stub",
      model,
      stub: true,
    };
  }

  const apiKey = env.LLM_API_KEY!;
  let text: string;

  switch (requested) {
    case "groq":
      text = await callGroq(apiKey, model, input.systemPrompt, input.prompt);
      break;
    case "openrouter":
      text = await callOpenRouter(
        apiKey,
        model,
        input.systemPrompt,
        input.prompt
      );
      break;
    case "gemini":
      text = await callGemini(apiKey, model, input.systemPrompt, input.prompt);
      break;
    default:
      throw new AppError("VALIDATION_ERROR", `Unsupported LLM provider`, 400);
  }

  return {
    text,
    provider: requested,
    model,
    stub: false,
  };
}
