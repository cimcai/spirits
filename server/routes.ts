import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertConversationEntrySchema } from "@shared/schema";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are ${model.name}. ${model.description}. Analyze if you should speak based on your expertise. Return JSON: {"shouldSpeak": boolean, "confidence": 0-100, "analysis": "brief reason", "response": "what you would say"}`
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

  return httpServer;
}
