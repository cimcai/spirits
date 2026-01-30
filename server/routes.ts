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

      // Analyze with each model
      for (const model of models) {
        try {
          const response = await openai.chat.completions.create({
            model: "gpt-5-nano",
            messages: [
              {
                role: "system",
                content: `You are ${model.name}. ${model.persona}

Analyze the conversation and determine if you should speak. Consider:
1. Is there a direct question or topic that matches your expertise?
2. Would your input add significant value right now?
3. Is this an appropriate moment to interject?

Respond in JSON format:
{
  "shouldSpeak": boolean,
  "confidence": number (0-100),
  "analysis": "Brief analysis of why you should or shouldn't speak",
  "response": "If shouldSpeak is true, your proposed response" 
}`
              },
              {
                role: "user",
                content: `Conversation:\n${conversationContext}\n\nShould you speak now?`
              }
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 500,
          });

          const content = response.choices[0]?.message?.content;
          if (content) {
            const result = JSON.parse(content);
            
            // Save analysis
            await storage.createModelAnalysis({
              roomId,
              modelId: model.id,
              conversationEntryId: entry.id,
              analysis: result.analysis || "No analysis provided",
              shouldSpeak: result.shouldSpeak || false,
              confidence: result.confidence || 0,
            });

            // If model wants to speak, create outbound call
            if (result.shouldSpeak && result.confidence >= model.triggerThreshold * 10) {
              await storage.createOutboundCall({
                roomId,
                modelId: model.id,
                triggerReason: result.analysis,
                responseContent: result.response || "No response generated",
                status: "completed",
              });
            }
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
