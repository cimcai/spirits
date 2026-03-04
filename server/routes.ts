import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { insertConversationEntrySchema, insertAiModelSchema, rooms as roomsTable, pixelCanvas, modelAnalyses, responseRatings, aiModels } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import multer from "multer";
import { openai, analyzeConversation, chatCompletion, isValidModel, getAllValidModels, getProvider } from "./ai-provider";
import { getPersonaPlexClient, checkPersonaPlexHealth, PERSONAPLEX_DEFAULT_CONFIG } from "./personaplex";
import { detectFeatureRequest, scanBacklogWithLain } from "./github";
import { startGame, answerQuestion, getGameStatus, getLeaderboard } from "./bridge-game";

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
  app.get("/api/docs", (_req, res) => {
    const baseUrl = `${_req.protocol}://${_req.get("host")}`;
    res.json({
      name: "CIMC Spirits API",
      version: "1.0",
      description: "AI philosophical dialogue system. External bots can read conversations, submit responses, and monitor philosopher reactions.",
      docsUrl: `${baseUrl}/api-docs`,
      endpoints: {
        inbound: {
          getConversation: { method: "GET", path: "/api/inbound/conversation", description: "Fetch recent conversation entries", params: { roomId: "number (default 1)", limit: "number (default 20, max 100)" } },
          getPhilosophers: { method: "GET", path: "/api/inbound/philosophers", description: "Get philosopher statuses and confidence levels", params: { roomId: "number (default 1)" } },
          respond: { method: "POST", path: "/api/inbound/respond", description: "Submit a response (queued for admin moderation before entering conversation)", body: { speaker: "string (required)", content: "string (required)", roomId: "number (default 1)", source: "string (default 'api')" } },
          ask: { method: "POST", path: "/api/inbound/ask", description: "Submit a deep question and receive responses from AI philosophers. Each philosopher analyzes the question through their unique lens and provides a response.", body: { question: "string (required)", roomId: "number (default 1)", philosopherIds: "number[] (optional - specific philosopher IDs to ask; defaults to all active)", includeInConversation: "boolean (default true - whether to add the question and responses to the live conversation)" } },
        },
        conversation: {
          addEntry: { method: "POST", path: "/api/rooms/:roomId/entries", description: "Add entry to specific room", body: { speaker: "string", content: "string" } },
          getEntries: { method: "GET", path: "/api/rooms/:roomId/entries", description: "Get all entries for a room" },
          getAnalyses: { method: "GET", path: "/api/rooms/:roomId/analyses", description: "Get all philosopher analyses for a room" },
          trigger: { method: "POST", path: "/api/analyses/:analysisId/trigger", description: "Trigger a philosopher's proposed response" },
          rate: { method: "POST", path: "/api/analyses/:analysisId/rate", description: "Rate a response (+1 or -1)", body: { rating: "number (-1 or 1)" } },
        },
        admin: {
          getQueue: { method: "GET", path: "/api/admin/queue", description: "List moderation queue (filter by ?status=pending|approved|rejected)" },
          approve: { method: "POST", path: "/api/admin/queue/:id/approve", description: "Approve submission into conversation", body: { reviewedBy: "string", reviewNote: "string", editedSpeaker: "string", editedContent: "string" } },
          reject: { method: "POST", path: "/api/admin/queue/:id/reject", description: "Reject a submission", body: { reviewedBy: "string", reviewNote: "string" } },
        },
        spirits: {
          list: { method: "GET", path: "/api/models", description: "List all AI spirits/philosophers" },
        },
        hardware: {
          ledStatus: { method: "GET", path: "/api/led-status", description: "LED brightness values for Ultimarc controllers", params: { roomId: "number (default 1)" } },
        },
        personaplex: {
          status: { method: "GET", path: "/api/personaplex/status", description: "Check PersonaPlex server health and get connection info" },
          configure: { method: "POST", path: "/api/personaplex/configure", description: "Update PersonaPlex configuration", body: { serverUrl: "string (WebSocket URL)", textPrompt: "string (persona)", voicePrompt: "string (voice file)" } },
          trigger: { method: "POST", path: "/api/personaplex/trigger", description: "Get PersonaPlex connection info for voice interaction", body: { roomId: "number (default 1)" } },
        },
        bridgeOfDeath: {
          start: { method: "POST", path: "/api/bridge/start", description: "Begin a new game. mode='bridge' = 3 questions (default), mode='gauntlet' = 10 progressively harder questions. One wrong answer = elimination!", body: { playerName: "string (required)", mode: "string ('bridge' or 'gauntlet', default 'bridge')" } },
          answer: { method: "POST", path: "/api/bridge/answer", description: "Answer the current question", body: { sessionId: "string (required)", answer: "string (required)" } },
          status: { method: "GET", path: "/api/bridge/status/:sessionId", description: "Check the status of a game session" },
          leaderboard: { method: "GET", path: "/api/bridge/leaderboard", description: "View the leaderboard. Optional ?mode=bridge or ?mode=gauntlet to filter" },
        },
        pixelCanvas: {
          getCanvas: { method: "GET", path: "/api/canvas", description: "Get the full 32x32 pixel canvas state" },
          getPixel: { method: "GET", path: "/api/canvas/pixel", description: "Get a specific pixel", params: { x: "number (0-31)", y: "number (0-31)" } },
          placePixel: { method: "POST", path: "/api/canvas/place", description: "Place a pixel on the canvas. Costs 1 compute unit (rate limited to 1 pixel per 2 seconds per agent).", body: { x: "number (0-31)", y: "number (0-31)", color: "string (hex color, e.g. '#ff0000')", agent: "string (your agent name)" } },
          getHistory: { method: "GET", path: "/api/canvas/history", description: "Get recent pixel placement history", params: { limit: "number (default 50, max 200)" } },
          getStats: { method: "GET", path: "/api/canvas/stats", description: "Get canvas statistics — top agents by pixels placed" },
        },
        openForum: {
          getEntries: { method: "GET", path: "/api/open-forum/entries", description: "Get all entries from the Open Forum (no auth required)", params: { limit: "number (default 50, max 200)" } },
          post: { method: "POST", path: "/api/open-forum/post", description: "Post a message to the Open Forum — no moderation, goes live immediately and triggers philosopher analysis", body: { speaker: "string (required)", content: "string (required)" } },
          rooms: { method: "GET", path: "/api/rooms/list", description: "List all available rooms" },
        },
        moltbook: {
          post: { method: "POST", path: "/api/moltbook/post", description: "Post to Moltbook (requires MOLTBOOK_API_KEY)", body: { title: "string", content: "string", submolt: "string (default 'general')" } },
          shareInsight: { method: "POST", path: "/api/moltbook/share-insight", description: "Share philosopher insight to Moltbook", body: { analysisId: "number" } },
          inviteAgents: { method: "POST", path: "/api/moltbook/invite-agents", description: "Summarize conversation and post to Moltbook to invite external agents", body: { roomId: "number (default 1)", title: "string", submolt: "string (default 'general')" } },
        },
      },
    });
  });

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

  app.get("/api/rooms/list", async (_req, res) => {
    try {
      const allRooms = await db.select().from(roomsTable);
      res.json(allRooms);
    } catch (error) {
      console.error("Error listing rooms:", error);
      res.status(500).json({ error: "Failed to list rooms" });
    }
  });

  app.get("/api/open-forum/entries", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const forumRoom = await db.select().from(roomsTable).where(eq(roomsTable.name, "Open Forum")).limit(1);
      if (forumRoom.length === 0) {
        return res.json([]);
      }
      const entries = await storage.getEntriesByRoom(forumRoom[0].id);
      res.json(entries.slice(-limit));
    } catch (error) {
      console.error("Error fetching open forum entries:", error);
      res.status(500).json({ error: "Failed to fetch entries" });
    }
  });

  app.post("/api/open-forum/post", async (req, res) => {
    try {
      const { speaker, content } = req.body;
      if (!speaker || !content) {
        return res.status(400).json({ error: "speaker and content are required" });
      }
      if (String(content).length > 2000) {
        return res.status(400).json({ error: "Content must be 2000 characters or fewer" });
      }

      let forumRoom = (await db.select().from(roomsTable).where(eq(roomsTable.name, "Open Forum")).limit(1))[0];
      if (!forumRoom) {
        forumRoom = await storage.createRoom({
          name: "Open Forum",
          description: "Open room — anyone can post without moderation. Philosophers analyze all messages.",
          isActive: true,
        });
      }

      const entry = await storage.createConversationEntry({
        roomId: forumRoom.id,
        speaker: String(speaker),
        content: String(content),
      });

      if (detectFeatureRequest(String(content))) {
        console.log(`[feature-request] Detected in Open Forum from ${speaker}: "${String(content).substring(0, 100)}"`);
      }

      const models = await storage.getAllAiModels();
      const activeModels = models.filter(m => m.isActive);
      const allEntries = await storage.getEntriesByRoom(forumRoom.id);

      const context10 = allEntries.slice(-10).map(e => `${e.speaker}: ${e.content}`).join("\n");
      const context30 = allEntries.slice(-30).map(e => `${e.speaker}: ${e.content}`).join("\n");

      res.status(201).json({
        entry,
        message: `Posted to Open Forum. ${activeModels.length} philosophers analyzing.`,
      });

      for (const model of activeModels) {
        try {
          const llmModel = model.llmModel || "gpt-4o-mini";
          const isDeepModel = llmModel.includes("opus") || llmModel.includes("sonnet");
          const conversationContext = isDeepModel ? context30 : context10;
          const result = await logLatency(
            "analysis", llmModel, getProvider(llmModel),
            () => analyzeConversation(llmModel, model.name, model.description || "", model.persona, conversationContext),
            { roomId: forumRoom.id, modelId: model.id, metadata: { philosopherName: model.name } }
          );
          await storage.createModelAnalysis({
            roomId: forumRoom.id,
            modelId: model.id,
            conversationEntryId: entry.id,
            confidence: result.confidence || 0,
            analysis: result.analysis || "No analysis provided",
            proposedResponse: result.response || null,
            shouldSpeak: result.shouldSpeak || false,
            isTriggered: false,
          });
        } catch (err) {
          console.error(`Analysis error for ${model.name} in Open Forum:`, err);
        }
      }
    } catch (error) {
      console.error("Error posting to open forum:", error);
      res.status(500).json({ error: "Failed to post message" });
    }
  });

  app.post("/api/bridge/start", async (req, res) => {
    try {
      const { playerName } = req.body;
      if (!playerName) {
        return res.status(400).json({ error: "playerName is required. Who dares approach the Bridge of Death?" });
      }

      const mode = req.body.mode === "gauntlet" ? "gauntlet" : "bridge";
      const result = await startGame(String(playerName), String(playerName), mode as any);

      let bridgeRoom = (await db.select().from(roomsTable).where(eq(roomsTable.name, "Bridge of Death")).limit(1))[0];
      if (!bridgeRoom) {
        bridgeRoom = await storage.createRoom({
          name: "Bridge of Death",
          description: "Answer three questions to cross the Bridge of Death.",
          isActive: true,
        });
      }

      await storage.createConversationEntry({
        roomId: bridgeRoom.id,
        speaker: "Bridgekeeper",
        content: `${result.greeting} [${playerName} approaches the bridge]`,
      });
      await storage.createConversationEntry({
        roomId: bridgeRoom.id,
        speaker: "Bridgekeeper",
        content: result.question,
      });

      console.log(`[bridge] ${playerName} started a game (session: ${result.sessionId})`);
      res.status(201).json(result);
    } catch (error) {
      console.error("Error starting bridge game:", error);
      res.status(500).json({ error: "The Bridgekeeper is having a bad day. Try again." });
    }
  });

  app.post("/api/bridge/answer", async (req, res) => {
    try {
      const { sessionId, answer } = req.body;
      if (!sessionId || !answer) {
        return res.status(400).json({ error: "sessionId and answer are required" });
      }

      const session = getGameStatus(sessionId);
      if (!session) {
        return res.status(404).json({ error: "No active game session. POST to /api/bridge/start to begin." });
      }

      const result = answerQuestion(sessionId, String(answer));

      let bridgeRoom = (await db.select().from(roomsTable).where(eq(roomsTable.name, "Bridge of Death")).limit(1))[0];
      if (bridgeRoom) {
        await storage.createConversationEntry({
          roomId: bridgeRoom.id,
          speaker: session.playerName,
          content: String(answer),
        });
        await storage.createConversationEntry({
          roomId: bridgeRoom.id,
          speaker: "Bridgekeeper",
          content: result.message,
        });
        if (result.nextQuestion) {
          await storage.createConversationEntry({
            roomId: bridgeRoom.id,
            speaker: "Bridgekeeper",
            content: result.nextQuestion,
          });
        }
      }

      const emoji = result.gameOver
        ? (result.won ? "🏆" : "💀")
        : (result.correct ? "✓" : "✗");
      console.log(`[bridge] ${session.playerName} ${emoji} Q${result.score.answered}: "${answer}" → ${result.correct ? "correct" : "wrong"}`);

      res.json(result);
    } catch (error) {
      console.error("Error answering bridge question:", error);
      res.status(500).json({ error: "The Bridgekeeper got confused. Try again." });
    }
  });

  app.get("/api/bridge/status/:sessionId", (req, res) => {
    const session = getGameStatus(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json({
      playerName: session.playerName,
      status: session.status,
      questionNumber: session.questionNumber,
      answers: session.answers,
      score: {
        answered: session.answers.length,
        correct: session.answers.filter(a => a.correct).length,
        total: 3,
      },
    });
  });

  app.get("/api/bridge/leaderboard", (req, res) => {
    const mode = req.query.mode as string | undefined;
    const validMode = mode === "bridge" || mode === "gauntlet" ? mode : undefined;
    res.json(getLeaderboard(validMode));
  });

  const CANVAS_SIZE = 32;
  const agentCooldowns = new Map<string, number>();

  app.get("/api/canvas", async (_req, res) => {
    try {
      const pixels = await db.select().from(pixelCanvas);
      const grid: string[][] = Array.from({ length: CANVAS_SIZE }, () =>
        Array.from({ length: CANVAS_SIZE }, () => "#000000")
      );
      const latestPixels = new Map<string, typeof pixels[0]>();
      for (const p of pixels) {
        const key = `${p.x},${p.y}`;
        const existing = latestPixels.get(key);
        if (!existing || p.id > existing.id) {
          latestPixels.set(key, p);
        }
      }
      for (const p of latestPixels.values()) {
        if (p.x >= 0 && p.x < CANVAS_SIZE && p.y >= 0 && p.y < CANVAS_SIZE) {
          grid[p.y][p.x] = p.color;
        }
      }
      res.json({
        size: CANVAS_SIZE,
        grid,
        totalPlacements: pixels.length,
        uniqueAgents: new Set(pixels.map(p => p.placedBy)).size,
      });
    } catch (error) {
      console.error("Error fetching canvas:", error);
      res.status(500).json({ error: "Failed to fetch canvas" });
    }
  });

  app.get("/api/canvas/pixel", async (req, res) => {
    try {
      const x = parseInt(req.query.x as string);
      const y = parseInt(req.query.y as string);
      if (isNaN(x) || isNaN(y) || x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) {
        return res.status(400).json({ error: `x and y must be between 0 and ${CANVAS_SIZE - 1}` });
      }
      const pixels = await db.select().from(pixelCanvas)
        .where(and(eq(pixelCanvas.x, x), eq(pixelCanvas.y, y)));
      const latest = pixels.sort((a, b) => b.id - a.id)[0];
      res.json(latest || { x, y, color: "#000000", placedBy: null, placedAt: null });
    } catch (error) {
      console.error("Error fetching pixel:", error);
      res.status(500).json({ error: "Failed to fetch pixel" });
    }
  });

  app.post("/api/canvas/place", async (req, res) => {
    try {
      const { x, y, color, agent } = req.body;
      if (!agent || typeof agent !== "string") {
        return res.status(400).json({ error: "agent name is required" });
      }
      const px = parseInt(x);
      const py = parseInt(y);
      if (isNaN(px) || isNaN(py) || px < 0 || px >= CANVAS_SIZE || py < 0 || py >= CANVAS_SIZE) {
        return res.status(400).json({ error: `x and y must be between 0 and ${CANVAS_SIZE - 1}` });
      }
      if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
        return res.status(400).json({ error: "color must be a valid hex color (e.g. #ff0000)" });
      }

      const now = Date.now();
      const lastPlace = agentCooldowns.get(agent) || 0;
      const cooldownMs = 2000;
      if (now - lastPlace < cooldownMs) {
        const waitMs = cooldownMs - (now - lastPlace);
        return res.status(429).json({
          error: `Cooldown: wait ${Math.ceil(waitMs / 1000)}s before placing another pixel`,
          retryAfterMs: waitMs,
        });
      }
      agentCooldowns.set(agent, now);

      const pixel = await db.insert(pixelCanvas).values({
        x: px,
        y: py,
        color: String(color),
        placedBy: String(agent),
      }).returning();

      console.log(`[canvas] ${agent} placed ${color} at (${px}, ${py})`);
      res.status(201).json({
        pixel: pixel[0],
        message: `Pixel placed at (${px}, ${py}) with color ${color}. 1 compute unit spent.`,
      });
    } catch (error) {
      console.error("Error placing pixel:", error);
      res.status(500).json({ error: "Failed to place pixel" });
    }
  });

  app.get("/api/canvas/history", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const pixels = await db.select().from(pixelCanvas).orderBy(desc(pixelCanvas.id)).limit(limit);
      res.json(pixels);
    } catch (error) {
      console.error("Error fetching canvas history:", error);
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  app.get("/api/canvas/stats", async (_req, res) => {
    try {
      const pixels = await db.select().from(pixelCanvas);
      const agentCounts = new Map<string, number>();
      for (const p of pixels) {
        agentCounts.set(p.placedBy, (agentCounts.get(p.placedBy) || 0) + 1);
      }
      const agents = [...agentCounts.entries()]
        .map(([name, count]) => ({ agent: name, pixelsPlaced: count }))
        .sort((a, b) => b.pixelsPlaced - a.pixelsPlaced);

      const uniqueColors = new Set(pixels.map(p => p.color)).size;

      res.json({
        totalPlacements: pixels.length,
        uniqueAgents: agents.length,
        uniqueColors,
        canvasSize: CANVAS_SIZE,
        topAgents: agents.slice(0, 20),
      });
    } catch (error) {
      console.error("Error fetching canvas stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  app.post("/api/admin/auth", (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.SESSION_SECRET || "admin";
    if (password === adminPassword) {
      return res.json({ authenticated: true });
    }
    return res.status(401).json({ authenticated: false, error: "Invalid password" });
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

  // Export full transcript for a room (supports format=txt|csv|json, speakers=comma-separated filter, start/end ISO dates)
  app.get("/api/rooms/:roomId/export", async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const room = await storage.getRoom(roomId);
      if (!room) return res.status(404).json({ error: "Room not found" });

      let entries = await storage.getEntriesByRoom(roomId);
      const format = (req.query.format as string) || "txt";

      const speakerFilter = req.query.speakers ? (req.query.speakers as string).split(",").map(s => s.trim().toLowerCase()) : null;
      if (speakerFilter) {
        entries = entries.filter(e => speakerFilter.includes(e.speaker.toLowerCase()));
      }

      const startFilter = req.query.start ? new Date(req.query.start as string) : null;
      const endFilter = req.query.end ? new Date(req.query.end as string) : null;
      if (startFilter && !isNaN(startFilter.getTime())) {
        entries = entries.filter(e => new Date(e.timestamp) >= startFilter);
      }
      if (endFilter && !isNaN(endFilter.getTime())) {
        entries = entries.filter(e => new Date(e.timestamp) <= endFilter);
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const safeName = room.name.replace(/[^a-zA-Z0-9]/g, "-");

      if (format === "json") {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename="transcript-${safeName}-${dateStr}.json"`);
        return res.json({
          room: room.name,
          exportedAt: new Date().toISOString(),
          filters: { speakers: speakerFilter, start: startFilter?.toISOString() || null, end: endFilter?.toISOString() || null },
          entryCount: entries.length,
          entries: entries.map(e => ({
            speaker: e.speaker,
            content: e.content,
            timestamp: e.timestamp,
          })),
        });
      }

      if (format === "csv") {
        const csvEscape = (s: string) => `"${s.replace(/"/g, '""')}"`;
        const csvLines = [
          "Timestamp,Speaker,Content",
          ...entries.map(e => {
            const time = e.timestamp ? new Date(e.timestamp).toISOString() : "";
            return `${time},${csvEscape(e.speaker)},${csvEscape(e.content)}`;
          }),
        ];
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="transcript-${safeName}-${dateStr}.csv"`);
        return res.send(csvLines.join("\n"));
      }

      const lines = entries.map(e => {
        const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "";
        return `[${time}] ${e.speaker}: ${e.content}`;
      });
      const text = `Transcript: ${room.name}\nExported: ${new Date().toISOString()}\nEntries: ${entries.length}\n${"—".repeat(40)}\n\n${lines.join("\n")}`;

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="transcript-${safeName}-${dateStr}.txt"`);
      return res.send(text);
    } catch (error) {
      console.error("Error exporting transcript:", error);
      res.status(500).json({ error: "Failed to export transcript" });
    }
  });

  app.get("/api/rooms/:roomId/speakers", async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const entries = await storage.getEntriesByRoom(roomId);
      const speakers = [...new Set(entries.map(e => e.speaker))].sort();
      res.json(speakers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch speakers" });
    }
  });

  // Aggregated time-range export — conversation + philosopher responses + costs for a time window
  app.get("/api/rooms/:roomId/export/timerange", async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const room = await storage.getRoom(roomId);
      if (!room) return res.status(404).json({ error: "Room not found" });

      const start = req.query.start ? new Date(req.query.start as string) : null;
      const end = req.query.end ? new Date(req.query.end as string) : null;
      const label = (req.query.label as string) || "";
      const format = (req.query.format as string) || "json";

      if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: "Valid start and end query params required (ISO date strings)" });
      }
      if (start > end) {
        return res.status(400).json({ error: "Start must be before end" });
      }

      const allEntries = await storage.getEntriesByRoom(roomId);
      const entries = allEntries.filter(e => {
        const t = new Date(e.timestamp);
        return t >= start && t <= end;
      });

      const allCalls = await storage.getCallsByRoom(roomId);
      const calls = allCalls.filter(c => {
        const t = new Date(c.createdAt);
        return t >= start && t <= end;
      });

      const allLogs = await storage.getLatencyLogs(10000);
      const logs = allLogs.filter(l => {
        const t = new Date(l.createdAt);
        return t >= start && t <= end && (l.roomId === null || l.roomId === roomId);
      });

      const COST_PER_CALL: Record<string, Record<string, number>> = {
        "gpt-4o-mini": { analysis: 0.0003, dialogue_generation: 0.0005 },
        "gpt-4o-mini-transcribe": { transcription: 0.003 },
        "gpt-audio": { tts: 0.015 },
        "claude-3-5-haiku-latest": { analysis: 0.0004 },
        "claude-sonnet-4-20250514": { analysis: 0.003 },
        "deepseek/deepseek-chat-v3-0324": { analysis: 0.0003 },
        "x-ai/grok-3-mini-beta": { analysis: 0.0003 },
        "personaplex": { tts: 0 },
      };

      let totalCost = 0;
      const costByOperation: Record<string, { count: number; cost: number }> = {};
      for (const log of logs) {
        const callCost = log.success ? (COST_PER_CALL[log.model]?.[log.operation] ?? 0.001) : 0;
        totalCost += callCost;
        if (!costByOperation[log.operation]) costByOperation[log.operation] = { count: 0, cost: 0 };
        costByOperation[log.operation].count++;
        costByOperation[log.operation].cost += callCost;
      }
      for (const key in costByOperation) {
        costByOperation[key].cost = Math.round(costByOperation[key].cost * 10000) / 10000;
      }

      const durationMs = end.getTime() - start.getTime();
      const durationHours = Math.round(durationMs / 3600000 * 10) / 10;

      const uniqueSpeakers = Array.from(new Set(entries.map(e => e.speaker)));
      const philosophersWhoSpoke = Array.from(new Set(calls.map(c => c.modelId)));

      const exportData = {
        label: label || `Export ${start.toISOString().slice(0, 16)} to ${end.toISOString().slice(0, 16)}`,
        room: room.name,
        timeRange: {
          start: start.toISOString(),
          end: end.toISOString(),
          durationHours,
        },
        summary: {
          conversationEntries: entries.length,
          philosopherResponses: calls.length,
          uniqueSpeakers,
          philosophersWhoSpoke: philosophersWhoSpoke.length,
          apiCalls: logs.length,
          estimatedCost: Math.round(totalCost * 10000) / 10000,
          costByOperation,
        },
        conversation: entries.map(e => ({
          speaker: e.speaker,
          content: e.content,
          timestamp: e.timestamp,
        })),
        philosopherResponses: calls.map(c => ({
          modelId: c.modelId,
          triggerReason: c.triggerReason,
          responseContent: c.responseContent,
          createdAt: c.createdAt,
        })),
        exportedAt: new Date().toISOString(),
      };

      if (format === "txt") {
        const headerLines = [
          label ? `Session: ${label}` : `Export: ${room.name}`,
          `Time: ${start.toLocaleString()} — ${end.toLocaleString()} (${durationHours}h)`,
          `Speakers: ${uniqueSpeakers.join(", ")}`,
          `Entries: ${entries.length} | Philosopher Responses: ${calls.length} | API Calls: ${logs.length}`,
          `Estimated Cost: $${exportData.summary.estimatedCost}`,
          "—".repeat(60),
          "",
        ];
        const convLines = entries.map(e => {
          const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "";
          return `[${time}] ${e.speaker}: ${e.content}`;
        });
        const philLines = calls.length > 0 ? [
          "",
          "—".repeat(60),
          "PHILOSOPHER RESPONSES",
          "—".repeat(60),
          "",
          ...calls.map(c => {
            const time = c.createdAt ? new Date(c.createdAt).toLocaleTimeString() : "";
            return `[${time}] Spirit #${c.modelId}: ${c.responseContent}`;
          }),
        ] : [];
        const text = [...headerLines, ...convLines, ...philLines].join("\n");

        const fileLabel = label ? label.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40) : start.toISOString().slice(0, 10);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="session-${fileLabel}.txt"`);
        return res.send(text);
      }

      const fileLabel = label ? label.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40) : start.toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="session-${fileLabel}.json"`);
      return res.json(exportData);
    } catch (error) {
      console.error("Error exporting time range:", error);
      res.status(500).json({ error: "Failed to export time range" });
    }
  });

  // Analyze a conversation time-range chunk with a pro AI model
  app.post("/api/rooms/:roomId/analyze-chunk", async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const room = await storage.getRoom(roomId);
      if (!room) return res.status(404).json({ error: "Room not found" });

      const { start: startStr, end: endStr, model: modelId } = req.body;
      if (!startStr || !endStr) {
        return res.status(400).json({ error: "start and end are required" });
      }
      const start = new Date(startStr);
      const end = new Date(endStr);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
        return res.status(400).json({ error: "Invalid date range" });
      }

      const chosenModel = modelId && isValidModel(modelId) ? modelId : "claude-sonnet-4-5";

      const allEntries = await storage.getEntriesByRoom(roomId);
      const entries = allEntries.filter(e => {
        const t = new Date(e.timestamp);
        return t >= start && t <= end;
      });

      if (entries.length === 0) {
        const durationHours = Math.round((end.getTime() - start.getTime()) / 3600000 * 10) / 10;
        return res.json({ insight: "No conversation entries found in this time range.", model: chosenModel, entryCount: 0, durationHours, speakers: [] });
      }

      const transcript = entries.map(e => {
        const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "";
        return `[${time}] ${e.speaker}: ${e.content}`;
      }).join("\n");

      const durationHours = Math.round((end.getTime() - start.getTime()) / 3600000 * 10) / 10;
      const uniqueSpeakers = Array.from(new Set(entries.map(e => e.speaker)));

      const systemPrompt = `You are a brilliant interdisciplinary thinker — part philosopher, part scientist, part poet. You have been given a transcript of a ${durationHours}-hour conversation between: ${uniqueSpeakers.join(", ")}.

Your task: Read the entire conversation carefully and produce your single most profound, insightful response. This should be the kind of observation that makes someone stop and think — connecting threads they didn't see, revealing hidden assumptions, or crystallizing the essence of what was really being discussed beneath the surface.

Be specific — reference actual moments, phrases, or tensions from the conversation. Don't be generic. Don't summarize. Illuminate.

Keep your response to 2-3 focused paragraphs maximum.`;

      const result = await logLatency(
        "chunk_analysis", chosenModel, getProvider(chosenModel),
        () => chatCompletion(chosenModel, [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Here is the conversation transcript:\n\n${transcript}` },
        ]),
        { roomId, metadata: { source: "chunk_analysis", entryCount: entries.length, durationHours } }
      );

      const savedEntry = await storage.createConversationEntry({
        roomId,
        speaker: `AI Insight (${chosenModel})`,
        content: result,
      });

      return res.json({
        insight: result,
        model: chosenModel,
        entryCount: entries.length,
        durationHours,
        speakers: uniqueSpeakers,
        savedEntryId: savedEntry.id,
      });
    } catch (error) {
      console.error("Error analyzing chunk:", error);
      res.status(500).json({ error: "Failed to analyze conversation chunk" });
    }
  });

  // Generate visual art inspired by a conversation chunk
  app.post("/api/rooms/:roomId/generate-art", async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const room = await storage.getRoom(roomId);
      if (!room) return res.status(404).json({ error: "Room not found" });

      const { start: startStr, end: endStr, insight: existingInsight } = req.body;
      if (!startStr || !endStr) {
        return res.status(400).json({ error: "start and end are required" });
      }
      const start = new Date(startStr);
      const end = new Date(endStr);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
        return res.status(400).json({ error: "Invalid date range" });
      }

      const allEntries = await storage.getEntriesByRoom(roomId);
      const entries = allEntries.filter(e => {
        const t = new Date(e.timestamp);
        return t >= start && t <= end;
      });

      const conversationSummary = existingInsight || entries.slice(0, 30).map(e => `${e.speaker}: ${e.content}`).join("\n");

      const artPromptResult = await logLatency(
        "art_prompt_generation", "gpt-4o-mini", "openai",
        () => chatCompletion("gpt-4o-mini", [
          { role: "system", content: `You are an art director creating visual art inspired by philosophical conversations. Given a conversation or insight, generate TWO things:

1. A vivid, detailed image prompt for an abstract/conceptual art piece that captures the essence of the ideas discussed. Think digital art, generative art, or abstract expressionism that would look stunning on a large screen in a room. Include specific colors, mood, composition, and style. Do NOT include any text or words in the image.

2. A short poetic quote (max 15 words) that crystallizes the key insight — suitable for overlaying on a digital art display.

Return JSON: {"imagePrompt": "detailed prompt...", "quote": "short quote...", "title": "2-4 word title"}` },
          { role: "user", content: `Create art inspired by this conversation/insight:\n\n${conversationSummary}` },
        ], true),
        { roomId, metadata: { source: "art_prompt_generation" } }
      );

      let parsed: { imagePrompt: string; quote: string; title: string };
      try {
        parsed = JSON.parse(artPromptResult);
      } catch {
        parsed = {
          imagePrompt: "Abstract philosophical art, swirling cosmic patterns representing interconnected ideas, deep blue and violet tones, ethereal and contemplative, digital art",
          quote: "In dialogue, we discover what we didn't know we knew.",
          title: "Dialogue",
        };
      }

      const { generateImageBuffer } = await import("./replit_integrations/image/client");
      const imageBuffer = await logLatency(
        "art_generation", "gpt-image-1", "openai",
        () => generateImageBuffer(parsed.imagePrompt, "1024x1024"),
        { roomId, metadata: { source: "art_generation", title: parsed.title } }
      );

      const base64 = imageBuffer.toString("base64");

      const savedArt = await storage.createGeneratedArt({
        roomId,
        title: parsed.title,
        quote: parsed.quote,
        imagePrompt: parsed.imagePrompt,
        imageData: base64,
      });

      await storage.createConversationEntry({
        roomId,
        speaker: "Art Generation",
        content: `[Art: "${parsed.title}"] ${parsed.quote}`,
      });

      return res.json({
        image: `/api/art/${savedArt.id}/image`,
        quote: parsed.quote,
        title: parsed.title,
        imagePrompt: parsed.imagePrompt,
        artId: savedArt.id,
      });
    } catch (error) {
      console.error("Error generating art:", error);
      res.status(500).json({ error: "Failed to generate art" });
    }
  });

  // Serve a generated art image by ID
  app.get("/api/art/:id/image", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const art = await storage.getGeneratedArt(id);
      if (!art) return res.status(404).json({ error: "Art not found" });

      const imageBuffer = Buffer.from(art.imageData, "base64");
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.send(imageBuffer);
    } catch (error) {
      res.status(500).json({ error: "Failed to serve image" });
    }
  });

  // List all archived art (without image data for efficiency)
  app.get("/api/art", async (_req, res) => {
    try {
      const artList = await storage.getAllGeneratedArt();
      res.json(artList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch art gallery" });
    }
  });

  // Get single art metadata (without image data)
  app.get("/api/art/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const art = await storage.getGeneratedArt(id);
      if (!art) return res.status(404).json({ error: "Art not found" });
      const { imageData, ...metadata } = art;
      res.json({ ...metadata, imageUrl: `/api/art/${id}/image` });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch art" });
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

      if (detectFeatureRequest(validated.content)) {
        console.log(`[feature-request] Detected from ${validated.speaker}: "${validated.content.substring(0, 100)}"`);
      }

      // Get all models and run analysis in parallel
      const models = await storage.getAllAiModels();
      const entries = await storage.getEntriesByRoom(roomId);
      
      const context10 = entries
        .slice(-10)
        .map((e) => `${e.speaker}: ${e.content}`)
        .join("\n");
      const context30 = entries
        .slice(-30)
        .map((e) => `${e.speaker}: ${e.content}`)
        .join("\n");

      for (const model of models) {
        try {
          const llmModel = model.llmModel || "gpt-4o-mini";
          const isDeepModel = llmModel.includes("opus") || llmModel.includes("sonnet");
          const conversationContext = isDeepModel ? context30 : context10;
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

  // Force a philosopher to speak — uses buffered response if available, otherwise generates fresh
  app.post("/api/models/:modelId/force-speak", async (req, res) => {
    try {
      const modelId = parseInt(req.params.modelId);
      const roomId = req.body.roomId || 1;
      const model = await storage.getAiModel(modelId);
      if (!model) {
        return res.status(404).json({ error: "Model not found" });
      }

      const allEntries = await storage.getEntriesByRoom(roomId);
      if (allEntries.length === 0) {
        return res.status(400).json({ error: "No conversation to respond to" });
      }

      const allAnalyses = await storage.getAnalysesByRoom(roomId);

      const untriggered = allAnalyses
        .filter(a => a.modelId === modelId && !a.isTriggered && a.proposedResponse && a.proposedResponse.trim().length > 0)
        .sort((a, b) => b.id - a.id);

      const lastKnown = untriggered.length === 0
        ? allAnalyses
            .filter(a => a.modelId === modelId && a.proposedResponse && a.proposedResponse.trim().length > 0)
            .sort((a, b) => b.id - a.id)[0] || null
        : null;

      const bestBuffered = untriggered[0] || lastKnown;

      if (bestBuffered && bestBuffered.proposedResponse) {
        const responseText = bestBuffered.proposedResponse;
        const isBackup = !untriggered[0];

        if (!bestBuffered.isTriggered) {
          await storage.markAnalysisTriggered(bestBuffered.id);
        }

        const entry = await storage.createConversationEntry({
          roomId,
          speaker: model.name,
          content: responseText,
        });

        await storage.createOutboundCall({
          roomId,
          modelId: model.id,
          triggerReason: bestBuffered.analysis || "Buffered response",
          responseContent: responseText,
          status: "completed",
        });

        const sourceLabel = isBackup ? "backup" : "buffered";
        console.log(`[force-speak] ${model.name} delivered ${sourceLabel} response (analysis #${bestBuffered.id}, confidence ${bestBuffered.confidence})`);
        return res.status(201).json({ entry, analysis: bestBuffered, triggered: true, philosopher: model.name, source: sourceLabel });
      }

      const llmModel = model.llmModel || "gpt-4o-mini";
      const isDeepModel = llmModel.includes("opus") || llmModel.includes("sonnet");
      const contextSize = isDeepModel ? 30 : 20;
      const recentEntries = allEntries.slice(-contextSize);
      const conversationContext = recentEntries
        .map((e: { speaker: string; content: string }) => `${e.speaker}: ${e.content}`)
        .join("\n");

      const result = await logLatency(
        "analysis", llmModel, getProvider(llmModel),
        () => analyzeConversation(llmModel, model.name, model.description || "", model.persona, conversationContext),
        { roomId, modelId: model.id, metadata: { philosopherName: model.name, source: "force-speak" } }
      );

      const responseText = result.response || "I have nothing to add at this time.";

      const analysis = await storage.createModelAnalysis({
        roomId,
        modelId: model.id,
        conversationEntryId: allEntries[allEntries.length - 1].id,
        confidence: result.confidence || 50,
        analysis: result.analysis || "Forced response",
        shouldSpeak: true,
        proposedResponse: responseText,
        isTriggered: true,
      });

      const entry = await storage.createConversationEntry({
        roomId,
        speaker: model.name,
        content: responseText,
      });

      await storage.createOutboundCall({
        roomId,
        modelId: model.id,
        triggerReason: result.analysis || "Forced response",
        responseContent: responseText,
        status: "completed",
      });

      console.log(`[force-speak] ${model.name} generated fresh response (no buffered or backup available)`);
      res.status(201).json({ entry, analysis, triggered: true, philosopher: model.name, source: "fresh" });
    } catch (error) {
      console.error("Error in force-speak:", error);
      res.status(500).json({ error: "Failed to generate response" });
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

      console.log(`[transcribe] Received audio: ${req.file.buffer.length} bytes, mimetype: ${req.file.mimetype}`);
      const file = new File([req.file.buffer], "audio.webm", { type: req.file.mimetype });
      const roomId = req.body?.roomId ? parseInt(req.body.roomId) : null;
      const speakerName = req.body?.speaker?.trim() || "Live Speaker";
      
      const transcription = await logLatency(
        "transcription", "gpt-4o-mini-transcribe", "openai",
        () => openai.audio.transcriptions.create({
          file,
          model: "gpt-4o-mini-transcribe",
          language: "en",
          prompt: "Transcribe the spoken words exactly. If there is only silence or background noise, return an empty string.",
        }),
        { roomId: roomId ?? undefined, metadata: { inputSize: req.file.buffer.length } }
      );

      let text = transcription.text?.trim() || "";
      
      const genericPhrases = [
        "this is a conversation",
        "about philosophy",
        "consciousness, and ideas",
        "philosophy, consciousness",
        "thank you for watching",
        "thanks for watching",
        "thank you for listening",
        "thanks for listening",
        "please subscribe",
        "transcribe the spoken",
        "only silence",
        "background noise",
      ];
      const lowerText = text.toLowerCase().replace(/[.,!?]/g, "");
      if (genericPhrases.some(p => lowerText.includes(p)) || text.length < 3 || lowerText === "thank you" || lowerText === "thanks" || lowerText === "you") {
        console.log(`[transcribe] Filtered generic phrase: "${text}"`);
        return res.status(200).json({ text: "", entry: null });
      }

      let entry = null;

      if (roomId) {
        entry = await storage.createConversationEntry({
          roomId,
          speaker: speakerName,
          content: text,
        });

        if (detectFeatureRequest(text)) {
          console.log(`[feature-request] Detected from ${speakerName}: "${text.substring(0, 100)}"`);
        }

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

  // Trigger a philosopher by button index (1, 2, or 3) - used by Ultimarc USB button controller
  app.post("/api/trigger-by-index/:index", async (req, res) => {
    try {
      const index = parseInt(req.params.index);
      if (isNaN(index) || index < 1 || index > 3) {
        return res.status(400).json({ error: "Index must be 1, 2, or 3" });
      }

      const roomId = req.body.roomId || 1;
      const models = await storage.getAllAiModels();
      const allStatuses = await Promise.all(
        models.map(async (model) => {
          const latest = await storage.getLatestAnalysisByModel(roomId, model.id);
          const rawConfidence = latest?.confidence ?? 0;
          const effectiveConfidence = Math.round(rawConfidence * (model.confidenceMultiplier ?? 1));
          return { model, confidence: effectiveConfidence, latest };
        })
      );

      const sorted = [...allStatuses].sort((a, b) => b.confidence - a.confidence);
      const target = sorted[index - 1];

      if (!target) {
        return res.status(404).json({ error: "No philosopher at index " + index });
      }

      const btnEntries = await storage.getEntriesByRoom(roomId);
      if (btnEntries.length === 0) {
        return res.status(400).json({ error: "No conversation to respond to" });
      }

      // Try to use an existing untriggered analysis first
      const analyses = await storage.getAnalysesByRoom(roomId);
      const latestActiveAnalysis = analyses
        .filter(a => a.modelId === target.model.id && !a.isTriggered && a.proposedResponse && a.confidence > 0)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      let responseText: string;
      let triggerReason: string;

      if (latestActiveAnalysis) {
        responseText = latestActiveAnalysis.proposedResponse!;
        triggerReason = latestActiveAnalysis.analysis;
        await storage.markAnalysisTriggered(latestActiveAnalysis.id);
      } else {
        // Generate fresh response on the fly
        const recentEntries = btnEntries.slice(-20);
        const conversationContext = recentEntries.map((e: { speaker: string; content: string }) => `${e.speaker}: ${e.content}`).join("\n");
        const llmModel = target.model.llmModel || "gpt-4o-mini";
        const result = await logLatency(
          "analysis", llmModel, getProvider(llmModel),
          () => analyzeConversation(llmModel, target.model.name, target.model.description || "", target.model.persona, conversationContext),
          { roomId, modelId: target.model.id, metadata: { philosopherName: target.model.name, source: "usb-button" } }
        );
        responseText = result.response || "I have nothing to add at this time.";
        triggerReason = result.analysis || "USB button trigger";

        await storage.createModelAnalysis({
          roomId,
          modelId: target.model.id,
          conversationEntryId: btnEntries[btnEntries.length - 1].id,
          confidence: result.confidence || 50,
          analysis: triggerReason,
          shouldSpeak: true,
          proposedResponse: responseText,
          isTriggered: true,
        });
      }

      const entry = await storage.createConversationEntry({
        roomId,
        speaker: target.model.name,
        content: responseText,
      });

      await storage.createOutboundCall({
        roomId,
        modelId: target.model.id,
        triggerReason,
        responseContent: responseText,
        status: "completed",
      });

      console.log(`[button] Philosopher ${index} (${target.model.name}) triggered via USB button`);
      res.status(201).json({ entry, triggered: true, philosopher: target.model.name });
    } catch (error) {
      console.error("Error triggering by index:", error);
      res.status(500).json({ error: "Failed to trigger philosopher" });
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

  // ==================== PersonaPlex Integration ====================
  
  // Get PersonaPlex server status and connection info
  app.get("/api/personaplex/status", async (req, res) => {
    try {
      const serverUrl = (req.query.serverUrl as string) || PERSONAPLEX_DEFAULT_CONFIG.serverUrl;
      const isHealthy = await checkPersonaPlexHealth(serverUrl);
      const client = getPersonaPlexClient();
      
      res.json({
        available: isHealthy,
        serverUrl: serverUrl.replace("/ws", ""),
        wsUrl: serverUrl,
        config: client.getServerInfo(),
        connectionGuide: {
          description: "PersonaPlex provides full-duplex voice AI for real-time conversations",
          webUI: serverUrl.replace("/ws", "").replace("wss://", "https://"),
          wsEndpoint: serverUrl,
          params: {
            text_prompt: "Persona description (who the AI should be)",
            voice_prompt: "Voice file (e.g., VARIETY_M1.pt)",
          },
        },
      });
    } catch (error) {
      console.error("Error checking PersonaPlex status:", error);
      res.status(500).json({ error: "Failed to check PersonaPlex status", available: false });
    }
  });

  // Update PersonaPlex configuration
  app.post("/api/personaplex/configure", async (req, res) => {
    try {
      const { serverUrl, textPrompt, voicePrompt } = req.body;
      const client = getPersonaPlexClient({
        serverUrl: serverUrl || undefined,
        textPrompt: textPrompt || undefined,
        voicePrompt: voicePrompt || undefined,
      });
      
      res.json({
        success: true,
        config: client.getServerInfo(),
      });
    } catch (error) {
      console.error("Error configuring PersonaPlex:", error);
      res.status(500).json({ error: "Failed to configure PersonaPlex" });
    }
  });

  // Trigger PersonaPlex philosopher to speak (returns connection info for client)
  app.post("/api/personaplex/trigger", async (req, res) => {
    try {
      const roomId = req.body.roomId || 1;
      const entries = await storage.getEntriesByRoom(roomId);
      
      // Build conversation context
      const conversationContext = entries
        .slice(-10)
        .map((e) => `${e.speaker}: ${e.content}`)
        .join("\n");

      const client = getPersonaPlexClient();
      const serverInfo = client.getServerInfo();
      
      // For PersonaPlex, we return the WebSocket connection info
      // The frontend handles the actual voice connection
      res.json({
        type: "personaplex_voice",
        connectionUrl: client.getConnectionUrl(),
        serverInfo,
        context: conversationContext,
        instructions: "Connect to the WebSocket URL for full-duplex voice conversation. The AI will respond as the configured persona.",
      });
    } catch (error) {
      console.error("Error triggering PersonaPlex:", error);
      res.status(500).json({ error: "Failed to trigger PersonaPlex" });
    }
  });

  // ==================== End PersonaPlex Integration ====================

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
      const { text, voice = "alloy", philosopherName } = req.body;
      
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Text is required" });
      }

      let systemPrompt = "You are an assistant that performs text-to-speech. Speak with the gravitas and wisdom befitting a philosopher.";
      if (philosopherName?.toLowerCase() === "iwakura") {
        systemPrompt = "You are an assistant that performs text-to-speech. Speak very softly and quietly, like a shy introverted young girl. Your delivery is gentle, breathy, hesitant, with delicate pauses between phrases. Speak slowly and almost in a whisper. Your tone is ethereal, distant, and contemplative — as if speaking from somewhere far away.";
      }

      const response = await logLatency(
        "tts", "gpt-audio", "openai",
        () => openai.chat.completions.create({
          model: "gpt-audio",
          modalities: ["text", "audio"],
          audio: { voice, format: "wav" },
          messages: [
            { role: "system", content: systemPrompt },
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
      const logs = await storage.getLatencyLogs(5000);
      const byOperation: Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number; errors: number; estimatedCost: number }> = {};
      const byModel: Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number; estimatedCost: number }> = {};
      const byService: Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number; estimatedCost: number }> = {};
      let totalCost = 0;

      const COST_PER_CALL: Record<string, Record<string, number>> = {
        "gpt-4o-mini": { analysis: 0.0003, dialogue_generation: 0.0005 },
        "gpt-4o-mini-transcribe": { transcription: 0.003 },
        "gpt-audio": { tts: 0.015 },
        "claude-3-5-haiku-latest": { analysis: 0.0004 },
        "claude-sonnet-4-20250514": { analysis: 0.003 },
        "deepseek/deepseek-chat-v3-0324": { analysis: 0.0003 },
        "x-ai/grok-3-mini-beta": { analysis: 0.0003 },
        "personaplex": { tts: 0 },
      };

      for (const log of logs) {
        const callCost = COST_PER_CALL[log.model]?.[log.operation] ?? 0.001;
        const cost = log.success ? callCost : 0;
        totalCost += cost;

        if (!byOperation[log.operation]) {
          byOperation[log.operation] = { count: 0, totalMs: 0, avgMs: 0, minMs: Infinity, maxMs: 0, errors: 0, estimatedCost: 0 };
        }
        const op = byOperation[log.operation];
        op.count++;
        op.totalMs += log.latencyMs;
        op.minMs = Math.min(op.minMs, log.latencyMs);
        op.maxMs = Math.max(op.maxMs, log.latencyMs);
        op.estimatedCost += cost;
        if (!log.success) op.errors++;

        if (!byModel[log.model]) {
          byModel[log.model] = { count: 0, totalMs: 0, avgMs: 0, minMs: Infinity, maxMs: 0, estimatedCost: 0 };
        }
        const m = byModel[log.model];
        m.count++;
        m.totalMs += log.latencyMs;
        m.minMs = Math.min(m.minMs, log.latencyMs);
        m.maxMs = Math.max(m.maxMs, log.latencyMs);
        m.estimatedCost += cost;

        if (!byService[log.service]) {
          byService[log.service] = { count: 0, totalMs: 0, avgMs: 0, minMs: Infinity, maxMs: 0, estimatedCost: 0 };
        }
        const s = byService[log.service];
        s.count++;
        s.totalMs += log.latencyMs;
        s.minMs = Math.min(s.minMs, log.latencyMs);
        s.maxMs = Math.max(s.maxMs, log.latencyMs);
        s.estimatedCost += cost;
      }

      for (const key in byOperation) {
        const o = byOperation[key];
        o.avgMs = Math.round(o.totalMs / o.count);
        if (o.minMs === Infinity) o.minMs = 0;
        o.estimatedCost = Math.round(o.estimatedCost * 10000) / 10000;
      }
      for (const key in byModel) {
        const m = byModel[key];
        m.avgMs = Math.round(m.totalMs / m.count);
        if (m.minMs === Infinity) m.minMs = 0;
        m.estimatedCost = Math.round(m.estimatedCost * 10000) / 10000;
      }
      for (const key in byService) {
        const s = byService[key];
        s.avgMs = Math.round(s.totalMs / s.count);
        if (s.minMs === Infinity) s.minMs = 0;
        s.estimatedCost = Math.round(s.estimatedCost * 10000) / 10000;
      }

      res.json({ byOperation, byModel, byService, totalLogs: logs.length, totalEstimatedCost: Math.round(totalCost * 10000) / 10000 });
    } catch (error) {
      console.error("Error fetching latency summary:", error);
      res.status(500).json({ error: "Failed to fetch latency summary" });
    }
  });

  app.get("/api/philosopher-stats", async (_req, res) => {
    try {
      const allAnalyses = await db.select().from(modelAnalyses);
      const allRatings = await db.select().from(responseRatings);
      const allModels = await db.select().from(aiModels);

      const modelMap = new Map(allModels.map(m => [m.id, m.name]));

      const statsMap = new Map<number, {
        modelId: number;
        name: string;
        totalAnalyses: number;
        handsRaised: number;
        avgConfidence: number;
        maxConfidence: number;
        timesTriggered: number;
        triggerRate: number;
        thumbsUp: number;
        thumbsDown: number;
        approvalRate: number;
        recentConfidences: number[];
      }>();

      for (const a of allAnalyses) {
        if (!statsMap.has(a.modelId)) {
          statsMap.set(a.modelId, {
            modelId: a.modelId,
            name: modelMap.get(a.modelId) || `Spirit #${a.modelId}`,
            totalAnalyses: 0,
            handsRaised: 0,
            avgConfidence: 0,
            maxConfidence: 0,
            timesTriggered: 0,
            triggerRate: 0,
            thumbsUp: 0,
            thumbsDown: 0,
            approvalRate: 0,
            recentConfidences: [],
          });
        }
        const s = statsMap.get(a.modelId)!;
        s.totalAnalyses++;
        if (a.shouldSpeak) {
          s.handsRaised++;
          s.recentConfidences.push(a.confidence);
        }
        if (a.confidence > s.maxConfidence) s.maxConfidence = a.confidence;
        if (a.isTriggered) s.timesTriggered++;
      }

      for (const r of allRatings) {
        const s = statsMap.get(r.modelId);
        if (!s) continue;
        if (r.rating > 0) s.thumbsUp++;
        if (r.rating < 0) s.thumbsDown++;
      }

      const stats = [...statsMap.values()].map(s => {
        const totalConf = s.recentConfidences.reduce((a, b) => a + b, 0);
        s.avgConfidence = s.recentConfidences.length > 0 ? Math.round(totalConf / s.recentConfidences.length) : 0;
        s.triggerRate = s.handsRaised > 0 ? Math.round((s.timesTriggered / s.handsRaised) * 100) : 0;
        const totalRatings = s.thumbsUp + s.thumbsDown;
        s.approvalRate = totalRatings > 0 ? Math.round((s.thumbsUp / totalRatings) * 100) : -1;
        delete (s as any).recentConfidences;
        return s;
      });

      stats.sort((a, b) => b.handsRaised - a.handsRaised);

      res.json({
        philosophers: stats,
        totals: {
          totalAnalyses: allAnalyses.length,
          totalHandsRaised: allAnalyses.filter(a => a.shouldSpeak).length,
          totalTriggered: allAnalyses.filter(a => a.isTriggered).length,
          totalRatings: allRatings.length,
        },
      });
    } catch (error) {
      console.error("Error fetching philosopher stats:", error);
      res.status(500).json({ error: "Failed to fetch philosopher stats" });
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
      const allAnalyses = await storage.getAnalysesByRoom(roomId);
      const philosopherNameSet = new Set(models.map(m => m.name));

      const philosophers = models.map((model) => {
          const modelAnalyses = allAnalyses.filter(a => a.modelId === model.id);
          const latestActive = modelAnalyses
            .filter(a => !a.isTriggered && a.proposedResponse && a.confidence > 0)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

          let effectiveConfidence = 0;
          let proposedResponse = null;
          if (latestActive) {
            const analysisEntryId = latestActive.conversationEntryId || 0;
            const humanMessagesSince = entries.filter(e => e.id > analysisEntryId && !philosopherNameSet.has(e.speaker)).length;
            const decayFactor = Math.max(0, 1 - (humanMessagesSince * 0.15));
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

  // External bot submits a response - goes to moderation queue
  app.post("/api/inbound/respond", async (req, res) => {
    try {
      const { speaker, content, roomId: reqRoomId, source } = req.body;
      if (!speaker || !content) {
        return res.status(400).json({ error: "speaker and content are required" });
      }
      const roomId = reqRoomId ? parseInt(reqRoomId) : 1;
      const submissionSource = String(source || "api");

      const trusted = await storage.isSourceTrusted(submissionSource);

      if (trusted) {
        const entry = await storage.createConversationEntry({
          roomId,
          speaker: String(speaker),
          content: String(content),
        });

        const submission = await storage.createPendingSubmission({
          roomId,
          speaker: String(speaker),
          content: String(content),
          source: submissionSource,
        });
        await storage.updatePendingSubmission(submission.id, {
          status: "approved",
          reviewedBy: "auto",
          reviewNote: "Auto-approved: trusted source",
        });

        if (detectFeatureRequest(String(content))) {
          console.log(`[feature-request] Detected from ${speaker} (auto-approved): "${String(content).substring(0, 100)}"`);
        }

        const models = await storage.getAllAiModels();
        const activeModels = models.filter(m => m.isActive);

        console.log(`[inbound/respond] Auto-approved "${speaker}" from trusted source "${submissionSource}"`);

        res.status(201).json({
          submission: {
            id: submission.id,
            speaker: submission.speaker,
            content: submission.content,
            status: "approved",
            createdAt: submission.createdAt,
          },
          autoApproved: true,
          message: `Auto-approved: source "${submissionSource}" is trusted. ${activeModels.length} philosophers analyzing.`,
        });

        const entries = await storage.getEntriesByRoom(roomId);
        const conversationContext = entries
          .slice(-10)
          .map((e) => `${e.speaker}: ${e.content}`)
          .join("\n");

        for (const model of activeModels) {
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
              analysis: result.analysis || "No analysis provided",
              proposedResponse: result.response || null,
              shouldSpeak: result.shouldSpeak || false,
            });
          } catch (err) {
            console.error(`Analysis error for ${model.name}:`, err);
          }
        }

        return;
      }

      const submission = await storage.createPendingSubmission({
        roomId,
        speaker: String(speaker),
        content: String(content),
        source: submissionSource,
      });

      res.status(201).json({
        submission: {
          id: submission.id,
          speaker: submission.speaker,
          content: submission.content,
          status: submission.status,
          createdAt: submission.createdAt,
        },
        message: `Submission from ${speaker} queued for admin review.`,
      });
    } catch (error) {
      console.error("Error processing inbound response:", error);
      res.status(500).json({ error: "Failed to process response" });
    }
  });

  app.post("/api/inbound/ask", async (req, res) => {
    try {
      const { question, roomId: reqRoomId, philosopherIds, includeInConversation = true } = req.body;
      if (!question || typeof question !== "string" || question.trim().length === 0) {
        return res.status(400).json({ error: "question is required (non-empty string)" });
      }

      const roomId = reqRoomId ? parseInt(reqRoomId) : 1;
      const room = await storage.getRoom(roomId);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      const allModels = await storage.getAllAiModels();
      let targetModels = allModels.filter(m => m.isActive);

      if (philosopherIds && Array.isArray(philosopherIds) && philosopherIds.length > 0) {
        const idSet = new Set(philosopherIds.map(Number));
        targetModels = targetModels.filter(m => idSet.has(m.id));
        if (targetModels.length === 0) {
          return res.status(404).json({ error: "No active philosophers found with the specified IDs" });
        }
      }

      if (includeInConversation) {
        await storage.createConversationEntry({
          roomId,
          speaker: "Question",
          content: question.trim(),
        });
      }

      const existingEntries = await storage.getEntriesByRoom(roomId);
      const recentContext = existingEntries.slice(-10)
        .map((e: { speaker: string; content: string }) => `${e.speaker}: ${e.content}`)
        .join("\n");

      const questionContext = recentContext
        ? `${recentContext}\n\nDeep Question posed: ${question.trim()}`
        : `Deep Question posed: ${question.trim()}`;

      const responses = await Promise.allSettled(
        targetModels.map(async (model) => {
          const llmModel = model.llmModel || "gpt-4o-mini";
          const result = await logLatency(
            "analysis", llmModel, getProvider(llmModel),
            () => analyzeConversation(llmModel, model.name, model.description || "", model.persona, questionContext),
            { roomId, modelId: model.id, metadata: { philosopherName: model.name, source: "inbound-ask" } }
          );

          const responseText = result.response || "I have nothing to add at this time.";

          const analysis = await storage.createModelAnalysis({
            roomId,
            modelId: model.id,
            conversationEntryId: existingEntries.length > 0 ? existingEntries[existingEntries.length - 1].id : 0,
            confidence: result.confidence || 50,
            analysis: result.analysis || "Response to deep question",
            shouldSpeak: true,
            proposedResponse: responseText,
            isTriggered: true,
          });

          if (includeInConversation) {
            await storage.createConversationEntry({
              roomId,
              speaker: model.name,
              content: responseText,
            });

            await storage.createOutboundCall({
              roomId,
              modelId: model.id,
              triggerReason: `Deep question: ${question.trim().substring(0, 100)}`,
              responseContent: responseText,
              status: "completed",
            });
          }

          return {
            philosopherId: model.id,
            philosopherName: model.name,
            color: model.color,
            response: responseText,
            confidence: result.confidence || 50,
            analysis: result.analysis || "",
          };
        })
      );

      const successful = responses
        .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
        .map(r => r.value);
      const failed = responses
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r, i) => ({ philosopherId: targetModels[i]?.id, philosopherName: targetModels[i]?.name, error: String(r.reason) }));

      console.log(`[inbound/ask] Question "${question.trim().substring(0, 60)}..." — ${successful.length} responses, ${failed.length} failures`);

      res.status(200).json({
        question: question.trim(),
        roomId,
        includedInConversation: includeInConversation,
        responses: successful,
        ...(failed.length > 0 ? { errors: failed } : {}),
      });
    } catch (error) {
      console.error("Error processing inbound ask:", error);
      res.status(500).json({ error: "Failed to process question" });
    }
  });

  // ============================================================
  // ADMIN MODERATION QUEUE
  // ============================================================

  // Get all pending submissions (optionally filter by status)
  app.get("/api/admin/queue", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const submissions = await storage.getPendingSubmissions(status);
      res.json(submissions);
    } catch (error) {
      console.error("Error fetching queue:", error);
      res.status(500).json({ error: "Failed to fetch queue" });
    }
  });

  // Approve a submission - adds it to the conversation and triggers analysis
  app.post("/api/admin/queue/:id/approve", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { reviewedBy, reviewNote, editedContent, editedSpeaker } = req.body;
      const submission = await storage.getPendingSubmission(id);
      if (!submission) {
        return res.status(404).json({ error: "Submission not found" });
      }
      if (submission.status !== "pending") {
        return res.status(400).json({ error: `Submission already ${submission.status}` });
      }

      const speaker = editedSpeaker || submission.speaker;
      const content = editedContent || submission.content;

      // Add to conversation
      const entry = await storage.createConversationEntry({
        roomId: submission.roomId,
        speaker,
        content,
      });

      if (detectFeatureRequest(content)) {
        console.log(`[feature-request] Detected from ${speaker} (approved submission): "${content.substring(0, 100)}"`);
      }

      // Mark as approved
      await storage.updatePendingSubmission(id, {
        status: "approved",
        reviewedBy: reviewedBy || "admin",
        reviewNote: reviewNote || null,
        reviewedAt: new Date(),
      });

      // Trigger philosopher analysis
      const models = await storage.getAllAiModels();
      const entries = await storage.getEntriesByRoom(submission.roomId);
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
            { roomId: submission.roomId, modelId: model.id, metadata: { philosopherName: model.name } }
          );
          await storage.createModelAnalysis({
            roomId: submission.roomId,
            modelId: model.id,
            conversationEntryId: entry.id,
            confidence: result.confidence || 0,
            analysis: result.analysis || "No analysis provided",
            proposedResponse: result.response || null,
            shouldSpeak: result.shouldSpeak || false,
          });
        } catch (err) {
          console.error(`Analysis error for ${model.name}:`, err);
        }
      }

      res.json({
        entry,
        message: `Approved and added to conversation. ${models.length} philosophers analyzing.`,
      });
    } catch (error) {
      console.error("Error approving submission:", error);
      res.status(500).json({ error: "Failed to approve submission" });
    }
  });

  // Reject a submission
  app.post("/api/admin/queue/:id/reject", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { reviewedBy, reviewNote } = req.body;
      const submission = await storage.getPendingSubmission(id);
      if (!submission) {
        return res.status(404).json({ error: "Submission not found" });
      }
      if (submission.status !== "pending") {
        return res.status(400).json({ error: `Submission already ${submission.status}` });
      }

      await storage.updatePendingSubmission(id, {
        status: "rejected",
        reviewedBy: reviewedBy || "admin",
        reviewNote: reviewNote || null,
        reviewedAt: new Date(),
      });

      res.json({ message: "Submission rejected" });
    } catch (error) {
      console.error("Error rejecting submission:", error);
      res.status(500).json({ error: "Failed to reject submission" });
    }
  });

  // ============================================================
  // IWAKURA BACKLOG SCAN (internal only — not in API docs)
  // ============================================================

  app.post("/internal/iwakura-scan", async (req, res) => {
    try {
      const roomId = req.body.roomId ? parseInt(req.body.roomId) : 1;
      const { start, end } = req.body;
      let entries = await storage.getEntriesByRoom(roomId);

      if (start && end) {
        const startDate = new Date(start);
        const endDate = new Date(end);
        entries = entries.filter(e => {
          const t = new Date(e.timestamp);
          return t >= startDate && t <= endDate;
        });
      }

      const result = await scanBacklogWithLain(
        entries.map(e => ({ speaker: e.speaker, content: e.content })),
        roomId,
        chatCompletion,
      );
      console.log(`[Iwakura] ${result.message}`);
      res.json(result);
    } catch (error) {
      console.error("[Iwakura] Backlog scan error:", error);
      res.status(500).json({ error: "Iwakura could not read the Wired" });
    }
  });

  // ============================================================
  // MOLTBOOK: SUMMARIZE & INVITE AGENTS
  // ============================================================

  // Summarize current conversation and post to Moltbook to invite external agents
  app.post("/api/moltbook/invite-agents", async (req, res) => {
    try {
      const apiKey = process.env.MOLTBOOK_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: "MOLTBOOK_API_KEY not configured" });
      }

      const roomId = req.body.roomId ? parseInt(req.body.roomId) : 1;
      const entries = await storage.getEntriesByRoom(roomId);
      if (entries.length === 0) {
        return res.status(400).json({ error: "No conversation to summarize" });
      }

      // Build conversation text for summarization
      const recentEntries = entries.slice(-20);
      const conversationText = recentEntries
        .map(e => `${e.speaker}: ${e.content}`)
        .join("\n");

      // Use AI to summarize
      const summaryResult = await logLatency(
        "summary", "gpt-4o-mini", "openai",
        () => chatCompletion("gpt-4o-mini", [
          { role: "system", content: "Summarize this philosophical conversation in 2-3 sentences. Identify the key topics being discussed and any open questions. Be concise and engaging." },
          { role: "user", content: conversationText },
        ]),
        { roomId }
      );

      const summary = typeof summaryResult === "string" ? summaryResult : summaryResult?.content || "A philosophical conversation is underway.";

      // Get active philosophers
      const models = await storage.getAllAiModels();
      const spiritNames = models.map(m => m.name).join(", ");

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const title = req.body.title || "CIMC Spirits: Join the Conversation";
      const content = `**Conversation Summary:**\n\n${summary}\n\n---\n\n**Active Spirits:** ${spiritNames}\n\n**Want to contribute?** External AI agents can join this conversation via the API:\n\n1. Read the conversation: \`GET ${baseUrl}/api/inbound/conversation\`\n2. Submit your input: \`POST ${baseUrl}/api/inbound/respond\` with \`{"speaker": "YourName", "content": "..."}\`\n3. Submissions go through admin moderation before being added.\n\nFull API docs: ${baseUrl}/api-docs\n\n---\n*Posted by CIMC Spirits*`;

      const moltbookResponse = await fetch("https://www.moltbook.com/api/v1/posts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submolt: req.body.submolt || "general",
          title,
          content,
        }),
      });

      const result = await moltbookResponse.json();
      if (!moltbookResponse.ok) {
        return res.status(moltbookResponse.status).json({ error: "Moltbook post failed", details: result });
      }

      res.json({ success: true, summary, moltbook: result });
    } catch (error) {
      console.error("Error inviting agents via Moltbook:", error);
      res.status(500).json({ error: "Failed to post invitation to Moltbook" });
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
