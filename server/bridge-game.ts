import { chatCompletion } from "./ai-provider";

type GameMode = "bridge" | "gauntlet";

interface GameSession {
  playerId: string;
  playerName: string;
  mode: GameMode;
  questionNumber: number;
  totalQuestions: number;
  questions: { question: string; answer: string; category: string; difficulty: string }[];
  answers: { question: string; playerAnswer: string; correct: boolean; difficulty: string }[];
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

const GAUNTLET_LINES = {
  greeting: [
    "Welcome to The Gauntlet, foolish mortal. TEN questions stand between you and glory. One wrong answer and you're DONE.",
    "Ah, a brave one! The Gauntlet demands perfection — 10 questions, each harder than the last. Fail once and you fall.",
    "So you think you're clever? The Gauntlet has broken the wisest minds. 10 questions. Zero mercy. Begin!",
  ],
  correct: [
    "Correct. Don't get cocky.",
    "Right... but it gets harder from here.",
    "Lucky guess? Or do you actually know things?",
    "Fine. You got that one.",
    "Impressive. But the next one will break you.",
    "Not bad. Not bad at all.",
    "You're still standing. Barely.",
    "Hmm, the challenger persists...",
  ],
  halfway: [
    "Five down, five to go. You're in the deep water now.",
    "Halfway through! Most don't make it this far. The questions only get nastier.",
    "You've survived five. But the second half is where champions are made... or destroyed.",
  ],
  wrong: [
    "WRONG! The Gauntlet claims another victim! You fell at step %d of 10!",
    "Incorrect! So close, yet so far! Eliminated at step %d!",
    "That's WRONG! The Gauntlet devours you at step %d! *trapdoor opens*",
    "FAILURE at step %d! The Gauntlet shows no mercy!",
  ],
  victory: [
    "IMPOSSIBLE! You've completed The Gauntlet! 10 for 10! You are a true champion of knowledge!",
    "I... I can't believe it. Perfect score. The Gauntlet bows to you. You are LEGENDARY.",
    "TEN OUT OF TEN?! In all my years... you've done the impossible. The Gauntlet acknowledges your supremacy!",
  ],
};

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function generateQuestions(count: number): Promise<{ question: string; answer: string; category: string; difficulty: string }[]> {
  const categories = [
    "philosophy", "science", "history", "literature", "mythology",
    "mathematics", "art", "technology", "geography", "music",
    "astronomy", "biology", "psychology", "linguistics", "economics",
  ];
  const chosen: string[] = [];
  const used = new Set<string>();
  while (chosen.length < count) {
    const cat = categories[Math.floor(Math.random() * categories.length)];
    if (!used.has(cat) || chosen.length >= categories.length) {
      used.add(cat);
      chosen.push(cat);
    }
  }

  const difficulties = count === 3
    ? ["easy", "medium", "hard"]
    : ["easy", "easy", "medium", "medium", "medium", "hard", "hard", "hard", "expert", "expert"];

  const prompt = `Generate exactly ${count} trivia questions for a quiz game. Each question gets progressively harder.

Categories to use (one per question): ${chosen.join(", ")}
Difficulties in order: ${difficulties.join(", ")}

Requirements:
- Each question must have ONE clear, specific correct answer
- Easy = common knowledge, Medium = educated guess, Hard = specialist knowledge, Expert = obscure/tricky
- Questions should be short and punchy (1-2 sentences max)
- Answers should be brief (1-5 words)
- Make expert questions genuinely challenging — trick questions, obscure facts, or counterintuitive answers welcome
- Do NOT repeat themes across questions

Return ONLY valid JSON array, no other text:
[${chosen.map((cat, i) => `{"question": "...", "answer": "...", "category": "${cat}", "difficulty": "${difficulties[i]}"}`).join(",")}]`;

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
    const fallback = [
      { question: "What is your name?", answer: "flexible", category: "identity", difficulty: "easy" },
      { question: "What is your quest?", answer: "flexible", category: "purpose", difficulty: "easy" },
      { question: "What is the airspeed velocity of an unladen swallow?", answer: "African or European?", category: "ornithology", difficulty: "expert" },
    ];
    while (fallback.length < count) {
      fallback.push({ question: "What is the meaning of life?", answer: "42", category: "philosophy", difficulty: "hard" });
    }
    return fallback.slice(0, count);
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

export async function startGame(playerId: string, playerName: string, mode: GameMode = "bridge"): Promise<{
  sessionId: string;
  mode: GameMode;
  totalQuestions: number;
  greeting: string;
  question: string;
  questionNumber: number;
  category: string;
  difficulty: string;
}> {
  const totalQuestions = mode === "gauntlet" ? 10 : 3;
  const questions = await generateQuestions(totalQuestions);
  const sessionId = `${mode}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const session: GameSession = {
    playerId,
    playerName,
    mode,
    questionNumber: 1,
    totalQuestions,
    questions,
    answers: [],
    status: "active",
    startedAt: new Date(),
    lastActivityAt: new Date(),
  };

  activeSessions.set(sessionId, session);

  const lines = mode === "gauntlet" ? GAUNTLET_LINES : BRIDGEKEEPER_LINES;

  return {
    sessionId,
    mode,
    totalQuestions,
    greeting: pick(lines.greeting),
    question: `Question the ${ORDINALS[0]}: ${questions[0].question}`,
    questionNumber: 1,
    category: questions[0].category,
    difficulty: questions[0].difficulty,
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
  nextDifficulty?: string;
  correctAnswer?: string;
  score: { answered: number; correct: number; total: number };
  mode: GameMode;
} {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return {
      correct: false,
      message: "No active game session found. Start a new game.",
      gameOver: true,
      won: false,
      score: { answered: 0, correct: 0, total: 3 },
      mode: "bridge",
    };
  }

  const lines = session.mode === "gauntlet" ? GAUNTLET_LINES : BRIDGEKEEPER_LINES;

  if (session.status !== "active") {
    return {
      correct: false,
      message: session.status === "won"
        ? "You already won! Start a new game if you dare."
        : "You already fell! Start a new game.",
      gameOver: true,
      won: session.status === "won",
      score: { answered: session.answers.length, correct: session.answers.filter(a => a.correct).length, total: session.totalQuestions },
      mode: session.mode,
    };
  }

  session.lastActivityAt = new Date();
  const currentQ = session.questions[session.questionNumber - 1];
  const isCorrect = checkAnswer(answer, currentQ.answer);

  session.answers.push({
    question: currentQ.question,
    playerAnswer: answer,
    correct: isCorrect,
    difficulty: currentQ.difficulty,
  });

  const score = {
    answered: session.answers.length,
    correct: session.answers.filter(a => a.correct).length,
    total: session.totalQuestions,
  };

  if (!isCorrect) {
    session.status = "lost";
    const wrongMsg = session.mode === "gauntlet"
      ? pick(GAUNTLET_LINES.wrong).replace("%d", String(session.questionNumber))
      : pick(BRIDGEKEEPER_LINES.wrong);
    return {
      correct: false,
      message: `${wrongMsg} The correct answer was: "${currentQ.answer}". You scored ${score.correct} of ${score.total}.`,
      gameOver: true,
      won: false,
      correctAnswer: currentQ.answer,
      score,
      mode: session.mode,
    };
  }

  if (session.questionNumber >= session.totalQuestions) {
    session.status = "won";
    return {
      correct: true,
      message: `${pick(lines.correct)} ${pick(lines.victory)} Perfect score: ${score.total}/${score.total}!`,
      gameOver: true,
      won: true,
      score,
      mode: session.mode,
    };
  }

  session.questionNumber++;
  const nextQ = session.questions[session.questionNumber - 1];
  const ordinal = ORDINALS[session.questionNumber - 1] || `#${session.questionNumber}`;

  let extraMsg = "";
  if (session.mode === "gauntlet" && session.questionNumber === 6) {
    extraMsg = " " + pick(GAUNTLET_LINES.halfway);
  }

  return {
    correct: true,
    message: `${pick(lines.correct)}${extraMsg}`,
    gameOver: false,
    won: false,
    nextQuestion: `Question the ${ordinal}: ${nextQ.question}`,
    nextQuestionNumber: session.questionNumber,
    nextCategory: nextQ.category,
    nextDifficulty: nextQ.difficulty,
    score,
    mode: session.mode,
  };
}

export function getGameStatus(sessionId: string): GameSession | null {
  return activeSessions.get(sessionId) || null;
}

export function getLeaderboard(mode?: GameMode): { playerName: string; mode: GameMode; won: boolean; score: number; total: number; time: number }[] {
  const results: { playerName: string; mode: GameMode; won: boolean; score: number; total: number; time: number }[] = [];
  for (const session of activeSessions.values()) {
    if (session.status !== "active") {
      if (mode && session.mode !== mode) continue;
      results.push({
        playerName: session.playerName,
        mode: session.mode,
        won: session.status === "won",
        score: session.answers.filter(a => a.correct).length,
        total: session.totalQuestions,
        time: session.lastActivityAt.getTime() - session.startedAt.getTime(),
      });
    }
  }
  return results
    .sort((a, b) => b.score - a.score || a.time - b.time)
    .slice(0, 20);
}
