import { test, describe } from "node:test";
import assert from "node:assert";
import {
  parseTranscriptFormat,
  transcriptFilename,
  buildTranscriptJson,
  renderTranscriptText,
  renderTranscriptMarkdown,
  type TranscriptEntry,
} from "./transcript";

const NOW = new Date("2026-02-24T19:30:00.000Z");
const room = { name: "Room 1" };
const entries: TranscriptEntry[] = [
  { speaker: "Vascocomp", content: "I wish I had a recording of this conversation.", timestamp: "2026-02-24T19:16:32.841Z" },
  { speaker: "Iwakura", content: "Then let the record itself become the surprise.", timestamp: "2026-02-24T19:17:10.000Z" },
];

describe("parseTranscriptFormat", () => {
  test("recognizes json and md, defaults everything else to txt", () => {
    assert.strictEqual(parseTranscriptFormat("json"), "json");
    assert.strictEqual(parseTranscriptFormat("md"), "md");
    assert.strictEqual(parseTranscriptFormat("txt"), "txt");
    assert.strictEqual(parseTranscriptFormat("markdown"), "txt");
    assert.strictEqual(parseTranscriptFormat(undefined), "txt");
  });
});

describe("transcriptFilename", () => {
  test("uses the correct extension per format and the YYYY-MM-DD date", () => {
    assert.strictEqual(transcriptFilename(room, "md", NOW), "transcript-Room 1-2026-02-24.md");
    assert.strictEqual(transcriptFilename(room, "json", NOW), "transcript-Room 1-2026-02-24.json");
    assert.strictEqual(transcriptFilename(room, "txt", NOW), "transcript-Room 1-2026-02-24.txt");
  });
});

describe("buildTranscriptJson", () => {
  test("preserves the original payload shape", () => {
    const payload = buildTranscriptJson(room, entries, NOW);
    assert.strictEqual(payload.room, "Room 1");
    assert.strictEqual(payload.exportedAt, "2026-02-24T19:30:00.000Z");
    assert.strictEqual(payload.entryCount, 2);
    assert.deepStrictEqual(payload.entries[0], {
      speaker: "Vascocomp",
      content: "I wish I had a recording of this conversation.",
      timestamp: "2026-02-24T19:16:32.841Z",
    });
  });
});

describe("renderTranscriptText", () => {
  test("keeps the original plain-text structure", () => {
    const text = renderTranscriptText(room, entries, NOW);
    assert.ok(text.startsWith("Transcript: Room 1\n"));
    assert.ok(text.includes("Exported: 2026-02-24T19:30:00.000Z"));
    assert.ok(text.includes("Entries: 2"));
    assert.ok(text.includes("Vascocomp: I wish I had a recording of this conversation."));
    assert.ok(text.includes("Iwakura: Then let the record itself become the surprise."));
  });
});

describe("renderTranscriptMarkdown", () => {
  test("renders a readable markdown recording", () => {
    const md = renderTranscriptMarkdown(room, entries, NOW);
    assert.ok(md.startsWith("# Room 1 — Transcript\n"));
    assert.ok(md.includes("> Exported 2026-02-24T19:30:00.000Z · 2 entries · CIMC Spirits"));
    assert.ok(md.includes("**Vascocomp**"));
    assert.ok(md.includes("I wish I had a recording of this conversation."));
    assert.ok(md.includes("**Iwakura**"));
    assert.ok(md.endsWith("\n"));
  });

  test("pluralizes a single entry as 'entry'", () => {
    const md = renderTranscriptMarkdown(room, [entries[0]], NOW);
    assert.ok(md.includes("· 1 entry ·"));
  });

  test("handles an empty room gracefully", () => {
    const md = renderTranscriptMarkdown(room, [], NOW);
    assert.ok(md.includes("_No entries yet._"));
  });

  test("omits the time marker when a timestamp is missing", () => {
    const md = renderTranscriptMarkdown(room, [{ speaker: "Anon", content: "No clock here.", timestamp: null }], NOW);
    assert.ok(md.includes("**Anon**\n\nNo clock here."));
    assert.ok(!md.includes("**Anon** · *"));
  });
});
