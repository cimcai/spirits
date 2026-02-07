import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Rooms - simulating audio rooms where conversations happen
export const rooms = pgTable("rooms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertRoomSchema = createInsertSchema(rooms).omit({
  id: true,
  createdAt: true,
});

export type Room = typeof rooms.$inferSelect;
export type InsertRoom = z.infer<typeof insertRoomSchema>;

// Conversation entries - text stream from the room (simulating transcribed audio)
export const conversationEntries = pgTable("conversation_entries", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  speaker: text("speaker").notNull(),
  content: text("content").notNull(),
  timestamp: timestamp("timestamp").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertConversationEntrySchema = createInsertSchema(conversationEntries).omit({
  id: true,
  timestamp: true,
});

export type ConversationEntry = typeof conversationEntries.$inferSelect;
export type InsertConversationEntry = z.infer<typeof insertConversationEntrySchema>;

// AI Models - different AI personas that analyze conversations
export const aiModels = pgTable("ai_models", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  persona: text("persona").notNull(),
  triggerThreshold: integer("trigger_threshold").default(3).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  color: text("color").default("#6366f1").notNull(),
  voice: text("voice").default("alloy").notNull(),
  llmModel: text("llm_model").default("gpt-4o-mini").notNull(),
  confidenceMultiplier: real("confidence_multiplier").default(1.0).notNull(),
});

export const insertAiModelSchema = createInsertSchema(aiModels).omit({
  id: true,
});

export type AiModel = typeof aiModels.$inferSelect;
export type InsertAiModel = z.infer<typeof insertAiModelSchema>;

// Outbound calls - triggered when a model decides to speak
export const outboundCalls = pgTable("outbound_calls", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  modelId: integer("model_id").notNull().references(() => aiModels.id, { onDelete: "cascade" }),
  triggerReason: text("trigger_reason").notNull(),
  responseContent: text("response_content").notNull(),
  status: text("status").default("pending").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertOutboundCallSchema = createInsertSchema(outboundCalls).omit({
  id: true,
  createdAt: true,
});

export type OutboundCall = typeof outboundCalls.$inferSelect;
export type InsertOutboundCall = z.infer<typeof insertOutboundCallSchema>;

// Model analysis results - stores each model's analysis of conversation
export const modelAnalyses = pgTable("model_analyses", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  modelId: integer("model_id").notNull().references(() => aiModels.id, { onDelete: "cascade" }),
  conversationEntryId: integer("conversation_entry_id").notNull().references(() => conversationEntries.id, { onDelete: "cascade" }),
  analysis: text("analysis").notNull(),
  shouldSpeak: boolean("should_speak").default(false).notNull(),
  confidence: integer("confidence").default(0).notNull(),
  proposedResponse: text("proposed_response"),
  isTriggered: boolean("is_triggered").default(false).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertModelAnalysisSchema = createInsertSchema(modelAnalyses).omit({
  id: true,
  createdAt: true,
});

export type ModelAnalysis = typeof modelAnalyses.$inferSelect;
export type InsertModelAnalysis = z.infer<typeof insertModelAnalysisSchema>;

// Response ratings - user feedback on philosopher responses
export const responseRatings = pgTable("response_ratings", {
  id: serial("id").primaryKey(),
  analysisId: integer("analysis_id").notNull().references(() => modelAnalyses.id, { onDelete: "cascade" }),
  modelId: integer("model_id").notNull().references(() => aiModels.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(), // -1 (bad), 0 (neutral), 1 (good)
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertResponseRatingSchema = createInsertSchema(responseRatings).omit({
  id: true,
  createdAt: true,
});

export type ResponseRating = typeof responseRatings.$inferSelect;
export type InsertResponseRating = z.infer<typeof insertResponseRatingSchema>;

// Pending submissions - moderation queue for external bot inputs
export const pendingSubmissions = pgTable("pending_submissions", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  speaker: text("speaker").notNull(),
  content: text("content").notNull(),
  source: text("source").default("api").notNull(),
  status: text("status").default("pending").notNull(),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  reviewedAt: timestamp("reviewed_at"),
});

export const insertPendingSubmissionSchema = createInsertSchema(pendingSubmissions).omit({
  id: true,
  status: true,
  reviewedBy: true,
  reviewNote: true,
  createdAt: true,
  reviewedAt: true,
});

export type PendingSubmission = typeof pendingSubmissions.$inferSelect;
export type InsertPendingSubmission = z.infer<typeof insertPendingSubmissionSchema>;

// Latency logs - tracks timing for every AI service call
export const latencyLogs = pgTable("latency_logs", {
  id: serial("id").primaryKey(),
  operation: text("operation").notNull(), // 'transcription' | 'analysis' | 'dialogue_generation' | 'tts'
  model: text("model").notNull(),
  service: text("service").notNull(), // 'openai' | 'anthropic' | 'openrouter'
  latencyMs: integer("latency_ms").notNull(),
  success: boolean("success").default(true).notNull(),
  error: text("error"),
  roomId: integer("room_id"),
  modelId: integer("model_id"),
  metadata: text("metadata"), // JSON string for extra info (e.g. voice, input size)
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertLatencyLogSchema = createInsertSchema(latencyLogs).omit({
  id: true,
  createdAt: true,
});

export type LatencyLog = typeof latencyLogs.$inferSelect;
export type InsertLatencyLog = z.infer<typeof insertLatencyLogSchema>;

// Re-export chat models for the integration
export * from "./models/chat";
