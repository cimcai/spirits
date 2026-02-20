import { useState, useRef, useCallback } from "react";

export interface WebLLMProgress {
  status: "idle" | "loading" | "ready" | "generating" | "error";
  progress: number;
  message: string;
}

export interface WebLLMModel {
  id: string;
  label: string;
  size: string;
}

export const WEBLLM_MODELS: WebLLMModel[] = [
  { id: "Llama-3.1-8B-Instruct-q4f32_1-MLC", label: "Llama 3.1 8B", size: "~4 GB" },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi 3.5 Mini", size: "~2 GB" },
  { id: "gemma-2-2b-it-q4f32_1-MLC", label: "Gemma 2 2B", size: "~1.4 GB" },
  { id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", label: "Qwen 2.5 1.5B", size: "~1 GB" },
  { id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC", label: "SmolLM2 1.7B", size: "~1 GB" },
];

export function useWebLLM() {
  const engineRef = useRef<any>(null);
  const currentModelRef = useRef<string>("");
  const [progress, setProgress] = useState<WebLLMProgress>({
    status: "idle",
    progress: 0,
    message: "",
  });

  const loadModel = useCallback(async (modelId: string) => {
    if (engineRef.current && currentModelRef.current === modelId) {
      setProgress({ status: "ready", progress: 100, message: "Model ready" });
      return engineRef.current;
    }

    setProgress({ status: "loading", progress: 0, message: "Loading WebLLM..." });

    try {
      const webllm = await import("@mlc-ai/web-llm");

      const engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: (report: any) => {
          const pct = Math.round((report.progress || 0) * 100);
          setProgress({
            status: "loading",
            progress: pct,
            message: report.text || `Loading model... ${pct}%`,
          });
        },
        logLevel: "SILENT",
      });

      engineRef.current = engine;
      currentModelRef.current = modelId;
      setProgress({ status: "ready", progress: 100, message: "Model ready" });
      return engine;
    } catch (err: any) {
      const msg = err?.message || "Failed to load model";
      setProgress({ status: "error", progress: 0, message: msg });
      throw err;
    }
  }, []);

  const chatCompletion = useCallback(async (
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    onToken?: (token: string) => void,
  ): Promise<string> => {
    const engine = await loadModel(modelId);
    setProgress(p => ({ ...p, status: "generating", message: "Generating response..." }));

    try {
      if (onToken) {
        const stream = await engine.chat.completions.create({
          messages,
          stream: true,
          temperature: 0.7,
          max_tokens: 1024,
        });

        let full = "";
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content || "";
          full += delta;
          onToken(delta);
        }
        setProgress(p => ({ ...p, status: "ready", message: "Model ready" }));
        return full;
      } else {
        const reply = await engine.chat.completions.create({
          messages,
          temperature: 0.7,
          max_tokens: 1024,
        });
        setProgress(p => ({ ...p, status: "ready", message: "Model ready" }));
        return reply.choices[0]?.message?.content || "";
      }
    } catch (err: any) {
      setProgress({ status: "error", progress: 0, message: err?.message || "Generation failed" });
      throw err;
    }
  }, [loadModel]);

  const isSupported = typeof navigator !== "undefined" && "gpu" in navigator;

  return {
    loadModel,
    chatCompletion,
    progress,
    isSupported,
  };
}
