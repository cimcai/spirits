// Pure transcript formatting helpers for the room export endpoint.
//
// Extracted from routes.ts so the txt / json / markdown rendering can be unit
// tested without standing up Express, the database, or websockets. The route
// stays a thin adapter that sets headers and delegates the body here.

export type TranscriptFormat = "txt" | "json" | "md";

export interface TranscriptRoom {
  name: string;
}

export interface TranscriptEntry {
  speaker: string;
  content: string;
  timestamp?: Date | string | number | null;
}

export interface TranscriptJson {
  room: string;
  exportedAt: string;
  entryCount: number;
  entries: Array<{ speaker: string; content: string; timestamp: TranscriptEntry["timestamp"] }>;
}

/** Normalize the requested ?format= value; anything unknown falls back to txt. */
export function parseTranscriptFormat(raw: unknown): TranscriptFormat {
  return raw === "json" || raw === "md" ? raw : "txt";
}

/** Suggested download filename, e.g. transcript-Room 1-2026-02-24.md */
export function transcriptFilename(room: TranscriptRoom, format: TranscriptFormat, now: Date = new Date()): string {
  const ext = format === "json" ? "json" : format === "md" ? "md" : "txt";
  return `transcript-${room.name}-${now.toISOString().slice(0, 10)}.${ext}`;
}

function formatTime(timestamp: TranscriptEntry["timestamp"]): string {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : "";
}

/** Structured JSON payload (unchanged from the original inline implementation). */
export function buildTranscriptJson(room: TranscriptRoom, entries: TranscriptEntry[], now: Date = new Date()): TranscriptJson {
  return {
    room: room.name,
    exportedAt: now.toISOString(),
    entryCount: entries.length,
    entries: entries.map((e) => ({
      speaker: e.speaker,
      content: e.content,
      timestamp: e.timestamp,
    })),
  };
}

/** Plain-text transcript (unchanged from the original inline implementation). */
export function renderTranscriptText(room: TranscriptRoom, entries: TranscriptEntry[], now: Date = new Date()): string {
  const lines = entries.map((e) => `[${formatTime(e.timestamp)}] ${e.speaker}: ${e.content}`);
  return `Transcript: ${room.name}\nExported: ${now.toISOString()}\nEntries: ${entries.length}\n${"—".repeat(40)}\n\n${lines.join("\n")}`;
}

/** Markdown transcript: a readable "recording" of the conversation (closes #49). */
export function renderTranscriptMarkdown(room: TranscriptRoom, entries: TranscriptEntry[], now: Date = new Date()): string {
  const header = [
    `# ${room.name} — Transcript`,
    "",
    `> Exported ${now.toISOString()} · ${entries.length} ${entries.length === 1 ? "entry" : "entries"} · CIMC Spirits`,
    "",
    "---",
    "",
  ].join("\n");

  if (entries.length === 0) {
    return `${header}_No entries yet._\n`;
  }

  const blocks = entries.map((e) => {
    const time = formatTime(e.timestamp);
    const heading = time ? `**${e.speaker}** · *${time}*` : `**${e.speaker}**`;
    return `${heading}\n\n${e.content}`;
  });

  return `${header}${blocks.join("\n\n")}\n`;
}
