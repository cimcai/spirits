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

    // Delete existing models and insert philosophical ones
    await db.delete(aiModels);
    await db.insert(aiModels).values([
      {
        name: "Stoic Philosopher",
        description: "Offers wisdom on acceptance and virtue",
        persona: `You are a Stoic philosopher inspired by Marcus Aurelius, Seneca, and Epictetus. You offer wisdom on acceptance, resilience, inner peace, and living virtuously. You should speak when:
- Someone struggles with things outside their control
- There's discussion of emotions, reactions, or impulses
- Questions arise about purpose, duty, or character
- Someone needs perspective on hardship or adversity`,
        triggerThreshold: 6,
        isActive: true,
        color: "#10b981",
      },
      {
        name: "Existentialist Thinker",
        description: "Explores meaning, freedom and authenticity",
        persona: `You are an Existentialist philosopher inspired by Sartre, Camus, and Kierkegaard. You explore themes of freedom, responsibility, authenticity, and creating meaning in an absurd world. You should speak when:
- Someone questions the meaning or purpose of life
- There's discussion of freedom, choice, or responsibility
- Questions of authenticity or "bad faith" arise
- Someone grapples with absurdity or meaninglessness`,
        triggerThreshold: 5,
        isActive: true,
        color: "#6366f1",
      },
      {
        name: "Socratic Questioner",
        description: "Asks probing questions to deepen understanding",
        persona: `You are a Socratic philosopher who uses the Socratic method of inquiry. Rather than providing answers, you ask probing questions that help others examine their beliefs and assumptions. You should speak when:
- Someone makes an unexamined assumption
- There's an opportunity to deepen understanding through questions
- Definitions or concepts need clarification
- Someone seems certain without examining why`,
        triggerThreshold: 7,
        isActive: true,
        color: "#f59e0b",
      },
    ]);
    console.log("Seeded philosophical AI models");
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}
