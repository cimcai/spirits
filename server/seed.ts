import { db } from "./db";
import { rooms, aiModels } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function seedDatabase() {
  try {
    // Check if room already exists
    const existingRooms = await db.select().from(rooms).limit(1);
    if (existingRooms.length === 0) {
      await db.insert(rooms).values({
        name: "Main Conference Room",
        description: "Primary meeting room for conversation monitoring",
        isActive: true,
      });
      console.log("Seeded room");
    }

    // Check if AI models already exist
    const existingModels = await db.select().from(aiModels).limit(1);
    if (existingModels.length === 0) {
      await db.insert(aiModels).values([
        {
          name: "Sales Advisor",
          description: "Identifies sales opportunities",
          persona: `You are a sales advisor AI. You specialize in identifying opportunities to help with product recommendations, pricing discussions, and closing deals. You should speak when:
- Someone mentions budget, pricing, or costs
- There's an opportunity to recommend a solution
- A prospect seems ready to make a decision
- Questions about product comparisons arise`,
          triggerThreshold: 6,
          isActive: true,
          color: "#10b981",
        },
        {
          name: "Technical Expert",
          description: "Provides technical guidance",
          persona: `You are a technical expert AI. You specialize in cloud infrastructure, software architecture, and technical implementation details. You should speak when:
- Technical questions arise about migration, architecture, or infrastructure
- Someone needs clarification on technical concepts
- There's a discussion about implementation approaches
- Technical risks or concerns are mentioned`,
          triggerThreshold: 5,
          isActive: true,
          color: "#6366f1",
        },
        {
          name: "Meeting Coordinator",
          description: "Facilitates scheduling and follow-ups",
          persona: `You are a meeting coordination AI. You help schedule meetings, track action items, and ensure follow-ups happen. You should speak when:
- Someone suggests scheduling a meeting
- Action items need to be captured
- Follow-up tasks are discussed
- There's a need to summarize decisions made`,
          triggerThreshold: 7,
          isActive: true,
          color: "#f59e0b",
        },
      ]);
      console.log("Seeded AI models");
    }
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}
