import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertConversationEntrySchema, insertAiModelSchema } from "@shared/schema";
import OpenAI from "openai";
import multer from "multer";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Get active room
  app.get("/api/rooms/active", async (req, res) => {
    try {
      let room = await storage.getActiveRoom();
      if (!room) {
        room = await storage.createRoom({
          name: "Main Conference Room",
          description: "Primary meeting room for conversation monitoring",
          isActive: true,
        });
      }
      res.json(room);
    } catch (error) {
      console.error("Error fetching active room:", error);
      res.status(500).json({ error: "Failed to fetch room" });
    }
  });

  // Get conversation entries for a room
  app.get("/api/rooms/:roomId/entries", async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const entries = await storage.getEntriesByRoom(roomId);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching entries:", error);
      res.status(500).json({ error: "Failed to fetch entries" });
    }
  });

  // Add a conversation entry and trigger AI analysis
  app.post("/api/rooms/:roomId/entries", async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const validated = insertConversationEntrySchema.parse({
        ...req.body,
        roomId,
      });

      const entry = await storage.createConversationEntry(validated);

      // Get all models and run analysis in parallel
      const models = await storage.getAllAiModels();
      const entries = await storage.getEntriesByRoom(roomId);
      
      // Build conversation context
      const conversationContext = entries
        .slice(-10)
        .map((e) => `${e.speaker}: ${e.content}`)
        .join("\n");

      // Analyze with each model in parallel
      for (const model of models) {
        try {
          const response = await openai.chat.completions.create({
            model: model.llmModel || "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are ${model.name}. ${model.description}. ${model.persona}\n\nAnalyze if you should speak based on your expertise. Return JSON: {"shouldSpeak": boolean, "confidence": 0-100, "analysis": "brief reason", "response": "what you would say"}`
              },
              {
                role: "user",
                content: `Recent conversation:\n${conversationContext}\n\nShould you contribute?`
              }
            ],
            response_format: { type: "json_object" },
          });

          const content = response.choices[0]?.message?.content;
          if (content) {
            const result = JSON.parse(content);
            
            // Save analysis with proposed response (don't auto-trigger)
            await storage.createModelAnalysis({
              roomId,
              modelId: model.id,
              conversationEntryId: entry.id,
              analysis: result.analysis || "No analysis provided",
              shouldSpeak: result.shouldSpeak || false,
              confidence: result.confidence || 0,
              proposedResponse: result.response || null,
              isTriggered: false,
            });
          }
        } catch (analysisError) {
          console.error(`Error analyzing with model ${model.name}:`, analysisError);
        }
      }

      res.status(201).json(entry);
    } catch (error) {
      console.error("Error creating entry:", error);
      res.status(500).json({ error: "Failed to create entry" });
    }
  });

  // Trigger an AI model's response (when user clicks the pulsing light)
  app.post("/api/analyses/:analysisId/trigger", async (req, res) => {
    try {
      const analysisId = parseInt(req.params.analysisId);
      const analyses = await storage.getAnalysesByRoom(1); // Get all to find the one
      const analysis = analyses.find(a => a.id === analysisId);
      
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      if (!analysis.proposedResponse) {
        return res.status(400).json({ error: "No proposed response available" });
      }

      // Get the model name to use as speaker
      const model = await storage.getAiModel(analysis.modelId);
      if (!model) {
        return res.status(404).json({ error: "Model not found" });
      }

      // Mark analysis as triggered
      await storage.markAnalysisTriggered(analysisId);

      // Add the AI's response to the conversation
      const entry = await storage.createConversationEntry({
        roomId: analysis.roomId,
        speaker: model.name,
        content: analysis.proposedResponse,
      });

      // Create an outbound call record
      await storage.createOutboundCall({
        roomId: analysis.roomId,
        modelId: analysis.modelId,
        triggerReason: analysis.analysis,
        responseContent: analysis.proposedResponse,
        status: "completed",
      });

      res.status(201).json({ entry, triggered: true });
    } catch (error) {
      console.error("Error triggering response:", error);
      res.status(500).json({ error: "Failed to trigger response" });
    }
  });

  // Reset a room
  app.post("/api/rooms/:roomId/reset", async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      await storage.resetRoom(roomId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error resetting room:", error);
      res.status(500).json({ error: "Failed to reset room" });
    }
  });

  // Get AI models
  app.get("/api/models", async (req, res) => {
    try {
      const models = await storage.getAllAiModels();
      res.json(models);
    } catch (error) {
      console.error("Error fetching models:", error);
      res.status(500).json({ error: "Failed to fetch models" });
    }
  });

  // Update an AI model's configuration
  app.patch("/api/models/:modelId", async (req, res) => {
    try {
      const modelId = parseInt(req.params.modelId);
      
      const validVoices = ["onyx", "nova", "echo", "alloy", "fable", "shimmer"];
      const validModels = ["gpt-4o-mini", "gpt-4o", "gpt-5-nano", "gpt-5-mini", "gpt-5", "gpt-5.2"];
      
      const updateSchema = insertAiModelSchema.partial();
      const parsed = updateSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
      }

      const updates = parsed.data;

      if (updates.voice && !validVoices.includes(updates.voice)) {
        return res.status(400).json({ error: `Invalid voice. Must be one of: ${validVoices.join(", ")}` });
      }

      if (updates.llmModel && !validModels.includes(updates.llmModel)) {
        return res.status(400).json({ error: `Invalid model. Must be one of: ${validModels.join(", ")}` });
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const updated = await storage.updateAiModel(modelId, updates);
      if (!updated) {
        return res.status(404).json({ error: "Model not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating model:", error);
      res.status(500).json({ error: "Failed to update model" });
    }
  });

  // Audio transcription endpoint
  app.post("/api/audio/transcribe", upload.single("audio"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No audio file provided" });
      }

      const file = new File([req.file.buffer], "audio.webm", { type: req.file.mimetype });
      
      const transcription = await openai.audio.transcriptions.create({
        file,
        model: "gpt-4o-mini-transcribe",
      });

      const text = transcription.text?.trim();
      if (!text) {
        return res.status(200).json({ text: "", entry: null });
      }

      // If roomId provided, create a conversation entry
      const roomId = req.body?.roomId ? parseInt(req.body.roomId) : null;
      let entry = null;

      if (roomId) {
        entry = await storage.createConversationEntry({
          roomId,
          speaker: "Live Speaker",
          content: text,
        });

        // Trigger AI analysis for all models
        const models = await storage.getAllAiModels();
        const allEntries = await storage.getEntriesByRoom(roomId);
        const conversationContext = allEntries
          .slice(-10)
          .map((e) => `${e.speaker}: ${e.content}`)
          .join("\n");

        for (const model of models) {
          try {
            const analysisResponse = await openai.chat.completions.create({
              model: model.llmModel || "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content: `You are ${model.name}. ${model.description}. ${model.persona}\n\nAnalyze if you should speak based on your expertise. Return JSON: {"shouldSpeak": boolean, "confidence": 0-100, "analysis": "brief reason", "response": "what you would say"}`
                },
                {
                  role: "user",
                  content: `Recent conversation:\n${conversationContext}\n\nShould you contribute?`
                }
              ],
              response_format: { type: "json_object" },
            });

            const analysisContent = analysisResponse.choices[0]?.message?.content;
            if (analysisContent) {
              const result = JSON.parse(analysisContent);
              await storage.createModelAnalysis({
                roomId,
                modelId: model.id,
                conversationEntryId: entry.id,
                analysis: result.analysis || "No analysis provided",
                shouldSpeak: result.shouldSpeak || false,
                confidence: result.confidence || 0,
                proposedResponse: result.response || null,
                isTriggered: false,
              });
            }
          } catch (analysisError) {
            console.error(`Error analyzing with model ${model.name}:`, analysisError);
          }
        }
      }

      res.json({ text, entry });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });

  // Get analyses for a room
  app.get("/api/rooms/:roomId/analyses", async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const analyses = await storage.getAnalysesByRoom(roomId);
      res.json(analyses);
    } catch (error) {
      console.error("Error fetching analyses:", error);
      res.status(500).json({ error: "Failed to fetch analyses" });
    }
  });

  // Get calls for a room
  app.get("/api/rooms/:roomId/calls", async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const calls = await storage.getCallsByRoom(roomId);
      res.json(calls);
    } catch (error) {
      console.error("Error fetching calls:", error);
      res.status(500).json({ error: "Failed to fetch calls" });
    }
  });

  // Generate a philosophical dialogue message
  app.post("/api/rooms/:roomId/generate-dialogue", async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const entries = await storage.getEntriesByRoom(roomId);
      
      // Build conversation context from recent entries
      const recentContext = entries
        .slice(-8)
        .map((e) => `${e.speaker}: ${e.content}`)
        .join("\n");

      // Philosophical speakers
      const speakers = ["Aiden", "Mira", "Leo", "Sage"];
      const speaker = speakers[Math.floor(Math.random() * speakers.length)];

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are generating dialogue for a philosophical discussion between friends. Generate a single thoughtful statement or question from ${speaker}. Topics include: meaning of life, consciousness, free will, ethics, happiness, death, reality, knowledge, virtue, justice. Keep it conversational (1-2 sentences). Just output the statement, no speaker name prefix.`
          },
          {
            role: "user",
            content: recentContext 
              ? `Continue this philosophical conversation:\n${recentContext}\n\nGenerate ${speaker}'s next contribution:`
              : `Start a philosophical conversation. Generate ${speaker}'s opening thought:`
          }
        ],
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        return res.status(500).json({ error: "Failed to generate dialogue" });
      }

      // Save the generated message
      const entry = await storage.createConversationEntry({
        roomId,
        speaker,
        content,
      });

      // Trigger AI analysis for all models (same as regular entries)
      const models = await storage.getAllAiModels();
      const allEntries = await storage.getEntriesByRoom(roomId);
      const conversationContext = allEntries
        .slice(-10)
        .map((e) => `${e.speaker}: ${e.content}`)
        .join("\n");

      for (const model of models) {
        try {
          const analysisResponse = await openai.chat.completions.create({
            model: model.llmModel || "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are ${model.name}. ${model.description}. ${model.persona}\n\nAnalyze if you should speak based on your expertise. Return JSON: {"shouldSpeak": boolean, "confidence": 0-100, "analysis": "brief reason", "response": "what you would say"}`
              },
              {
                role: "user",
                content: `Recent conversation:\n${conversationContext}\n\nShould you contribute?`
              }
            ],
            response_format: { type: "json_object" },
          });

          const analysisContent = analysisResponse.choices[0]?.message?.content;
          if (analysisContent) {
            const result = JSON.parse(analysisContent);
            await storage.createModelAnalysis({
              roomId,
              modelId: model.id,
              conversationEntryId: entry.id,
              analysis: result.analysis || "No analysis provided",
              shouldSpeak: result.shouldSpeak || false,
              confidence: result.confidence || 0,
              proposedResponse: result.response || null,
              isTriggered: false,
            });
          }
        } catch (analysisError) {
          console.error(`Error analyzing with model ${model.name}:`, analysisError);
        }
      }

      res.status(201).json(entry);
    } catch (error) {
      console.error("Error generating dialogue:", error);
      res.status(500).json({ error: "Failed to generate dialogue" });
    }
  });

  // Text-to-Speech endpoint
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voice = "alloy" } = req.body;
      
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Text is required" });
      }

      // Use OpenAI TTS via gpt-audio model
      const response = await openai.chat.completions.create({
        model: "gpt-audio",
        modalities: ["text", "audio"],
        audio: { voice, format: "wav" },
        messages: [
          { role: "system", content: "You are an assistant that performs text-to-speech. Speak with the gravitas and wisdom befitting a philosopher." },
          { role: "user", content: `Repeat the following text verbatim: ${text}` },
        ],
      });

      const audioData = (response.choices[0]?.message as any)?.audio?.data ?? "";
      
      if (!audioData) {
        return res.status(500).json({ error: "No audio generated" });
      }

      const audioBuffer = Buffer.from(audioData, "base64");
      
      res.set({
        "Content-Type": "audio/wav",
        "Content-Length": audioBuffer.length.toString(),
      });
      res.send(audioBuffer);
    } catch (error) {
      console.error("Error generating TTS:", error);
      res.status(500).json({ error: "Failed to generate speech" });
    }
  });

  return httpServer;
}
