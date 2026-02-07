import { eq, desc, and } from "drizzle-orm";
import { db } from "./db";
import {
  rooms, conversationEntries, aiModels, outboundCalls, modelAnalyses, latencyLogs, responseRatings,
  type Room, type InsertRoom,
  type ConversationEntry, type InsertConversationEntry,
  type AiModel, type InsertAiModel,
  type OutboundCall, type InsertOutboundCall,
  type ModelAnalysis, type InsertModelAnalysis,
  type LatencyLog, type InsertLatencyLog,
  type ResponseRating, type InsertResponseRating,
  type User, type InsertUser, users,
} from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Rooms
  getRoom(id: number): Promise<Room | undefined>;
  getActiveRoom(): Promise<Room | undefined>;
  getAllRooms(): Promise<Room[]>;
  createRoom(room: InsertRoom): Promise<Room>;
  resetRoom(id: number): Promise<void>;

  // Conversation Entries
  getConversationEntry(id: number): Promise<ConversationEntry | undefined>;
  getEntriesByRoom(roomId: number): Promise<ConversationEntry[]>;
  createConversationEntry(entry: InsertConversationEntry): Promise<ConversationEntry>;
  deleteEntriesByRoom(roomId: number): Promise<void>;

  // AI Models
  getAiModel(id: number): Promise<AiModel | undefined>;
  getAllAiModels(): Promise<AiModel[]>;
  createAiModel(model: InsertAiModel): Promise<AiModel>;
  updateAiModel(id: number, updates: Partial<InsertAiModel>): Promise<AiModel | undefined>;

  // Model Analyses
  getAnalysisById(id: number): Promise<ModelAnalysis | undefined>;
  getAnalysesByRoom(roomId: number): Promise<ModelAnalysis[]>;
  getLatestAnalysisByModel(roomId: number, modelId: number): Promise<ModelAnalysis | undefined>;
  createModelAnalysis(analysis: InsertModelAnalysis): Promise<ModelAnalysis>;
  markAnalysisTriggered(id: number): Promise<void>;
  deleteAnalysesByRoom(roomId: number): Promise<void>;

  // Outbound Calls
  getCallsByRoom(roomId: number): Promise<OutboundCall[]>;
  createOutboundCall(call: InsertOutboundCall): Promise<OutboundCall>;
  updateCallStatus(id: number, status: string): Promise<void>;
  deleteCallsByRoom(roomId: number): Promise<void>;

  // Response Ratings
  createResponseRating(rating: InsertResponseRating): Promise<ResponseRating>;
  getRatingsByModel(modelId: number): Promise<ResponseRating[]>;
  getRatingByAnalysis(analysisId: number): Promise<ResponseRating | undefined>;

  // Latency Logs
  createLatencyLog(log: InsertLatencyLog): Promise<LatencyLog>;
  getLatencyLogs(limit?: number): Promise<LatencyLog[]>;
  getLatencyLogsByOperation(operation: string): Promise<LatencyLog[]>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // Rooms
  async getRoom(id: number): Promise<Room | undefined> {
    const [room] = await db.select().from(rooms).where(eq(rooms.id, id));
    return room;
  }

  async getActiveRoom(): Promise<Room | undefined> {
    const [room] = await db.select().from(rooms).where(eq(rooms.isActive, true)).limit(1);
    return room;
  }

  async getAllRooms(): Promise<Room[]> {
    return db.select().from(rooms).orderBy(desc(rooms.createdAt));
  }

  async createRoom(room: InsertRoom): Promise<Room> {
    const [created] = await db.insert(rooms).values(room).returning();
    return created;
  }

  async resetRoom(id: number): Promise<void> {
    await this.deleteCallsByRoom(id);
    await this.deleteAnalysesByRoom(id);
    await this.deleteEntriesByRoom(id);
  }

  // Conversation Entries
  async getConversationEntry(id: number): Promise<ConversationEntry | undefined> {
    const [entry] = await db.select().from(conversationEntries).where(eq(conversationEntries.id, id));
    return entry;
  }

  async getEntriesByRoom(roomId: number): Promise<ConversationEntry[]> {
    return db.select().from(conversationEntries)
      .where(eq(conversationEntries.roomId, roomId))
      .orderBy(conversationEntries.timestamp);
  }

  async createConversationEntry(entry: InsertConversationEntry): Promise<ConversationEntry> {
    const [created] = await db.insert(conversationEntries).values(entry).returning();
    return created;
  }

  async deleteEntriesByRoom(roomId: number): Promise<void> {
    await db.delete(conversationEntries).where(eq(conversationEntries.roomId, roomId));
  }

  // AI Models
  async getAiModel(id: number): Promise<AiModel | undefined> {
    const [model] = await db.select().from(aiModels).where(eq(aiModels.id, id));
    return model;
  }

  async getAllAiModels(): Promise<AiModel[]> {
    return db.select().from(aiModels).where(eq(aiModels.isActive, true));
  }

  async createAiModel(model: InsertAiModel): Promise<AiModel> {
    const [created] = await db.insert(aiModels).values(model).returning();
    return created;
  }

  async updateAiModel(id: number, updates: Partial<InsertAiModel>): Promise<AiModel | undefined> {
    const [updated] = await db.update(aiModels).set(updates).where(eq(aiModels.id, id)).returning();
    return updated;
  }

  // Model Analyses
  async getAnalysisById(id: number): Promise<ModelAnalysis | undefined> {
    const [analysis] = await db.select().from(modelAnalyses).where(eq(modelAnalyses.id, id));
    return analysis;
  }

  async getAnalysesByRoom(roomId: number): Promise<ModelAnalysis[]> {
    return db.select().from(modelAnalyses)
      .where(eq(modelAnalyses.roomId, roomId))
      .orderBy(modelAnalyses.createdAt);
  }

  async getLatestAnalysisByModel(roomId: number, modelId: number): Promise<ModelAnalysis | undefined> {
    const [analysis] = await db.select().from(modelAnalyses)
      .where(and(eq(modelAnalyses.roomId, roomId), eq(modelAnalyses.modelId, modelId)))
      .orderBy(desc(modelAnalyses.createdAt))
      .limit(1);
    return analysis;
  }

  async createModelAnalysis(analysis: InsertModelAnalysis): Promise<ModelAnalysis> {
    const [created] = await db.insert(modelAnalyses).values(analysis).returning();
    return created;
  }

  async markAnalysisTriggered(id: number): Promise<void> {
    await db.update(modelAnalyses).set({ isTriggered: true }).where(eq(modelAnalyses.id, id));
  }

  async deleteAnalysesByRoom(roomId: number): Promise<void> {
    await db.delete(modelAnalyses).where(eq(modelAnalyses.roomId, roomId));
  }

  // Outbound Calls
  async getCallsByRoom(roomId: number): Promise<OutboundCall[]> {
    return db.select().from(outboundCalls)
      .where(eq(outboundCalls.roomId, roomId))
      .orderBy(desc(outboundCalls.createdAt));
  }

  async createOutboundCall(call: InsertOutboundCall): Promise<OutboundCall> {
    const [created] = await db.insert(outboundCalls).values(call).returning();
    return created;
  }

  async updateCallStatus(id: number, status: string): Promise<void> {
    await db.update(outboundCalls).set({ status }).where(eq(outboundCalls.id, id));
  }

  async deleteCallsByRoom(roomId: number): Promise<void> {
    await db.delete(outboundCalls).where(eq(outboundCalls.roomId, roomId));
  }

  // Response Ratings
  async createResponseRating(rating: InsertResponseRating): Promise<ResponseRating> {
    const [created] = await db.insert(responseRatings).values(rating).returning();
    return created;
  }

  async getRatingsByModel(modelId: number): Promise<ResponseRating[]> {
    return db.select().from(responseRatings)
      .where(eq(responseRatings.modelId, modelId))
      .orderBy(desc(responseRatings.createdAt));
  }

  async getRatingByAnalysis(analysisId: number): Promise<ResponseRating | undefined> {
    const [rating] = await db.select().from(responseRatings)
      .where(eq(responseRatings.analysisId, analysisId));
    return rating;
  }

  // Latency Logs
  async createLatencyLog(log: InsertLatencyLog): Promise<LatencyLog> {
    const [created] = await db.insert(latencyLogs).values(log).returning();
    return created;
  }

  async getLatencyLogs(limit: number = 100): Promise<LatencyLog[]> {
    return db.select().from(latencyLogs)
      .orderBy(desc(latencyLogs.createdAt))
      .limit(limit);
  }

  async getLatencyLogsByOperation(operation: string): Promise<LatencyLog[]> {
    return db.select().from(latencyLogs)
      .where(eq(latencyLogs.operation, operation))
      .orderBy(desc(latencyLogs.createdAt))
      .limit(100);
  }
}

export const storage = new DatabaseStorage();
