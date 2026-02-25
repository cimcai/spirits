import { chatCompletion } from "./ai-provider";

interface GameSession {
  playerId: string;
  playerName: string;
  questionNumber: number;
  questions: { question: string; answer: string; category: string }[];
  answers: { question: string; playerAnswer: string; correct: boolean }[];
  status: "active" | "won" | "lost";
  startedAt: Date;
  lastActivityAt: Date;
}

const activeSessions = new Map<string, GameSession>();

const BRIDGEKEEPER_LINES = {
  greeting: [
    "STOP! Who would cross the Bridge of Death must answer me these questions three, ere the other side he see.",
    "HALT! None shall pass without answering THREE questions!",
    "STOP! What... is your quest? No wait — first, answer me these questions three!",
  ],
  correct: [
    "Right. Off you go.",
    "...yes, that's correct.",
    "Very well.",
    "Hmm. You know that one.",
  ],
  wrong: [
    "WRONG! *AAAARGH!* Into the Gorge of Eternal Peril with you!",
    "No! WRONG ANSWER! You are cast into the abyss!",
    "Incorrect! The Gorge of Eternal Peril awaits thee!",
    "That is... WRONG! *flings you off the bridge*",
  ],
  victory: [
    "Right. Off you go. ...wait, I didn't expect that. Well played.",
    "You have answered the three questions. You may cross the Bridge of Death. *grudgingly steps aside*",
    "Impossible! No one ever... fine. Cross the bridge. But I'll get you next time!",
  ],
  taunt: [
    "What? Are you afraid? Come on then!",
    "The bridge awaits, brave soul. Or coward, as the case may be.",
    "I haven't got all day. Well, actually I have. I'm a bridgekeeper.",
  ],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function generateQuestions(): Promise<{ question: string; answer: string; category: string }[]> {
  const categories = [
    "philosophy", "science", "history", "literature", "mythology",
    "mathematics", "art", "technology", "geography", "music",
  ];
  const chosen = [];
  const used = new Set<string>();
  while (chosen.length < 3) {
    const cat = categories[Math.floor(Math.random() * categories.length)];
    if (!used.has(cat)) {
      used.add(cat);
      chosen.push(cat);
    }
  }

  const prompt = `Generate exactly 3 trivia questions for a Monty Python "Bridge of Death" style game. The questions should range from easy to tricky (question 3 should be the hardest). Use these categories: ${chosen.join(", ")}.

Requirements:
- Questions should be specific and have ONE clear correct answer
- Mix difficulty: Q1 = easy, Q2 = medium, Q3 = hard/tricky (like "What is the airspeed velocity of an unladen swallow?")
- Keep questions short and punchy
- Answers should be brief (1-5 words)

Return ONLY valid JSON array, no other text:
[{"question": "...", "answer": "...", "category": "${chosen[0]}"},{"question": "...", "answer": "...", "category": "${chosen[1]}"},{"question": "...", "answer": "...", "category": "${chosen[2]}"}]`;

  const content = await chatCompletion(
    "gpt-4o-mini",
    [{ role: "user", content: prompt }],
    true
  );

  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(content);
  } catch {
    return [
      { question: "What is your name?", answer: "flexible", category: "identity" },
      { question: "What is your quest?", answer: "flexible", category: "purpose" },
      { question: "What is the airspeed velocity of an unladen swallow?", answer: "African or European?", category: "ornithology" },
    ];
  }
}

function checkAnswer(playerAnswer: string, correctAnswer: string): boolean {
  const normalize = (s: string) => s.toLowerCase().trim()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[.,!?;:'"]/g, "")
    .replace(/\s+/g, " ");

  const p = normalize(playerAnswer);
  const c = normalize(correctAnswer);

  if (p === c) return true;
  if (c.includes(p) || p.includes(c)) return true;
  if (c === "flexible") return true;

  const pWords = new Set(p.split(" "));
  const cWords = new Set(c.split(" "));
  const overlap = [...pWords].filter(w => cWords.has(w) && w.length > 2).length;
  if (overlap >= Math.ceil(cWords.size * 0.6)) return true;

  return false;
}

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, session] of activeSessions) {
    if (session.lastActivityAt.getTime() < cutoff) {
      activeSessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

export async function startGame(playerId: string, playerName: string): Promise<{
  sessionId: string;
  greeting: string;
  question: string;
  questionNumber: number;
  category: string;
}> {
  const questions = await generateQuestions();
  const sessionId = `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const session: GameSession = {
    playerId,
    playerName,
    questionNumber: 1,
    questions,
    answers: [],
    status: "active",
    startedAt: new Date(),
    lastActivityAt: new Date(),
  };

  activeSessions.set(sessionId, session);

  return {
    sessionId,
    greeting: pick(BRIDGEKEEPER_LINES.greeting),
    question: `Question the First: ${questions[0].question}`,
    questionNumber: 1,
    category: questions[0].category,
  };
}

export function answerQuestion(sessionId: string, answer: string): {
  correct: boolean;
  message: string;
  gameOver: boolean;
  won: boolean;
  nextQuestion?: string;
  nextQuestionNumber?: number;
  nextCategory?: string;
  correctAnswer?: string;
  score: { answered: number; correct: number; total: number };
} {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return {
      correct: false,
      message: "No active game session found. POST to /api/bridge/start to begin a new game.",
      gameOver: true,
      won: false,
      score: { answered: 0, correct: 0, total: 3 },
    };
  }

  if (session.status !== "active") {
    return {
      correct: false,
      message: session.status === "won"
        ? "You already crossed the bridge! Start a new game if you dare."
        : "You were already cast into the Gorge of Eternal Peril! Start a new game.",
      gameOver: true,
      won: session.status === "won",
      score: { answered: session.answers.length, correct: session.answers.filter(a => a.correct).length, total: 3 },
    };
  }

  session.lastActivityAt = new Date();
  const currentQ = session.questions[session.questionNumber - 1];
  const isCorrect = checkAnswer(answer, currentQ.answer);

  session.answers.push({
    question: currentQ.question,
    playerAnswer: answer,
    correct: isCorrect,
  });

  const score = {
    answered: session.answers.length,
    correct: session.answers.filter(a => a.correct).length,
    total: 3,
  };

  if (!isCorrect) {
    session.status = "lost";
    return {
      correct: false,
      message: `${pick(BRIDGEKEEPER_LINES.wrong)} The correct answer was: "${currentQ.answer}". You answered ${score.correct} of ${score.total} correctly. You have been flung into the Gorge of Eternal Peril!`,
      gameOver: true,
      won: false,
      correctAnswer: currentQ.answer,
      score,
    };
  }

  if (session.questionNumber >= 3) {
    session.status = "won";
    return {
      correct: true,
      message: `${pick(BRIDGEKEEPER_LINES.correct)} ${pick(BRIDGEKEEPER_LINES.victory)} You answered all ${score.total} questions correctly!`,
      gameOver: true,
      won: true,
      score,
    };
  }

  session.questionNumber++;
  const nextQ = session.questions[session.questionNumber - 1];
  const ordinal = session.questionNumber === 2 ? "Second" : "Third";

  return {
    correct: true,
    message: pick(BRIDGEKEEPER_LINES.correct),
    gameOver: false,
    won: false,
    nextQuestion: `Question the ${ordinal}: ${nextQ.question}`,
    nextQuestionNumber: session.questionNumber,
    nextCategory: nextQ.category,
    score,
  };
}

export function getGameStatus(sessionId: string): GameSession | null {
  return activeSessions.get(sessionId) || null;
}

export function getLeaderboard(): { playerName: string; won: boolean; score: number; time: number }[] {
  const results: { playerName: string; won: boolean; score: number; time: number }[] = [];
  for (const session of activeSessions.values()) {
    if (session.status !== "active") {
      results.push({
        playerName: session.playerName,
        won: session.status === "won",
        score: session.answers.filter(a => a.correct).length,
        time: session.lastActivityAt.getTime() - session.startedAt.getTime(),
      });
    }
  }
  return results
    .sort((a, b) => b.score - a.score || a.time - b.time)
    .slice(0, 20);
}
