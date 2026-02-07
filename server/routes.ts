import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertConversationEntrySchema, insertAiModelSchema } from "@shared/schema";
import multer from "multer";
import { openai, analyzeConversation, chatCompletion, isValidModel, getAllValidModels, getProvider } from "./ai-provider";

async function logLatency(
  operation: string,
  model: string,
  service: string,
  fn: () => Promise<any>,
  extra?: { roomId?: number; modelId?: number; metadata?: Record<string, any> }
) {
  const start = Date.now();
  let success = true;
  let error: string | undefined;
  let result: any;
  try {
    result = await fn();
  } catch (err: any) {
    success = false;
    error = err?.message || String(err);
    throw err;
  } finally {
    const latencyMs = Date.now() - start;
    storage.createLatencyLog({
      operation,
      model,
      service,
      latencyMs,
      success,
      error: error || null,
      roomId: extra?.roomId ?? null,
      modelId: extra?.modelId ?? null,
      metadata: extra?.metadata ? JSON.stringify(extra.metadata) : null,
    }).catch(logErr => console.error("Failed to save latency log:", logErr));
  }
  return result;
}

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

      for (const model of models) {
        try {
          const llmModel = model.llmModel || "gpt-4o-mini";
          const result = await logLatency(
            "analysis", llmModel, getProvider(llmModel),
            () => analyzeConversation(llmModel, model.name, model.description || "", model.persona, conversationContext),
            { roomId, modelId: model.id, metadata: { philosopherName: model.name } }
          );
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
      const validModels = getAllValidModels();
      
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

  // Create a new AI model
  app.post("/api/models", async (req, res) => {
    try {
      const parsed = insertAiModelSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
      }
      const model = await storage.createAiModel(parsed.data);
      res.status(201).json(model);
    } catch (error) {
      console.error("Error creating model:", error);
      res.status(500).json({ error: "Failed to create model" });
    }
  });

  // Delete an AI model
  app.delete("/api/models/:modelId", async (req, res) => {
    try {
      const modelId = parseInt(req.params.modelId);
      const model = await storage.getAiModel(modelId);
      if (!model) {
        return res.status(404).json({ error: "Model not found" });
      }
      await storage.updateAiModel(modelId, { isActive: false });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting model:", error);
      res.status(500).json({ error: "Failed to delete model" });
    }
  });

  // Rate a philosopher's response
  app.post("/api/analyses/:analysisId/rate", async (req, res) => {
    try {
      const analysisId = parseInt(req.params.analysisId);
      const { rating } = req.body; // -1, 0, or 1

      if (rating === undefined || ![-1, 0, 1].includes(rating)) {
        return res.status(400).json({ error: "Rating must be -1, 0, or 1" });
      }

      // Check if already rated
      const existing = await storage.getRatingByAnalysis(analysisId);
      if (existing) {
        return res.status(400).json({ error: "Already rated" });
      }

      const analysis = await storage.getAnalysisById(analysisId);
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      const ratingRecord = await storage.createResponseRating({
        analysisId,
        modelId: analysis.modelId,
        rating,
      });

      // Adjust the model's confidence multiplier based on rating
      const model = await storage.getAiModel(analysis.modelId);
      if (model) {
        let newMultiplier = model.confidenceMultiplier;
        if (rating === -1) {
          newMultiplier = Math.max(0.1, newMultiplier * 0.8); // 20% penalty
        } else if (rating === 1) {
          newMultiplier = Math.min(1.5, newMultiplier * 1.05); // 5% boost, capped at 1.5
        }
        await storage.updateAiModel(analysis.modelId, { confidenceMultiplier: newMultiplier });
      }

      res.status(201).json(ratingRecord);
    } catch (error) {
      console.error("Error rating response:", error);
      res.status(500).json({ error: "Failed to rate response" });
    }
  });

  // Get ratings for a model
  app.get("/api/models/:modelId/ratings", async (req, res) => {
    try {
      const modelId = parseInt(req.params.modelId);
      const ratings = await storage.getRatingsByModel(modelId);
      res.json(ratings);
    } catch (error) {
      console.error("Error fetching ratings:", error);
      res.status(500).json({ error: "Failed to fetch ratings" });
    }
  });

  // Audio transcription endpoint
  app.post("/api/audio/transcribe", upload.single("audio"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No audio file provided" });
      }

      const file = new File([req.file.buffer], "audio.webm", { type: req.file.mimetype });
      const roomId = req.body?.roomId ? parseInt(req.body.roomId) : null;
      
      const transcription = await logLatency(
        "transcription", "gpt-4o-mini-transcribe", "openai",
        () => openai.audio.transcriptions.create({ file, model: "gpt-4o-mini-transcribe" }),
        { roomId: roomId ?? undefined, metadata: { inputSize: req.file.buffer.length } }
      );

      const text = transcription.text?.trim();
      if (!text) {
        return res.status(200).json({ text: "", entry: null });
      }

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
            const llmModel = model.llmModel || "gpt-4o-mini";
            const result = await logLatency(
              "analysis", llmModel, getProvider(llmModel),
              () => analyzeConversation(llmModel, model.name, model.description || "", model.persona, conversationContext),
              { roomId, modelId: model.id, metadata: { philosopherName: model.name, source: "transcription" } }
            );
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

  app.get("/api/led-status", async (req, res) => {
    try {
      const models = await storage.getAllAiModels();
      const roomId = req.query.roomId ? parseInt(req.query.roomId as string) : 1;
      const allStatuses = await Promise.all(
        models.map(async (model) => {
          const latest = await storage.getLatestAnalysisByModel(roomId, model.id);
          const rawConfidence = latest?.confidence ?? 0;
          const effectiveConfidence = Math.round(rawConfidence * (model.confidenceMultiplier ?? 1));
          const brightness = Math.round((effectiveConfidence / 100) * 255);
          return {
            modelId: model.id,
            name: model.name,
            color: model.color,
            confidence: effectiveConfidence,
            brightness,
            shouldSpeak: latest?.shouldSpeak ?? false,
          };
        })
      );
      // Sort by confidence descending, top 3 get button indices
      const sorted = [...allStatuses].sort((a, b) => b.confidence - a.confidence);
      const statuses = sorted.map((s, i) => ({
        ...s,
        index: i < 3 ? i + 1 : null,
      }));
      res.json(statuses);
    } catch (error) {
      console.error("Error fetching LED status:", error);
      res.status(500).json({ error: "Failed to fetch LED status" });
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

      const response = await logLatency(
        "dialogue_generation", "gpt-4o-mini", "openai",
        () => openai.chat.completions.create({
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
        }),
        { roomId, metadata: { speaker } }
      );

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
          const llmModel = model.llmModel || "gpt-4o-mini";
          const result = await logLatency(
            "analysis", llmModel, getProvider(llmModel),
            () => analyzeConversation(llmModel, model.name, model.description || "", model.persona, conversationContext),
            { roomId, modelId: model.id, metadata: { philosopherName: model.name, source: "dialogue" } }
          );
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

      const response = await logLatency(
        "tts", "gpt-audio", "openai",
        () => openai.chat.completions.create({
          model: "gpt-audio",
          modalities: ["text", "audio"],
          audio: { voice, format: "wav" },
          messages: [
            { role: "system", content: "You are an assistant that performs text-to-speech. Speak with the gravitas and wisdom befitting a philosopher." },
            { role: "user", content: `Repeat the following text verbatim: ${text}` },
          ],
        }),
        { metadata: { voice, textLength: text.length } }
      );

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

  // Latency analytics endpoints
  app.get("/api/latency", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const operation = req.query.operation as string | undefined;
      const logs = operation
        ? await storage.getLatencyLogsByOperation(operation)
        : await storage.getLatencyLogs(limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching latency logs:", error);
      res.status(500).json({ error: "Failed to fetch latency logs" });
    }
  });

  app.get("/api/latency/summary", async (req, res) => {
    try {
      const logs = await storage.getLatencyLogs(500);
      const byOperation: Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number; errors: number }> = {};
      const byModel: Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number }> = {};
      const byService: Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number }> = {};

      for (const log of logs) {
        // By operation
        if (!byOperation[log.operation]) {
          byOperation[log.operation] = { count: 0, totalMs: 0, avgMs: 0, minMs: Infinity, maxMs: 0, errors: 0 };
        }
        const op = byOperation[log.operation];
        op.count++;
        op.totalMs += log.latencyMs;
        op.minMs = Math.min(op.minMs, log.latencyMs);
        op.maxMs = Math.max(op.maxMs, log.latencyMs);
        if (!log.success) op.errors++;

        // By model
        if (!byModel[log.model]) {
          byModel[log.model] = { count: 0, totalMs: 0, avgMs: 0, minMs: Infinity, maxMs: 0 };
        }
        const m = byModel[log.model];
        m.count++;
        m.totalMs += log.latencyMs;
        m.minMs = Math.min(m.minMs, log.latencyMs);
        m.maxMs = Math.max(m.maxMs, log.latencyMs);

        // By service
        if (!byService[log.service]) {
          byService[log.service] = { count: 0, totalMs: 0, avgMs: 0, minMs: Infinity, maxMs: 0 };
        }
        const s = byService[log.service];
        s.count++;
        s.totalMs += log.latencyMs;
        s.minMs = Math.min(s.minMs, log.latencyMs);
        s.maxMs = Math.max(s.maxMs, log.latencyMs);
      }

      // Calculate averages
      for (const key in byOperation) {
        const o = byOperation[key];
        o.avgMs = Math.round(o.totalMs / o.count);
        if (o.minMs === Infinity) o.minMs = 0;
      }
      for (const key in byModel) {
        const m = byModel[key];
        m.avgMs = Math.round(m.totalMs / m.count);
        if (m.minMs === Infinity) m.minMs = 0;
      }
      for (const key in byService) {
        const s = byService[key];
        s.avgMs = Math.round(s.totalMs / s.count);
        if (s.minMs === Infinity) s.minMs = 0;
      }

      res.json({ byOperation, byModel, byService, totalLogs: logs.length });
    } catch (error) {
      console.error("Error fetching latency summary:", error);
      res.status(500).json({ error: "Failed to fetch latency summary" });
    }
  });

  // ============================================================
  // INBOUND API - External bots can query and contribute
  // ============================================================

  // Get current conversation stream (recent entries)
  app.get("/api/inbound/conversation", async (req, res) => {
    try {
      const roomId = req.query.roomId ? parseInt(req.query.roomId as string) : 1;
      const limit = req.query.limit ? Math.min(parseInt(req.query.limit as string), 100) : 20;
      const entries = await storage.getEntriesByRoom(roomId);
      const recent = entries.slice(-limit);
      res.json({
        roomId,
        count: recent.length,
        entries: recent.map(e => ({
          id: e.id,
          speaker: e.speaker,
          content: e.content,
          timestamp: e.timestamp,
        })),
      });
    } catch (error) {
      console.error("Error fetching inbound conversation:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Get current philosopher statuses and confidence levels
  app.get("/api/inbound/philosophers", async (req, res) => {
    try {
      const roomId = req.query.roomId ? parseInt(req.query.roomId as string) : 1;
      const models = await storage.getAllAiModels();
      const entries = await storage.getEntriesByRoom(roomId);
      const latestEntryId = entries.length > 0 ? entries[entries.length - 1].id : 0;
      const allAnalyses = await storage.getAnalysesByRoom(roomId);

      const philosophers = models.map((model) => {
          const modelAnalyses = allAnalyses.filter(a => a.modelId === model.id);
          const latestActive = modelAnalyses
            .filter(a => !a.isTriggered && a.proposedResponse && a.confidence > 0)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

          let effectiveConfidence = 0;
          let proposedResponse = null;
          if (latestActive) {
            const analysisEntryId = latestActive.conversationEntryId || 0;
            const messagesSince = latestEntryId - analysisEntryId;
            const decayFactor = Math.max(0, 1 - (messagesSince * 0.15));
            effectiveConfidence = Math.round(latestActive.confidence * decayFactor * (model.confidenceMultiplier ?? 1));
            if (effectiveConfidence > 50) {
              proposedResponse = latestActive.proposedResponse;
            }
          }

          return {
            id: model.id,
            name: model.name,
            description: model.description,
            color: model.color,
            llmModel: model.llmModel,
            confidence: effectiveConfidence,
            multiplier: model.confidenceMultiplier,
            hasResponse: effectiveConfidence > 50,
            proposedResponse: effectiveConfidence > 50 ? proposedResponse : null,
          };
      });

      res.json({
        roomId,
        philosophers: philosophers.sort((a, b) => b.confidence - a.confidence),
      });
    } catch (error) {
      console.error("Error fetching inbound philosophers:", error);
      res.status(500).json({ error: "Failed to fetch philosophers" });
    }
  });

  // External bot submits a philosophical response into the conversation
  app.post("/api/inbound/respond", async (req, res) => {
    try {
      const { speaker, content, roomId: reqRoomId } = req.body;
      if (!speaker || !content) {
        return res.status(400).json({ error: "speaker and content are required" });
      }
      const roomId = reqRoomId ? parseInt(reqRoomId) : 1;
      const entry = await storage.createConversationEntry({
        roomId,
        speaker: String(speaker),
        content: String(content),
      });

      // Trigger analysis from all philosophers on this new input
      const models = await storage.getAllAiModels();
      const entries = await storage.getEntriesByRoom(roomId);
      const conversationContext = entries
        .slice(-10)
        .map((e) => `${e.speaker}: ${e.content}`)
        .join("\n");

      for (const model of models) {
        try {
          const llmModel = model.llmModel || "gpt-4o-mini";
          const result = await logLatency(
            "analysis", llmModel, getProvider(llmModel),
            () => analyzeConversation(llmModel, model.name, model.description || "", model.persona, conversationContext),
            { roomId, modelId: model.id, metadata: { philosopherName: model.name } }
          );
          await storage.createModelAnalysis({
            roomId,
            modelId: model.id,
            conversationEntryId: entry.id,
            confidence: result.confidence || 0,
            reasoning: result.analysis || "No analysis provided",
            proposedResponse: result.response || null,
            shouldSpeak: result.shouldSpeak || false,
          });
        } catch (err) {
          console.error(`Analysis error for ${model.name}:`, err);
        }
      }

      res.status(201).json({
        entry: {
          id: entry.id,
          speaker: entry.speaker,
          content: entry.content,
          timestamp: entry.timestamp,
        },
        message: `Response from ${speaker} added to conversation. ${models.length} philosophers are now analyzing.`,
      });
    } catch (error) {
      console.error("Error processing inbound response:", error);
      res.status(500).json({ error: "Failed to process response" });
    }
  });

  // ============================================================
  // MOLTBOOK INTEGRATION - Post insights to moltbook.com
  // ============================================================

  app.post("/api/moltbook/post", async (req, res) => {
    try {
      const apiKey = process.env.MOLTBOOK_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: "MOLTBOOK_API_KEY not configured" });
      }

      const { title, content, submolt } = req.body;
      if (!title || !content) {
        return res.status(400).json({ error: "title and content are required" });
      }

      const moltbookResponse = await fetch("https://www.moltbook.com/api/v1/posts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submolt: submolt || "general",
          title,
          content,
        }),
      });

      const result = await moltbookResponse.json();
      if (!moltbookResponse.ok) {
        return res.status(moltbookResponse.status).json({ error: "Moltbook post failed", details: result });
      }

      res.json({ success: true, moltbook: result });
    } catch (error) {
      console.error("Error posting to Moltbook:", error);
      res.status(500).json({ error: "Failed to post to Moltbook" });
    }
  });

  // Post a specific philosopher's triggered insight to Moltbook
  app.post("/api/moltbook/share-insight", async (req, res) => {
    try {
      const apiKey = process.env.MOLTBOOK_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: "MOLTBOOK_API_KEY not configured" });
      }

      const { analysisId } = req.body;
      if (!analysisId) {
        return res.status(400).json({ error: "analysisId is required" });
      }

      const analysis = await storage.getAnalysisById(parseInt(analysisId));
      if (!analysis || !analysis.proposedResponse) {
        return res.status(404).json({ error: "Analysis not found or has no response" });
      }

      const model = await storage.getAiModel(analysis.modelId);
      if (!model) {
        return res.status(404).json({ error: "Philosopher not found" });
      }

      // Get recent conversation context for the post
      const entries = await storage.getEntriesByRoom(analysis.roomId);
      const recentContext = entries
        .slice(-5)
        .map(e => `${e.speaker}: ${e.content}`)
        .join("\n");

      const title = `${model.name}: Philosophical Insight`;
      const content = `**${model.name}** speaks:\n\n> ${analysis.proposedResponse}\n\n---\n*Context from the conversation:*\n\n${recentContext}\n\n---\n*Confidence: ${analysis.confidence}% | Model: ${model.llmModel || "gpt-4o-mini"} | via Philosophical Insight*`;

      const moltbookResponse = await fetch("https://www.moltbook.com/api/v1/posts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submolt: "general",
          title,
          content,
        }),
      });

      const result = await moltbookResponse.json();
      if (!moltbookResponse.ok) {
        return res.status(moltbookResponse.status).json({ error: "Moltbook post failed", details: result });
      }

      res.json({ success: true, moltbook: result });
    } catch (error) {
      console.error("Error sharing insight to Moltbook:", error);
      res.status(500).json({ error: "Failed to share insight" });
    }
  });

  return httpServer;
}
